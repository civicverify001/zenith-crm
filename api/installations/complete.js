// api/installations/complete.js
// Mark installation complete + create installed system + link documents + charge install fee
//
// OWNERSHIP RESOLUTION — 3-layer cascade (permanent fix):
//   Layer 1: quotes table — match by lead_id / opportunity_id
//   Layer 2: quotes table — match by customer_id (catches QuoteBuilder-created quotes)
//   Layer 3: contracts table — match by customer_id (catches any remaining cases)
// This eliminates the lead_id dependency that caused rental installs to write 'purchased'.

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

    // ── 2. Find customer linked to this job ───────────────────────────
    // Try lead_id first (standard path), then fall back to name+phone snapshot
    let customerId = null;

    if (job.lead_id) {
      const { data: customerByLead } = await supabase
        .from('customers')
        .select('id')
        .eq('lead_id', job.lead_id)
        .maybeSingle();
      customerId = customerByLead?.id || null;
    }

    // Fallback: match by name snapshot if lead_id lookup missed
    if (!customerId && job.customer_name_snapshot) {
      const { data: customerByName } = await supabase
        .from('customers')
        .select('id')
        .ilike('full_name', job.customer_name_snapshot.trim())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (customerByName) {
        customerId = customerByName.id;
        console.log(`[complete.js] Customer resolved via name snapshot: ${job.customer_name_snapshot}`);
      }
    }

    // ── 3. Find accepted quote — 2-layer quote lookup ─────────────────
    // Layer 1: by lead_id / opportunity_id (standard pipeline path)
    // Layer 2: by customer_id (QuoteBuilder path — quote has customer_id but no lead_id)
    let installFee = 0;
    let acceptedQuote = null;

    if (job.lead_id) {
      const { data: quoteByLead } = await supabase
        .from('quotes')
        .select('id, install_fee, monthly_amount, customer_name, product_id, quote_type, commercial_type, customer_id')
        .or(`lead_id.eq.${job.lead_id},opportunity_id.eq.${job.lead_id}`)
        .in('status', ['accepted', 'signed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (quoteByLead) {
        acceptedQuote = quoteByLead;
        console.log(`[complete.js] Quote resolved via lead_id: ${job.lead_id}`);
        // Also capture customer_id from quote if we don't have it yet
        if (!customerId && quoteByLead.customer_id) {
          customerId = quoteByLead.customer_id;
          console.log(`[complete.js] Customer resolved via quote.customer_id`);
        }
      }
    }

    // Layer 2: quote by customer_id (runs if layer 1 missed)
    if (!acceptedQuote && customerId) {
      const { data: quoteByCustomer } = await supabase
        .from('quotes')
        .select('id, install_fee, monthly_amount, customer_name, product_id, quote_type, commercial_type, customer_id')
        .eq('customer_id', customerId)
        .in('status', ['accepted', 'signed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (quoteByCustomer) {
        acceptedQuote = quoteByCustomer;
        console.log(`[complete.js] Quote resolved via customer_id: ${customerId}`);
      }
    }

    if (acceptedQuote?.install_fee) {
      installFee = parseFloat(acceptedQuote.install_fee);
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

    // ── 5b. Set job_id on customer record so Documents tab loads ──────
    if (customerId) {
      await supabase
        .from('customers')
        .update({ job_id: job_id })
        .eq('id', customerId)
        .is('job_id', null);
    }

    // ── 6. Determine ownership type — 3-layer cascade ─────────────────
    // Layer 1: quote commercial_type (most authoritative)
    // Layer 2: quote monthly_amount heuristic
    // Layer 3: contracts table fallback (catches all remaining rental cases)
    let ownershipType = 'purchased'; // safe default
    let ownershipSource = 'default';

    const ct = acceptedQuote?.commercial_type;
    if (ct === 'rental') {
      ownershipType = 'rented';
      ownershipSource = 'quote.commercial_type';
    } else if (ct === 'purchase') {
      ownershipType = 'purchased';
      ownershipSource = 'quote.commercial_type';
    } else if (ct === 'finance' || ct === 'financed') {
      ownershipType = 'purchased';
      ownershipSource = 'quote.commercial_type';
    } else if (acceptedQuote?.monthly_amount > 0 && !ct) {
      // monthly_amount heuristic — only if commercial_type is missing
      ownershipType = 'rented';
      ownershipSource = 'quote.monthly_amount_heuristic';
    } else {
      // Layer 3: contracts table fallback — rental contracts are always present for rental customers
      if (customerId) {
        const { data: rentalContract } = await supabase
          .from('contracts')
          .select('id, commercial_type')
          .eq('customer_id', customerId)
          .eq('commercial_type', 'rental')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (rentalContract) {
          ownershipType = 'rented';
          ownershipSource = 'contracts_table_fallback';
          console.log(`[complete.js] Ownership resolved via contracts table for customer ${customerId}`);
        } else {
          // Also try install fee from contract
          const { data: anyContract } = await supabase
            .from('contracts')
            .select('id, commercial_type, install_fee')
            .eq('customer_id', customerId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (anyContract) {
            ownershipType = anyContract.commercial_type === 'rental' ? 'rented' : 'purchased';
            ownershipSource = 'contracts_table_any';
            if (!installFee && anyContract.install_fee) {
              installFee = parseFloat(anyContract.install_fee);
            }
          }
        }
      }
    }

    console.log(`[complete.js] ownershipType=${ownershipType} (source: ${ownershipSource}) for customer ${customerId}`);

    // ── 7. Create installed_systems record ────────────────────────────
    let installedSystemId = null;
    if (customerId) {
      const today = new Date().toISOString().split('T')[0];

      const { data: sysRecord, error: sysError } = await supabase
        .from('installed_systems')
        .insert({
          customer_id: customerId,
          system_type: job.system_type || product?.category || 'unknown',
          name_snapshot: product?.name || ({
            softener_only: 'Water Softener',
            ro_only: 'Reverse Osmosis System',
            ro_install: 'Reverse Osmosis System',
            softener_ro: 'Water Softener + RO System',
            whole_home_filter: 'Whole Home Filter',
            iron_filter: 'Iron Filter',
            dual_tank: 'Dual Tank Softener',
            advanced_softener: 'Advanced Softener System',
          }[job.system_type] || job.system_type?.replace(/_/g, ' ') || 'Installed System'),
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
      } else {
        console.error('[installed_systems insert error]', sysError?.message);
      }
    }

    // ── 8. Link signed documents to customer via document_links ──────
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

    // ── 9. Log activity ───────────────────────────────────────────────
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
          ownership_type: ownershipType,
          ownership_source: ownershipSource,
        },
        actor_id: completed_by || job_id,
      });
    } catch(e) { console.error('[BEST-EFFORT] job_activity_log:', e.message); }

    // ── 9b. Customer activity log ─────────────────────────────────────
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
            ownership_source: ownershipSource,
            system_type: job.system_type || null,
          },
        });
      } catch(e) { console.error('[BEST-EFFORT] customer_activity_log:', e.message); }
    }

    // ── 10. Skip charge if no customer or no fee ──────────────────────
    if (!customerId || installFee <= 0) {
      return res.status(200).json({
        success: true,
        job_completed: true,
        installed_system_id: installedSystemId,
        ownership_type: ownershipType,
        ownership_source: ownershipSource,
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
        ownership_type: ownershipType,
        ownership_source: ownershipSource,
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
        ownership_type: ownershipType,
        ownership_source: ownershipSource,
        charge_status: 'skipped',
        reason: 'No payment method on file',
        install_fee: installFee,
      });
    }

    // ── 11. Stripe charge ─────────────────────────────────────────────
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
      ownership_type: ownershipType,
      ownership_source: ownershipSource,
      charge_status: chargeResult.status,
      charge_details: chargeResult,
    });

  } catch (err) {
    console.error('complete install error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
};
