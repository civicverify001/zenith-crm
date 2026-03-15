// api/installations/complete.js
// Mark installation complete + create installed system + link documents + charge install fee
// + activate service plans (quote-origin + auto-enroll)
//
// IDEMPOTENT: safe to re-run on an already-completed job.
//   - installed_systems: UPDATE if row exists for job_id (corrects ownership), INSERT if not
//   - Stripe charge: skipped if payment_transactions already has a succeeded row for type=install_fee
//   - job status update and activity logs: skipped if job already complete
//   - service plans: skipped if plan already exists for customer+template+system (unique index)

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

    // NOTE: No hard early exit on status === 'complete'.
    // Re-runs are intentionally allowed so ownership and snapshots can be corrected.
    const alreadyComplete = job.status === 'complete';

    // ── 2. Customer lookup — two layers ──────────────────────────────
    //   Layer 1: customers.lead_id = job.lead_id  (standard pipeline path)
    //   Layer 2: customers.job_id  = job.id       (covers convertJobToCustomer-created customers)
    let customerId = null;

    if (job.lead_id) {
      const { data: c1 } = await supabase
        .from('customers')
        .select('id')
        .eq('lead_id', job.lead_id)
        .maybeSingle();
      customerId = c1?.id || null;
    }

    if (!customerId) {
      const { data: c2 } = await supabase
        .from('customers')
        .select('id')
        .eq('job_id', job_id)
        .maybeSingle();
      customerId = c2?.id || null;
    }

    // ── 3. Ownership + fee resolution — four-layer cascade ───────────
    //
    //   Layer 1: quotes WHERE lead_id/opportunity_id = job.lead_id, status IN (accepted, signed)
    //   Layer 2: quotes WHERE customer_id = customerId, status IN (accepted, signed)
    //   Layer 3: agreements WHERE customer_id = customerId, status = signed
    //   Layer 4: contracts WHERE customer_id = customerId, type = rental, status = active
    //
    //   install_fee:    quote → agreement → 0
    //   monthlyAmount:  quote → agreement → null
    //   ownershipType:  resolved from whichever layer fires first

    let acceptedQuote = null;
    let installFee = 0;
    let monthlyAmount = null;
    let ownershipType = 'purchased'; // safe default
    let ownershipSource = 'default';

    // Layer 1 — quote by lead_id / opportunity_id
    if (job.lead_id) {
      const { data: q } = await supabase
        .from('quotes')
        .select('id, install_fee, monthly_amount, customer_name, product_id, commercial_type')
        .or(`lead_id.eq.${job.lead_id},opportunity_id.eq.${job.lead_id}`)
        .in('status', ['accepted', 'signed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (q) { acceptedQuote = q; ownershipSource = 'quote_lead_id'; }
    }

    // Layer 2 — quote by customer_id (covers quotes created from CustomerQuotesTab)
    if (!acceptedQuote && customerId) {
      const { data: q } = await supabase
        .from('quotes')
        .select('id, install_fee, monthly_amount, customer_name, product_id, commercial_type')
        .eq('customer_id', customerId)
        .in('status', ['accepted', 'signed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (q) { acceptedQuote = q; ownershipSource = 'quote_customer_id'; }
    }

    // Resolve ownership + fee from quote (layers 1 or 2)
    if (acceptedQuote) {
      const ct = acceptedQuote.commercial_type;
      ownershipType = ct === 'rental'  ? 'rented'
        : ct === 'purchase' ? 'purchased'
        : ct === 'finance'  ? 'purchased'
        : (parseFloat(acceptedQuote.monthly_amount) > 0) ? 'rented'
        : 'purchased';
      installFee    = acceptedQuote.install_fee    ? parseFloat(acceptedQuote.install_fee)    : 0;
      monthlyAmount = acceptedQuote.monthly_amount ? parseFloat(acceptedQuote.monthly_amount) : null;
    }

    // Layer 3 — signed agreement (fallback when no quote found)
    if (!acceptedQuote && customerId) {
      const { data: ag } = await supabase
        .from('agreements')
        .select('agreement_type, monthly_amount, install_fee')
        .eq('customer_id', customerId)
        .eq('status', 'signed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ag) {
        ownershipType = ag.agreement_type === 'rental' ? 'rented' : 'purchased';
        installFee    = ag.install_fee    ? parseFloat(ag.install_fee)    : 0;
        monthlyAmount = ag.monthly_amount ? parseFloat(ag.monthly_amount) : null;
        ownershipSource = 'agreement';
      }
    }

    // Layer 4 — active contract (last resort)
    if (ownershipSource === 'default' && customerId) {
      const { data: con } = await supabase
        .from('contracts')
        .select('type, monthly_amount')
        .eq('customer_id', customerId)
        .eq('status', 'active')
        .in('type', ['rental', 'purchase', 'financed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (con) {
        ownershipType = con.type === 'rental' ? 'rented' : 'purchased';
        monthlyAmount = con.monthly_amount ? parseFloat(con.monthly_amount) : null;
        ownershipSource = 'contract';
      }
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

    // ── 5. Mark job complete (only if not already complete) ──────────
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

    // ── 5b. Set job_id on customer record (only if not already set) ───
    if (customerId) {
      await supabase
        .from('customers')
        .update({ job_id: job_id })
        .eq('id', customerId)
        .is('job_id', null);
    }

    // ── 5c. Set billing_day on active contract = today's install date ─
    if (customerId) {
      const billingDay = new Date().getDate();
      try {
        await supabase
          .from('contracts')
          .update({ billing_day: billingDay })
          .eq('customer_id', customerId)
          .eq('status', 'active');
      } catch(e) { console.error('[BEST-EFFORT] billing_day update:', e.message); }
    }

    // ── 5d. Move lead to 'won' now that install is physically complete ─
    if (!alreadyComplete && job.lead_id) {
      try {
        await supabase
          .from('leads')
          .update({
            stage: 'won',
            stage_changed_at: new Date().toISOString(),
            stage_entered_at: new Date().toISOString(),
          })
          .eq('id', job.lead_id);
      } catch(e) {
        console.warn('[BEST-EFFORT] lead won stage move:', e.message);
      }
    }

    // ── 6. Installed systems — idempotent upsert ──────────────────────
    let installedSystemId = null;

    if (customerId) {
      const today = new Date().toISOString().split('T')[0];

      const nameMap = {
        softener_only:       'Water Softener',
        ro_only:             'Reverse Osmosis System',
        ro_install:          'Reverse Osmosis System',
        softener_ro:         'Water Softener + RO System',
        whole_home_filter:   'Whole Home Filter',
        iron_filter:         'Iron Filter',
        dual_tank:           'Dual Tank Softener',
        advanced_softener:   'Advanced Softener System',
        combo_whole_home_ro: 'Whole Home + RO System',
        pure_start_softener: 'Pure Start Softener',
      };

      const { data: existingRow } = await supabase
        .from('installed_systems')
        .select('id, ownership_type')
        .eq('job_id', job_id)
        .maybeSingle();

      if (existingRow) {
        installedSystemId = existingRow.id;
        await supabase
          .from('installed_systems')
          .update({
            ownership_type:          ownershipType,
            install_fee_snapshot:    installFee || null,
            monthly_amount_snapshot: monthlyAmount,
          })
          .eq('id', existingRow.id);

        console.log(
          `[complete.js] UPDATED installed_system ${existingRow.id}:`,
          `ownership=${ownershipType} (was ${existingRow.ownership_type}),`,
          `source=${ownershipSource}`
        );

      } else {
        const { data: sysRecord, error: sysError } = await supabase
          .from('installed_systems')
          .insert({
            customer_id:             customerId,
            system_type:             job.system_type || product?.category || 'unknown',
            name_snapshot:           product?.name || nameMap[job.system_type] || job.system_type?.replace(/_/g, ' ') || 'Installed System',
            sku_snapshot:            product?.sku || null,
            ownership_type:          ownershipType,
            install_date:            today,
            retail_price_snapshot:   product?.retail_price || null,
            install_fee_snapshot:    installFee || null,
            monthly_amount_snapshot: monthlyAmount,
            is_active:               true,
            job_id:                  job_id,
          })
          .select('id')
          .single();

        if (!sysError && sysRecord) {
          installedSystemId = sysRecord.id;
        } else {
          console.error('[installed_systems insert error]', sysError?.message);
        }

        // Warranty: only on INSERT path (never duplicate on re-run)
        if (installedSystemId && product?.warranty_months) {
          const warrantyEnd = new Date();
          warrantyEnd.setMonth(warrantyEnd.getMonth() + product.warranty_months);
          const laborEnd = new Date();
          laborEnd.setFullYear(laborEnd.getFullYear() + 1);
          try {
            await supabase.from('warranty_records').insert({
              installed_system_id: installedSystemId,
              customer_id:         customerId,
              warranty_status:     'valid',
              parts_duration_years: Math.round(product.warranty_months / 12),
              parts_end_date:      warrantyEnd.toISOString().split('T')[0],
              labor_duration_years: 1,
              labor_end_date:      laborEnd.toISOString().split('T')[0],
            });
          } catch(e) { console.error('[BEST-EFFORT] warranty_records:', e.message); }
        }
      }
    }

    // ── 7. Link signed documents to customer via document_links ───────
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
                document_id:   doc.id,
                entity_type:   'customer',
                entity_id:     customerId,
                relationship:  doc.status === 'signed' ? 'signed_agreement' : 'reference',
              });
            } catch(e) { console.error('[BEST-EFFORT] document_links:', e.message); }
          }
        }
      }
    }

    // ── 7b. SERVICE PLAN ACTIVATION ───────────────────────────────────
    // Two sources:
    //   A) Quote-origin: document_line_items with item_type = 'service_plan' from the accepted quote
    //   B) Auto-enroll: service_plans templates where auto_activate_on_install = true and category matches
    //
    // Idempotent: partial unique index on customer_service_plans prevents duplicates.
    // Plans that already exist are silently skipped (23505 = unique_violation).

    const activatedPlans = [];

    if (customerId && installedSystemId && !alreadyComplete) {
      const todayDate = new Date().toISOString().split('T')[0];
      const nowISO = new Date().toISOString();

      // Check if customer has a payment method on file
      const { data: pmCheck } = await supabase
        .from('payment_methods')
        .select('id')
        .eq('customer_id', customerId)
        .eq('is_default', true)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      const hasCard = !!pmCheck;

      // ── A) Quote-origin service plans ──────────────────────────────
      if (acceptedQuote?.id) {
        try {
          const { data: planItems } = await supabase
            .from('document_line_items')
            .select('*')
            .eq('document_id', acceptedQuote.id)
            .eq('item_type', 'service_plan');

          if (planItems && planItems.length > 0) {
            for (const item of planItems) {
              const meta = item.metadata || {};
              const templateId = meta.plan_template_id;
              if (!templateId) continue;

              const planPrice = item.unit_price || item.total || 0;
              const billingCycle = meta.billing_cycle || 'yearly';
              const initialStatus = hasCard ? 'active' : 'pending_payment_method';

              try {
                const { data: newPlan } = await supabase
                  .from('customer_service_plans')
                  .insert({
                    customer_id:          customerId,
                    plan_id:              templateId,
                    installed_system_id:  installedSystemId,
                    source:               'quote',
                    source_quote_id:      acceptedQuote.id,
                    status:               initialStatus,
                    billing_cycle:        billingCycle,
                    price:                planPrice,
                    start_date:           todayDate,
                    billing_start_date:   hasCard ? todayDate : null,
                    next_billing_date:    hasCard ? todayDate : null,
                    activated_at:         hasCard ? nowISO : null,
                  })
                  .select('id')
                  .single();

                if (newPlan) {
                  activatedPlans.push({ id: newPlan.id, source: 'quote', template_id: templateId, status: initialStatus });
                }
              } catch (insertErr) {
                // 23505 = unique constraint violation — plan already exists, skip
                if (insertErr.code === '23505') {
                  console.log(`[complete.js] Service plan already exists for template ${templateId}, skipping`);
                } else {
                  console.error('[BEST-EFFORT] quote service plan insert:', insertErr.message);
                }
              }
            }
          }
        } catch (e) {
          console.error('[BEST-EFFORT] quote service plan lookup:', e.message);
        }
      }

      // ── B) Auto-enroll service plans ───────────────────────────────
      // Find templates where auto_activate_on_install = true
      // and the installed system's category matches applies_to_categories (or [] = all)
      try {
        const { data: autoTemplates } = await supabase
          .from('service_plans')
          .select('id, name, billing_cycle, price, fulfillment_type, fulfillment_interval_months, applies_to_categories')
          .eq('is_active', true)
          .eq('auto_activate_on_install', true);

        if (autoTemplates && autoTemplates.length > 0) {
          const systemCategory = job.system_type || product?.category || 'unknown';

          for (const tmpl of autoTemplates) {
            // Check category match: empty array = all categories
            const cats = Array.isArray(tmpl.applies_to_categories) ? tmpl.applies_to_categories : [];
            if (cats.length > 0 && !cats.includes(systemCategory)) {
              continue; // category doesn't match
            }

            // Skip if already activated from quote path above
            if (activatedPlans.some(ap => ap.template_id === tmpl.id)) {
              continue;
            }

            const initialStatus = hasCard ? 'active' : 'pending_payment_method';
            const planPrice = parseFloat(tmpl.price) || 0;

            // Calculate next fulfillment date
            let nextFulfillment = null;
            if (tmpl.fulfillment_type === 'tech_visit' || tmpl.fulfillment_type === 'shipment') {
              if (tmpl.fulfillment_interval_months) {
                const fd = new Date();
                fd.setMonth(fd.getMonth() + tmpl.fulfillment_interval_months);
                nextFulfillment = fd.toISOString().split('T')[0];
              }
            }

            try {
              const { data: newPlan } = await supabase
                .from('customer_service_plans')
                .insert({
                  customer_id:          customerId,
                  plan_id:              tmpl.id,
                  installed_system_id:  installedSystemId,
                  source:               'auto_install',
                  source_quote_id:      null,
                  status:               initialStatus,
                  billing_cycle:        tmpl.billing_cycle,
                  price:                planPrice,
                  start_date:           todayDate,
                  billing_start_date:   hasCard ? todayDate : null,
                  next_billing_date:    hasCard ? todayDate : null,
                  next_fulfillment_date: nextFulfillment,
                  next_service:         nextFulfillment,
                  activated_at:         hasCard ? nowISO : null,
                })
                .select('id')
                .single();

              if (newPlan) {
                activatedPlans.push({ id: newPlan.id, source: 'auto_install', template_id: tmpl.id, status: initialStatus, name: tmpl.name });
              }
            } catch (insertErr) {
              if (insertErr.code === '23505') {
                console.log(`[complete.js] Auto-enroll plan already exists for template ${tmpl.id}, skipping`);
              } else {
                console.error('[BEST-EFFORT] auto-enroll plan insert:', insertErr.message);
              }
            }
          }
        }
      } catch (e) {
        console.error('[BEST-EFFORT] auto-enroll template lookup:', e.message);
      }

      // ── Activity logs for activated plans ──────────────────────────
      for (const ap of activatedPlans) {
        try {
          await supabase.from('customer_activity_log').insert({
            customer_id: customerId,
            event_type:  ap.status === 'active' ? 'service_plan_activated' : 'service_plan_added',
            title:       `Service plan ${ap.status === 'active' ? 'activated' : 'added (card required)'}: ${ap.name || 'from quote'}`,
            actor_id:    null,
            actor_name:  'System',
            metadata: {
              plan_id:     ap.id,
              template_id: ap.template_id,
              source:      ap.source,
              status:      ap.status,
            },
          });
        } catch (e) { /* best effort */ }
      }
    }

    // ── 8. Job activity log ───────────────────────────────────────────
    if (!alreadyComplete) {
      try {
        await supabase.from('job_activity_log').insert({
          job_id,
          event_type: 'job_completed',
          title: 'Job marked complete',
          metadata: {
            completed_by:        completed_by || null,
            install_fee:         installFee,
            installed_system_id: installedSystemId,
            customer_id:         customerId,
            ownership_type:      ownershipType,
            ownership_source:    ownershipSource,
            service_plans_activated: activatedPlans.length,
          },
          actor_id:   completed_by || 'system',
          actor_name: null,
        });
      } catch(e) { console.error('[BEST-EFFORT] job_activity_log:', e.message); }

      // ── 8b. Customer activity log ───────────────────────────────────
      if (customerId) {
        try {
          await supabase.from('customer_activity_log').insert({
            customer_id: customerId,
            event_type:  'system_installed',
            title:       'System installed',
            actor_id:    null,
            actor_name:  'Zenith Installer',
            metadata: {
              job_id,
              installed_system_id: installedSystemId,
              install_fee:         installFee,
              ownership_type:      ownershipType,
              ownership_source:    ownershipSource,
              system_type:         job.system_type || null,
              service_plans_activated: activatedPlans.length,
            },
          });
        } catch(e) { console.error('[BEST-EFFORT] customer_activity_log:', e.message); }
      }
    }

    // ── 9. Skip charge if no customer or no fee ───────────────────────
    if (!customerId || installFee <= 0) {
      return res.status(200).json({
        success:              true,
        job_completed:        true,
        installed_system_id:  installedSystemId,
        ownership_type:       ownershipType,
        ownership_source:     ownershipSource,
        charge_status:        installFee <= 0 ? 'no_fee' : 'no_customer',
        install_fee:          installFee,
        service_plans:        activatedPlans,
      });
    }

    // ── 10. Double-charge guard ───────────────────────────────────────
    const { data: existingCharge } = await supabase
      .from('payment_transactions')
      .select('id')
      .eq('customer_id', customerId)
      .eq('type', 'install_fee')
      .eq('status', 'succeeded')
      .maybeSingle();

    if (existingCharge) {
      return res.status(200).json({
        success:             true,
        job_completed:       true,
        installed_system_id: installedSystemId,
        ownership_type:      ownershipType,
        ownership_source:    ownershipSource,
        charge_status:       'already_charged',
        charge_details:      { reason: 'Install fee already charged for this customer' },
        service_plans:       activatedPlans,
      });
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('id, stripe_customer_id, full_name, email')
      .eq('id', customerId)
      .single();

    if (!customer?.stripe_customer_id) {
      return res.status(200).json({
        success:             true,
        job_completed:       true,
        installed_system_id: installedSystemId,
        ownership_type:      ownershipType,
        ownership_source:    ownershipSource,
        charge_status:       'skipped',
        charge_details:      { reason: 'No Stripe customer ID' },
        install_fee:         installFee,
        service_plans:       activatedPlans,
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
        success:             true,
        job_completed:       true,
        installed_system_id: installedSystemId,
        ownership_type:      ownershipType,
        ownership_source:    ownershipSource,
        charge_status:       'skipped',
        charge_details:      { reason: 'No payment method on file' },
        install_fee:         installFee,
        service_plans:       activatedPlans,
      });
    }

    // ── 11. Stripe charge ─────────────────────────────────────────────
    let chargeResult = {};
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount:         Math.round(installFee * 100),
        currency:       'usd',
        customer:       customer.stripe_customer_id,
        payment_method: paymentMethod.external_id,
        off_session:    true,
        confirm:        true,
        description:    `Install fee — Job ${job_id}`,
        metadata:       { job_id, customer_id: customerId, type: 'install_fee' },
      });

      await supabase.from('payment_transactions').insert({
        customer_id:       customerId,
        payment_method_id: paymentMethod.id,
        amount:            installFee,
        status:            paymentIntent.status === 'succeeded' ? 'succeeded' : 'pending',
        type:              'install_fee',
        external_id:       paymentIntent.id,
        description:       `Installation fee — ${customer.full_name || 'Customer'}`,
        attempted_at:      new Date().toISOString(),
        completed_at:      paymentIntent.status === 'succeeded' ? new Date().toISOString() : null,
      });

      chargeResult = {
        status:            paymentIntent.status === 'succeeded' ? 'charged' : 'pending',
        amount:            installFee,
        payment_intent_id: paymentIntent.id,
        last_four:         paymentMethod.last_four,
      };
    } catch (stripeErr) {
      await supabase.from('payment_transactions').insert({
        customer_id:       customerId,
        payment_method_id: paymentMethod.id,
        amount:            installFee,
        status:            'failed',
        type:              'install_fee',
        description:       `Installation fee FAILED — ${customer.full_name || 'Customer'}`,
        attempted_at:      new Date().toISOString(),
        failure_reason:    stripeErr.message,
      });

      chargeResult = { status: 'failed', error: stripeErr.message, amount: installFee };
    }

    return res.status(200).json({
      success:             true,
      job_completed:       true,
      installed_system_id: installedSystemId,
      ownership_type:      ownershipType,
      ownership_source:    ownershipSource,
      charge_status:       chargeResult.status,
      charge_details:      chargeResult,
      service_plans:       activatedPlans,
    });

  } catch (err) {
    console.error('complete install error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
};
