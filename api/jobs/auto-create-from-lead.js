const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { lead_id } = req.body;
  if (!lead_id) return res.status(400).json({ error: 'lead_id is required' });

  try {
    // 1. Check if job already exists
    const { data: existing } = await supabase
      .from('jobs').select('id, status').eq('lead_id', lead_id).limit(1).maybeSingle();
    if (existing) return res.status(200).json({ success: true, job_id: existing.id, already_existed: true });

    // 2. Fetch lead
    const { data: lead, error: leadErr } = await supabase
      .from('leads').select('*').eq('id', lead_id).single();
    if (leadErr || !lead) return res.status(404).json({ error: 'Lead not found', detail: leadErr?.message });

    // 3. Build address
    const address = [lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ');

    // 4. Inventory gate — find products from the accepted/signed quote for this lead
    let jobStatus = 'ready_to_schedule';
    let systemType = 'softener_only';

    try {
      const { data: quote } = await supabase
        .from('quotes')
        .select('id')
        .eq('lead_id', lead_id)
        .in('status', ['accepted', 'signed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (quote) {
        // Get product line items from the quote
        const { data: lineItems } = await supabase
          .from('document_line_items')
          .select('product_id, description')
          .eq('document_id', quote.id)
          .eq('item_type', 'product')
          .not('product_id', 'is', null);

        if (lineItems && lineItems.length > 0) {
          const productIds = lineItems.map(li => li.product_id);

          // Check inventory for all products — any with available <= 0 triggers waiting_for_stock
          const { data: inventory } = await supabase
            .from('inventory')
            .select('product_id, quantity_available, quantity_on_hand')
            .in('product_id', productIds);

          if (inventory && inventory.length > 0) {
            const hasStockIssue = inventory.some(inv =>
              (inv.quantity_available ?? inv.quantity_on_hand ?? 0) <= 0
            );
            if (hasStockIssue) {
              jobStatus = 'waiting_for_stock';
              console.log('[AUTO-JOB] Stock unavailable for lead', lead_id, '— setting waiting_for_stock');
            }
          } else {
            // No inventory records found for these products — treat as out of stock
            jobStatus = 'waiting_for_stock';
            console.log('[AUTO-JOB] No inventory records found for products — setting waiting_for_stock');
          }

          // Derive system_type from product category if possible
          const { data: products } = await supabase
            .from('products')
            .select('id, category')
            .in('id', productIds)
            .limit(1);
          if (products && products[0]?.category) {
            const cat = products[0].category;
            if (cat === 'ro') systemType = 'ro_only';
            else if (cat === 'softener') systemType = 'softener_only';
            else if (cat === 'whole_home_filter') systemType = 'whole_home_filter';
            else if (cat === 'combo') systemType = 'softener_ro';
          }
        }
      }
    } catch (invErr) {
      // Inventory check failed — default to ready_to_schedule, don't block job creation
      console.error('[AUTO-JOB] Inventory check error (non-fatal):', invErr.message);
    }

    // 5. Create job
    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .insert({
        lead_id: lead.id,
        status: jobStatus,
        job_type: 'standard_install',
        system_type: systemType,
        scheduled_date: null,
        customer_name_snapshot: lead.full_name || 'Unknown',
        phone_snapshot: lead.phone || '',
        email_snapshot: lead.email || null,
        service_address_snapshot: address || null,
        source_quote_id: quote?.id || null,
      })
      .select('id')
      .single();

    if (jobErr) {
      if (jobErr.code === '23505') return res.status(200).json({ success: true, already_existed: true });
      return res.status(500).json({ error: 'Job insert failed', detail: jobErr.message });
    }

    // 6. Update lead
    await supabase.from('leads').update({ job_created: true }).eq('id', lead_id);

    console.log('[AUTO-JOB] Created job', job.id, 'for lead', lead_id, '— status:', jobStatus);
    return res.status(200).json({ success: true, job_id: job.id, status: jobStatus });

  } catch (err) {
    console.error('[AUTO-JOB] Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
