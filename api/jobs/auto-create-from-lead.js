// api/jobs/auto-create-from-lead.js
// Called by QuoteReviewPage after agreement/invoice signing.
// Creates a job with status='ready_to_schedule' (no date, no tech).
// Front desk sees it on Dispatch Board → calls customer → confirms date.
//
// Public endpoint (called from customer-facing page) — uses service role key.
// Idempotent: skips if job already exists for the lead.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { lead_id } = req.body;
  if (!lead_id) return res.status(400).json({ error: 'lead_id is required' });

  try {
    // ── 1. Fetch the lead ─────────────────────────────────────
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // ── 2. Duplicate prevention ───────────────────────────────
    const { data: existingJob } = await supabase
      .from('jobs')
      .select('id, status')
      .eq('lead_id', lead_id)
      .limit(1)
      .maybeSingle();

    if (existingJob) {
      console.log(`[AUTO-JOB] Job already exists for lead ${lead_id}: ${existingJob.id} (${existingJob.status})`);
      return res.status(200).json({ success: true, job_id: existingJob.id, already_existed: true });
    }

    // ── 3. Detect system type from quote line items ───────────
    let systemType = 'softener_only';

    const { data: signedQuote } = await supabase
      .from('quotes')
      .select('id')
      .eq('lead_id', lead_id)
      .in('status', ['accepted', 'signed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (signedQuote) {
      const { data: lineItems } = await supabase
        .from('document_line_items')
        .select('product_id')
        .eq('document_id', signedQuote.id)
        .eq('item_type', 'product');

      if (lineItems && lineItems.length > 0) {
        const productIds = lineItems.map(li => li.product_id).filter(Boolean);
        if (productIds.length > 0) {
          const { data: products } = await supabase
            .from('products')
            .select('category')
            .in('id', productIds);

          const categories = (products || []).map(p => p.category).filter(Boolean);
          systemType = detectSystemType(categories);
        }
      }
    }

    // ── 4. Build address ──────────────────────────────────────
    const address = [lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ');

    // ── 5. Create job — ready_to_schedule, no date ────────────
    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .insert({
        lead_id: lead.id,
        status: 'ready_to_schedule',
        job_type: 'standard_install',
        system_type: systemType,
        scheduled_date: null,
        customer_name_snapshot: lead.full_name,
        phone_snapshot: lead.phone,
        email_snapshot: lead.email || null,
        service_address_snapshot: address || null,
        equipment_summary: lead.equipment_summary || null,
        quote_total_snapshot: lead.quote_total,
        payment_method_snapshot: lead.payment_method,
      })
      .select('id')
      .single();

    if (jobErr) {
      if (jobErr.code === '23505') {
        console.log(`[AUTO-JOB] Duplicate caught for lead ${lead_id}`);
        return res.status(200).json({ success: true, already_existed: true });
      }
      throw jobErr;
    }

    console.log(`[AUTO-JOB] Created job ${job.id} for lead ${lead_id} as ready_to_schedule (system: ${systemType})`);

    // ── 6. Generate checklist from template ────────────────────
    try {
      const { data: template } = await supabase
        .from('checklist_templates')
        .select('id, version')
        .eq('system_type', systemType)
        .eq('is_active', true)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (template) {
        const { data: templateItems } = await supabase
          .from('checklist_template_items')
          .select('*')
          .eq('template_id', template.id)
          .order('sort_order');

        if (templateItems && templateItems.length > 0) {
          const checklistRows = templateItems.map(item => ({
            job_id: job.id,
            template_id: template.id,
            template_version: template.version,
            section: item.section,
            item_text: item.item_text,
            sort_order: item.sort_order,
            is_required: item.is_required,
            requires_photo: item.requires_photo,
            requires_tech_verification: item.requires_tech_verification,
          }));
          await supabase.from('job_checklist_items').insert(checklistRows);
        }
      }
    } catch (e) {
      console.error('[AUTO-JOB] Checklist generation error (non-fatal):', e.message);
    }

    // ── 7. Update lead bridge field ───────────────────────────
    await supabase
      .from('leads')
      .update({ job_created: true })
      .eq('id', lead_id);

    // ── 8. Activity log ───────────────────────────────────────
    try {
      await supabase.from('lead_activity_log').insert({
        lead_id: lead_id,
        event_type: 'job_auto_created',
        title: 'Install job auto-created after agreement signing',
        metadata: { job_id: job.id, system_type: systemType, status: 'ready_to_schedule' },
        actor_id: null,
        actor_name: 'System',
      });
      await supabase.from('job_activity_log').insert({
        job_id: job.id,
        event_type: 'job_created',
        title: 'Job auto-created from signed agreement — awaiting scheduling',
        metadata: { lead_id, system_type: systemType },
        actor_id: 'system',
        actor_name: 'System',
      });
    } catch (e) { /* best effort */ }

    return res.status(200).json({ success: true, job_id: job.id, system_type: systemType });

  } catch (err) {
    console.error('[AUTO-JOB] Error:', err);
    return res.status(500).json({ error: 'Failed to auto-create job', detail: err.message });
  }
};

// ── System type detection from product categories ─────────────
function detectSystemType(categories) {
  const has = c => categories.includes(c);
  if ((has('ro') && has('softener')) || (has('ro') && has('whole_home_filter'))) return 'combo_whole_home_ro';
  if (has('ro')) return 'ro_install';
  if (has('softener')) return 'softener_only';
  if (has('whole_home_filter') || has('filtration')) return 'softener_only';
  if (has('iron_filter')) return 'softener_only';
  return 'softener_only';
}
