// api/installations/complete.js
// Mark installation complete + create installed system + link documents + charge install fee
// IDEMPOTENT: safe to re-run. Corrects wrong ownership_type from prior crashed runs.
// Does NOT use upsert — uses check-then-update-or-insert to avoid needing a DB unique constraint.

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
    // ── 1. Fetch the job ──────────────────────────────────────────────────────
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('id, status, lead_id, system_type, customer_name_snapshot, service_address_snapshot')
      .eq('id', job_id)
      .single();

    if (jobError || !job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // We do NOT bail out if job is already complete.
    // Re-running corrects any partial state from a prior crashed run.
    const alreadyComplete = job.status === 'complete';

    // ── 2. Find customer linked to this job ───────────────────────────────────
    // Try lead_id first, then fall back to job_id on customers table directly.
    let customerId = null;
    if (job.lead_id) {
      const { data: cust } = await supabase
        .from('customers')
        .select('id')
        .eq('lead_id', job.lead_id)
        .maybeSingle();
      customerId = cust?.id || null;
    }
    if (!customerId) {
      const { data: cust } = await supabase
        .from('customers')
        .select('id')
        .eq('job_id', job_id)
        .maybeSingle();
      customerId = cust?.id || null;
    }

    // ── 3. Get accepted/signed quote (unified .or() lookup) ───────────────────
    // Matches either lead_id or opportunity_id in one query.
    // Also falls back to customer's lead_id if job.lead_id is null.
    let installFee = 0;
    let acceptedQuote = null;
    let lookupLeadId = job.lead_id;

    // If job.lead_id is null, try to get it from the customer record
    if (!lookupLeadId && customerId) {
      const { data: cust } = await supabase
        .from('customers')
        .select('lead_id')
        .eq('id', customerId)
        .maybeSingle();
      lookupLeadId = cust?.lead_id || null;
    }

    if (lookupLeadId) {
      const { data: quote } = await supabase
        .from('quotes')
        .select('id, install_fee, monthly_amount, customer_name, product_id, quote_type, commercial_type')
        .or(`lead_id.eq.${lookupLeadId},opportunity_id.eq.${lookupLeadId}`)
        .in('status', ['accepted', 'signed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      acceptedQuote = quote;
      if (quote?.install_fee) installFee = parseFloat(quote.install_fee);
    }

    // ── 4. Get product info for system snapshot ───────────────────────────────
    let product = null;
    if (acceptedQuote?.product_id) {
      const { data: prod } = await supabase
        .from('products')
        .select('id, name, sku, retail_price, warranty_months, category')
        .eq('id', acceptedQuote.product_id)
        .maybeSingle();
      product = prod;
    }

    // ── 5. Determine ownership type ───────────────────────────────────────────
    // commercial_type is AUTHORITATIVE. Never use quote_type.
    const ct = acceptedQuote?.commercial_type;
    const ownershipType = ct === 'rental' ? 'rented'
      : ct === 'purchase' ? 'purchased'
      : ct === 'finance' ? 'purchased'
      : (acceptedQuote?.monthly_amount > 0) ? 'rented'
      : 'purchased';

    // ── 6. Mark job complete (skip if already done) ───────────────────────────
    if (!alreadyComplete) {
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
    }

    // ── 6b. Set job_id on customer record so Documents tab loads ──────────────
    if (customerId) {
      await supabase
        .from('customers')
        .update({ job_id: job_id })
        .eq('id', customerId)
        .is('job_id', null);
    }

    // ── 7. Check-then-update-or-insert installed_systems ─────────────────────
    // Does NOT use upsert (which requires a unique constraint on job_id).
    // Instead: check if a record exists for this job_id, then UPDATE or INSERT.
    // This is idempotent and self-correcting — re-running fixes wrong ownership_type
    // from a prior crashed run without any manual SQL backfill.
    let installedSystemId = null;
    if (customerId) {
      const today = new Date().toISOString().split('T')[0];

      const nameMap = {
        softener_only: 'Water Softener',
        ro_only: 'Reverse Osmosis System',
        ro_install: 'Reverse Osmosis System',
        softener_ro: 'Water Softener + RO System',
        whole_home_filter: 'Whole Home Filter',
        iron_filter: 'Iron Filter',
        dual_tank: 'Dual Tank Softener',
        advanced_softener: 'Advanced Softener System',
      };

      const systemFields = {
        customer_id: customerId,
        system_type: job.system_type || product?.category || 'unknown',
        name_snapshot: product?.name || nameMap[job.system_type] || job.system_type?.replace(/_/g, ' ') || 'Installed System',
        sku_snapshot: product?.sku || null,
        ownership_type: ownershipType,
        install_date: today,
        retail_price_snapshot: product?.retail_price || null,
        install_fee_snapshot: installFee || null,
        is_active: true,
        job_id: job_id,
      };

      // Check if a record already exists for this job_id
      const { data: existing } = await supabase
        .from('installed_systems')
        .select('id')
        .eq('job_id', job_id)
        .maybeSingle();

      if (existing?.id) {
        // UPDATE — correct any wrong data from prior run
        const { error: updErr } = await supabase
          .from('installed_systems')
          .update(systemFields)
          .eq('id', existing.id);

        if (!updErr) {
          installedSystemId = existing.id;
        } else {
          console.error('[installed_systems update error]', updErr?.message);
        }
      } else {
        // INSERT — first time running for this job
        const { data: sysRecord, error: insErr } = await supabase
          .from('installed_systems')
          .insert(systemFields)
          .select('id')
          .single();

        if (!insErr && sysRecord) {
          installedSystemId = sysRecord.id;
        } else {
          console.error('[installed_systems insert error]', insErr?.message);
        }
      }

      // Create warranty record only if it doesn't already exist
      if (installedSystemId && product?.warranty_months) {
        const { data: existingWarranty } = await supabase
          .from('warranty_records')
          .select('id')
          .eq('installed_system_id', installedSystemId)
          .maybeSingle();

        if (!existingWarranty) {
          const warrantyEnd = new Date();
          warrantyEnd.setMonth(warrantyEnd.getMonth() + product.warranty_months);
          const laborEnd = new Date();
          laborEnd.setFullYear(laborEnd.getFullYear() + 1);

          try {
            await supabase.from('warranty_records').insert({
              installed_system_id: installedSystemId,
              customer_id: customerId,
              warranty_status: 'valid',
              parts_duration_years: Math.round(product.warranty_months / 12),
              parts_end_date: warrantyEnd.toISOString().split('T')[0],
              labor_duration_years: 1,
              labor_end_date: laborEnd.toISOString().split('T')[0],
            });
          } catch(e) { console.error('[BEST-EFFORT] warranty_records:', e.message); }
        }
      }
    }

    // ── 8. Link signed documents to customer via document_links ──────────────
    if (customerId && lookupLeadId) {
      const { data: docs } = await supabase
        .from('documents')
        .select('id, type, status')
        .eq('opportunity_id', lookupLeadId)
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
            try {
              await supabase.from('document_links').insert({
                document_id: doc.id,
                entity_type: 'customer',
                entity_id: customerId,
                relationship: doc.status === 'signed' ? 'signed_agreement' : 'reference',
              });
            } catch(e) { console.error('[BEST-EFFORT] document_links:', e.message); }
          }
        }
      }
    }

    // ── 9. Log activity (skip duplicate logs on re-run) ───────────────────────
    if (!alreadyComplete) {
      try {
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
        });
      } catch(e) { console.error('[BEST-EFFORT] job_activity_log:', e.message); }

      if (customerId) {
        try {
          await supabase.from('customer_activity_log').insert({
            customer_id: customerId,
            event_type: 'system_installed',
            title: 'System installed',
            actor_id: null,
            actor_name: 'Zenith Installer',
            metadata: {
              job_id,
              installed_system_id: installedSystemId,
              install_fee: installFee,
              ownership_type: ownershipType,
              system_type: job.system_type || null,
            },
          });
        } catch(e) { console.error('[BEST-EFFORT] customer_activity_log:', e.message); }
      }
    }

    // ── 10. Skip charge if no customer or no fee ──────────────────────────────
    if (!customerId || installFee <= 0) {
      return res.status(200).json({
        success: true,
        job_completed: true,
        installed_system_id: installedSystemId,
        charge_status: installFee <= 0 ? 'no_fee' : 'no_customer',
        install_fee: installFee,
        ownership_type: ownershipType,
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
        ownership_type: ownershipType,
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
        ownership_type: ownershipType,
      });
    }

    // ── 11. Stripe charge — skip if already charged for this job ──────────────
    const { data: existingCharge } = await supabase
      .from('payment_transactions')
      .select('id, status')
      .eq('customer_id', customerId)
      .ilike('description', '%Installation fee%')
      .in('status', ['succeeded', 'pending'])
      .maybeSingle();

    if (existingCharge) {
      return res.status(200).json({
        success: true,
        job_completed: true,
        installed_system_id: installedSystemId,
        charge_status: 'already_charged',
        ownership_type: ownershipType,
        install_fee: installFee,
      });
    }

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
      ownership_type: ownershipType,
    });

  } catch (err) {
    console.error('complete install error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
};
