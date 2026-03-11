// api/installations/complete.js
// Mark installation complete + create installed system + link documents + charge install fee

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { job_id, completed_by } = req.body;
  if (!job_id) return res.status(400).json({ error: 'job_id is required' });

  try {
    // ── 1. Fetch the job ──────────────────────────────────────────────
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('id, status, lead_id, system_type, customer_name_snapshot, service_address_snapshot')
      .eq('id', job_id)
      .single();

    if (jobError || !job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    if (job.status === 'complete') {
      return res.status(400).json({ error: 'Job is already complete' });
    }

    // ── 2. Find customer linked to this lead ──────────────────────────
    let customerId = null;
    if (job.lead_id) {
      const { data: customer } = await supabase
        .from('customers')
        .select('id')
        .eq('lead_id', job.lead_id)
        .maybeSingle();
      customerId = customer?.id || null;
    }

    // ── 3. Get accepted quote (for pricing snapshots + install fee) ───
    let installFee = 0;
    let acceptedQuote = null;

    if (job.lead_id) {
      const { data: quote } = await supabase
        .from('quotes')
        .select('id, install_fee, monthly_amount, customer_name, product_id, quote_type')
        .eq('opportunity_id', job.lead_id)
        .eq('status', 'accepted')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      acceptedQuote = quote;
      if (quote?.install_fee) installFee = parseFloat(quote.install_fee);
    }

    // ── 4. Get product info for system snapshot ───────────────────────
    let product = null;
    if (acceptedQuote?.product_id) {
      const { data: prod } = await supabase
        .from('products')
        .select('id, name, sku, retail_price, warranty_months, category')
        .eq('id', acceptedQuote.product_id)
        .maybeSingle();
      product = prod;
    }

    // ── 5. Mark job complete ──────────────────────────────────────────
    const { error: updateError } = await supabase
      .from('jobs')
      .update({
        status: 'complete',
        completed_at: new Date().toISOString(),
        ready_for_customer_conversion: true,
      })
      .eq('id', job_id);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to mark job complete', detail: updateError.message });
    }

    // ── 6. Create installed_systems record ────────────────────────────
    let installedSystemId = null;
    if (customerId) {
      const ownershipType = acceptedQuote?.quote_type === 'purchase' ? 'purchased' : 'rented';
      const today = new Date().toISOString().split('T')[0];

      const { data: sysRecord, error: sysError } = await supabase
        .from('installed_systems')
        .insert({
          customer_id: customerId,
          system_type: job.system_type || product?.category || 'unknown',
          name_snapshot: product?.name || job.customer_name_snapshot || 'Installed System',
          sku_snapshot: product?.sku || null,
          ownership_type: ownershipType,
          install_date: today,
          retail_price_snapshot: product?.retail_price || null,
          install_fee_snapshot: installFee || null,
          is_active: true,
          job_id: job_id,
        })
        .select('id')
        .single();

      if (!sysError && sysRecord) {
        installedSystemId = sysRecord.id;

        // Create warranty record if product has warranty_months
        if (product?.warranty_months) {
          const warrantyEnd = new Date();
          warrantyEnd.setMonth(warrantyEnd.getMonth() + product.warranty_months);
          const laborEnd = new Date();
          laborEnd.setFullYear(laborEnd.getFullYear() + 1);

          await supabase.from('warranty_records').insert({
            installed_system_id: installedSystemId,
            customer_id: customerId,
            warranty_status: 'valid',
            parts_duration_years: Math.round(product.warranty_months / 12),
            parts_end_date: warrantyEnd.toISOString().split('T')[0],
            labor_duration_years: 1,
            labor_end_date: laborEnd.toISOString().split('T')[0],
          }).catch(e => console.error('[BEST-EFFORT] warranty_records:', e.message));
        }
      } else {
        console.error('[installed_systems insert error]', sysError?.message);
      }
    }

    // ── 7. Link signed documents to customer via document_links ──────
    if (customerId && job.lead_id) {
      const { data: docs } = await supabase
        .from('documents')
        .select('id, type, status')
        .eq('opportunity_id', job.lead_id)
        .in('status', ['signed', 'accepted', 'paid'])
        .order('created_at', { ascending: false });

      if (docs?.length) {
        for (const doc of docs) {
          const { data: existing } = await supabase
            .from('document_links')
            .select('id')
            .eq('document_id', doc.id)
            .eq('entity_type', 'customer')
            .eq('entity_id', customerId)
            .maybeSingle();

          if (!existing) {
            await supabase.from('document_links').insert({
              document_id: doc.id,
              entity_type: 'customer',
              entity_id: customerId,
              relationship: doc.status === 'signed' ? 'signed_agreement' : 'reference',
            }).catch(e => console.error('[BEST-EFFORT] document_links:', e.message));
          }
        }
      }
    }

    // ── 8. Log activity ───────────────────────────────────────────────
    await supabase.from('job_activity_log').insert({
      job_id,
      event_type: 'job_completed',
      title: 'Job marked complete',
      metadata: {
        completed_by: completed_by || null,
        install_fee: installFee,
        installed_system_id: installedSystemId,
        customer_id: customerId,
      },
      actor_id: completed_by || job_id,
    }).catch(e => console.error('[BEST-EFFORT] activity log:', e.message));

    // ── 9. Skip charge if no customer or no fee ───────────────────────
    if (!customerId || installFee <= 0) {
      return res.status(200).json({
        success: true,
        job_completed: true,
        installed_system_id: installedSystemId,
        charge_status: installFee <= 0 ? 'no_fee' : 'no_customer',
        install_fee: installFee,
      });
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('id, stripe_customer_id, full_name, email')
      .eq('id', customerId)
      .single();

    if (!customer?.stripe_customer_id) {
      return res.status(200).json({
        success: true,
        job_completed: true,
        installed_system_id: installedSystemId,
        charge_status: 'skipped',
        reason: 'No Stripe customer ID',
        install_fee: installFee,
      });
    }

    const { data: paymentMethod } = await supabase
      .from('payment_methods')
      .select('id, external_id, last_four')
      .eq('customer_id', customerId)
      .eq('is_default', true)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (!paymentMethod?.external_id) {
      return res.status(200).json({
        success: true,
        job_completed: true,
        installed_system_id: installedSystemId,
        charge_status: 'skipped',
        reason: 'No payment method on file',
        install_fee: installFee,
      });
    }

    // ── 10. Stripe charge ─────────────────────────────────────────────
    let chargeResult = {};
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(installFee * 100),
        currency: 'usd',
        customer: customer.stripe_customer_id,
        payment_method: paymentMethod.external_id,
        off_session: true,
        confirm: true,
        description: `Install fee — Job ${job_id}`,
        metadata: { job_id, customer_id: customerId, type: 'install_fee' },
      });

      await supabase.from('payment_transactions').insert({
        customer_id: customerId,
        payment_method_id: paymentMethod.id,
        amount: installFee,
        status: paymentIntent.status === 'succeeded' ? 'succeeded' : 'pending',
        type: 'manual',
        external_id: paymentIntent.id,
        description: `Installation fee — ${customer.full_name || 'Customer'}`,
        attempted_at: new Date().toISOString(),
        completed_at: paymentIntent.status === 'succeeded' ? new Date().toISOString() : null,
      });

      chargeResult = {
        status: paymentIntent.status === 'succeeded' ? 'charged' : 'pending',
        amount: installFee,
        payment_intent_id: paymentIntent.id,
        last_four: paymentMethod.last_four,
      };
    } catch (stripeErr) {
      await supabase.from('payment_transactions').insert({
        customer_id: customerId,
        payment_method_id: paymentMethod.id,
        amount: installFee,
        status: 'failed',
        type: 'manual',
        description: `Installation fee FAILED — ${customer.full_name || 'Customer'}`,
        attempted_at: new Date().toISOString(),
        failure_reason: stripeErr.message,
      });

      chargeResult = { status: 'failed', error: stripeErr.message, amount: installFee };
    }

    return res.status(200).json({
      success: true,
      job_completed: true,
      installed_system_id: installedSystemId,
      charge_status: chargeResult.status,
      charge_details: chargeResult,
    });

  } catch (err) {
    console.error('complete install error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
};
