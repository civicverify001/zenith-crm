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

// FIX: removed inline sendSms (was calling OpenPhone API directly with phone number string
// instead of phone number ID — caused 400 errors). Now routes through send-sms.js which
// correctly resolves the phone number ID first.
const GOOGLE_REVIEW_URL = process.env.GOOGLE_REVIEW_URL || ''
const APP_URL = process.env.VITE_APP_URL || 'https://zenith-crm-ten.vercel.app'

async function sendSms(to, message, customerId) {
  if (!to) return
  try {
    await fetch(`${APP_URL}/api/openphone/send-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to, body: message,
        entity_type: 'customer', entity_id: customerId,
      }),
    })
  } catch (e) { console.error('[complete] sendSms error:', e.message) }
}

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

    const alreadyComplete = job.status === 'complete';

    // ── 2. Customer lookup — two layers ──────────────────────────────
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
    let acceptedQuote = null;
    let installFee = 0;
    let monthlyAmount = null;
    let ownershipType = 'purchased';
    let ownershipSource = 'default';

    if (job.lead_id) {
      const { data: q, error: q1Err } = await supabase
        .from('quotes')
        .select('id, install_fee, monthly_amount, customer_name, commercial_type')
        .or(`lead_id.eq.${job.lead_id},opportunity_id.eq.${job.lead_id}`)
        .in('status', ['accepted', 'signed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      console.log('[COMPLETE][S3] Layer 1 quote by lead_id:', q?.id || 'none', 'error:', q1Err?.message || 'none');
      if (q) { acceptedQuote = q; ownershipSource = 'quote_lead_id'; }
    }

    if (!acceptedQuote && customerId) {
      const { data: q, error: q2Err } = await supabase
        .from('quotes')
        .select('id, install_fee, monthly_amount, customer_name, commercial_type')
        .eq('customer_id', customerId)
        .in('status', ['accepted', 'signed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      console.log('[COMPLETE][S3] Layer 2 quote by customer_id:', q?.id || 'none', 'error:', q2Err?.message || 'none');
      if (q) { acceptedQuote = q; ownershipSource = 'quote_customer_id'; }
    }

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

    let fallbackQuoteId = null;
    if (!acceptedQuote && customerId) {
      const { data: ag } = await supabase
        .from('agreements')
        .select('agreement_type, monthly_amount, install_fee, quote_id')
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
        if (ag.quote_id) fallbackQuoteId = ag.quote_id;
        console.log('[COMPLETE][S3] Layer 3 agreement found: type=' + ag.agreement_type + ', quote_id=' + (ag.quote_id || 'none'));
      }
    }

    if (ownershipSource === 'default' && customerId) {
      const { data: con } = await supabase
        .from('contracts')
        .select('type, monthly_amount, quote_id')
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
        if (con.quote_id && !fallbackQuoteId) fallbackQuoteId = con.quote_id;
        console.log('[COMPLETE][S3] Layer 4 contract found: type=' + con.type + ', quote_id=' + (con.quote_id || 'none'));
      }
    }

    console.log('[COMPLETE][S3] Ownership resolved: type=' + ownershipType + ', source=' + ownershipSource + ', installFee=' + installFee + ', acceptedQuote=' + (acceptedQuote?.id || 'none') + ', fallbackQuoteId=' + (fallbackQuoteId || 'none'));

    // ── 4. Get product info — from quote line items ─────────────────
    let product = null;
    let quotedUnitPrice = null;
    const quoteIdForLookup = acceptedQuote?.id || fallbackQuoteId;

    console.log('[COMPLETE][S4] Starting product lookup. acceptedQuote:', acceptedQuote?.id || 'none', 'fallbackQuoteId:', fallbackQuoteId || 'none', 'using:', quoteIdForLookup || 'NONE');

    if (quoteIdForLookup) {
      const { data: productLineItem, error: pliErr } = await supabase
        .from('document_line_items')
        .select('product_id, description, sku, unit_price')
        .eq('document_id', quoteIdForLookup)
        .eq('item_type', 'product')
        .order('sort_order', { ascending: true })
        .limit(1)
        .maybeSingle();

      console.log('[COMPLETE][S4] document_line_items query result:', JSON.stringify(productLineItem), 'error:', pliErr?.message || 'none');

      if (productLineItem?.unit_price) {
        quotedUnitPrice = parseFloat(productLineItem.unit_price);
      }

      if (productLineItem?.product_id) {
        console.log('[COMPLETE][S4] Found product_id on line item:', productLineItem.product_id, '— querying products table');
        const { data: prod, error: prodErr } = await supabase
          .from('products')
          .select('id, name, sku, retail_price, warranty_months, category')
          .eq('id', productLineItem.product_id)
          .maybeSingle();

        console.log('[COMPLETE][S4] Products table result:', JSON.stringify(prod), 'error:', prodErr?.message || 'none');
        product = prod;
      } else if (productLineItem) {
        console.log('[COMPLETE][S4] Line item found but no product_id — using description:', productLineItem.description?.substring(0, 60));
        product = {
          id: null,
          name: productLineItem.description?.split('\n')[0]?.trim() || 'Installed System',
          sku: productLineItem.sku || null,
          retail_price: productLineItem.unit_price || null,
          warranty_months: null,
          category: null,
        };
      } else {
        console.log('[COMPLETE][S4] No product line items found for quote:', quoteIdForLookup);
      }
    } else {
      console.log('[COMPLETE][S4] No quote ID available for product lookup — will use system_type fallback');
    }

    console.log('[COMPLETE][S4] Final product resolved:', product ? `${product.name} (id=${product.id})` : 'NONE — will use system_type fallback', '| quotedUnitPrice:', quotedUnitPrice || 'none');

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

    // ── 5b. Set job_id + activate lifecycle on customer record ──────────
    if (customerId) {
      await supabase
        .from('customers')
        .update({ lifecycle_status: 'active' })
        .eq('id', customerId);
    }

    // ── 5c. Set billing_day + retail_price_snapshot on active contract ─
    if (customerId) {
      const billingDay = new Date().getDate();
      try {
        await supabase
          .from('contracts')
          .update({
            billing_day: billingDay,
            retail_price_snapshot: product?.retail_price ? parseFloat(product.retail_price) : null,
          })
          .eq('customer_id', customerId)
          .eq('status', 'active');
      } catch(e) { console.error('[BEST-EFFORT] billing_day + retail_price update:', e.message); }
    }

    // ── 5d. Move lead to 'won' ────────────────────────────────────────
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

    const retailPriceForSnapshot = ownershipType === 'rented'
      ? (product?.retail_price ? parseFloat(product.retail_price) : null)
      : (quotedUnitPrice || (product?.retail_price ? parseFloat(product.retail_price) : null));

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
        const { error: updateSysErr } = await supabase
          .from('installed_systems')
          .update({
            ownership_type:          ownershipType,
            install_fee_snapshot:    installFee || null,
            monthly_amount_snapshot: monthlyAmount,
            name_snapshot:           product?.name || nameMap[job.system_type] || job.system_type?.replace(/_/g, ' ') || 'Installed System',
            sku_snapshot:            product?.sku || null,
            retail_price_snapshot:   retailPriceForSnapshot,
          })
          .eq('id', existingRow.id);

        if (updateSysErr) {
          console.error('[COMPLETE][S6] UPDATE installed_systems FAILED:', updateSysErr.message);
        } else {
          console.log(
            `[COMPLETE][S6] UPDATED installed_system ${existingRow.id}:`,
            `ownership=${ownershipType} (was ${existingRow.ownership_type}),`,
            `product=${product?.name || 'none'},`,
            `source=${ownershipSource},`,
            `retail_price_snapshot=${retailPriceForSnapshot}`
          );
        }

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
            retail_price_snapshot:   retailPriceForSnapshot,
            install_fee_snapshot:    installFee || null,
            monthly_amount_snapshot: monthlyAmount,
            is_active:               true,
            job_id:                  job_id,
          })
          .select('id')
          .single();

        if (!sysError && sysRecord) {
          installedSystemId = sysRecord.id;
          console.log(`[COMPLETE][S6] INSERTED installed_system ${sysRecord.id}: ownership=${ownershipType}, product=${product?.name || 'fallback'}, retail_price_snapshot=${retailPriceForSnapshot}`);
        } else {
          console.error('[COMPLETE][S6] INSERT installed_systems FAILED:', sysError?.message);
        }

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
    const activatedPlans = [];

    if (customerId && installedSystemId && !alreadyComplete) {
      const todayDate = new Date().toISOString().split('T')[0];
      const nowISO = new Date().toISOString();

      const { data: pmCheck } = await supabase
        .from('payment_methods')
        .select('id')
        .eq('customer_id', customerId)
        .eq('is_default', true)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      const hasCard = !!pmCheck;

      console.log('[COMPLETE][S7b] Starting service plan activation. customerId:', customerId, 'hasCard:', hasCard, 'acceptedQuote:', acceptedQuote?.id || 'none');

      // ── A) Quote-origin service plans ──────────────────────────────
      const planQuoteId = acceptedQuote?.id || fallbackQuoteId;
      if (planQuoteId) {
        try {
          const { data: planItems, error: planItemsErr } = await supabase
            .from('document_line_items')
            .select('*')
            .eq('document_id', planQuoteId)
            .eq('item_type', 'service_plan');

          console.log('[COMPLETE][S7b-A] Plan line items found:', planItems?.length || 0, 'error:', planItemsErr?.message || 'none');

          if (planItems && planItems.length > 0) {
            const { data: allTemplates } = await supabase
              .from('service_plans')
              .select('id, name, billing_cycle, price, fulfillment_type, fulfillment_interval_months')
              .eq('is_active', true);

            console.log('[COMPLETE][S7b-A] Active templates loaded:', allTemplates?.length || 0);

            for (const item of planItems) {
              const itemPrice = parseFloat(item.unit_price) || 0;
              const itemDesc = (item.description || '').toLowerCase().trim();
              let matchedTemplate = null;
              let matchMethod = 'none';

              console.log('[COMPLETE][S7b-A] Matching line item: desc="' + item.description + '", price=' + itemPrice);

              if (allTemplates && allTemplates.length > 0) {
                for (const t of allTemplates) {
                  const tName = (t.name || '').toLowerCase().trim();
                  if (tName.length >= 3 && itemDesc.includes(tName)) {
                    matchedTemplate = t; matchMethod = 'desc_contains_template_name'; break;
                  }
                  const itemDescMain = itemDesc.split(/[—\-–]/)[0].trim();
                  if (itemDescMain.length >= 3 && tName.includes(itemDescMain)) {
                    matchedTemplate = t; matchMethod = 'template_name_contains_desc'; break;
                  }
                  const commonWords = new Set(['plan', 'service', 'monthly', 'annual', 'the', 'a', 'for', 'and', 'or', 'per', 'mo']);
                  const tWords = tName.split(/\s+/).filter(w => w.length > 2 && !commonWords.has(w));
                  const dWords = itemDescMain.split(/\s+/).filter(w => w.length > 2 && !commonWords.has(w));
                  const overlap = tWords.filter(w => dWords.some(dw => dw.includes(w) || w.includes(dw)));
                  if (overlap.length >= 2) {
                    matchedTemplate = t; matchMethod = 'word_overlap(' + overlap.join(',') + ')'; break;
                  }
                }
                if (!matchedTemplate) {
                  matchedTemplate = allTemplates.find(t => parseFloat(t.price) === itemPrice);
                  if (matchedTemplate) matchMethod = 'exact_price';
                }
              }

              if (!matchedTemplate) {
                console.log(`[COMPLETE][S7b-A] ⚠ NO MATCH for plan line item: price=${itemPrice}, desc="${item.description}".`);
                continue;
              }

              console.log(`[COMPLETE][S7b-A] ✓ MATCHED: "${item.description}" → template "${matchedTemplate.name}" (method: ${matchMethod})`);

              const templateId = matchedTemplate.id;
              const planPrice = itemPrice;
              const billingCycle = matchedTemplate.billing_cycle || 'monthly';
              const initialStatus = hasCard ? 'active' : 'pending_payment_method';

              let nextFulfillment = null;
              if (matchedTemplate.fulfillment_type === 'tech_visit' || matchedTemplate.fulfillment_type === 'shipment') {
                if (matchedTemplate.fulfillment_interval_months) {
                  const fd = new Date();
                  fd.setMonth(fd.getMonth() + matchedTemplate.fulfillment_interval_months);
                  nextFulfillment = fd.toISOString().split('T')[0];
                }
              }

              try {
                const { data: newPlan, error: planInsertErr } = await supabase
                  .from('customer_service_plans')
                  .insert({
                    customer_id:           customerId,
                    plan_id:               templateId,
                    installed_system_id:   installedSystemId,
                    source:                'quote',
                    source_quote_id:       planQuoteId,
                    status:                initialStatus,
                    billing_cycle:         billingCycle,
                    price:                 planPrice,
                    start_date:            todayDate,
                    billing_start_date:    hasCard ? todayDate : null,
                    next_billing_date:     hasCard ? todayDate : null,
                    next_fulfillment_date: nextFulfillment,
                    next_service:          nextFulfillment,
                    activated_at:          hasCard ? nowISO : null,
                  })
                  .select('id')
                  .single();

                if (planInsertErr) {
                  if (planInsertErr.code === '23505') {
                    console.log(`[COMPLETE][S7b-A] Plan already exists for template ${templateId}, skipping`);
                  } else {
                    console.error('[COMPLETE][S7b-A] Plan insert FAILED:', planInsertErr.message);
                  }
                } else if (newPlan) {
                  console.log(`[COMPLETE][S7b-A] ✓ Plan activated: id=${newPlan.id}`);
                  activatedPlans.push({ id: newPlan.id, source: 'quote', template_id: templateId, status: initialStatus, name: matchedTemplate.name });
                }
              } catch (insertErr) {
                if (insertErr.code !== '23505') console.error('[COMPLETE][S7b-A] plan insert error:', insertErr.message);
              }
            }
          }
        } catch (e) {
          console.error('[COMPLETE][S7b-A] Quote service plan lookup error:', e.message);
        }
      }

      // ── B) Auto-enroll service plans ───────────────────────────────
      try {
        const { data: autoTemplates } = await supabase
          .from('service_plans')
          .select('id, name, billing_cycle, price, fulfillment_type, fulfillment_interval_months, applies_to_categories')
          .eq('is_active', true)
          .eq('auto_activate_on_install', true);

        console.log('[COMPLETE][S7b-B] Auto-enroll templates found:', autoTemplates?.length || 0);

        if (autoTemplates && autoTemplates.length > 0) {
          const systemCategory = job.system_type || product?.category || 'unknown';

          for (const tmpl of autoTemplates) {
            const cats = Array.isArray(tmpl.applies_to_categories) ? tmpl.applies_to_categories : [];
            if (cats.length > 0 && !cats.includes(systemCategory)) continue;
            if (activatedPlans.some(ap => ap.template_id === tmpl.id)) continue;

            const initialStatus = hasCard ? 'active' : 'pending_payment_method';
            const planPrice = parseFloat(tmpl.price) || 0;

            let nextFulfillment = null;
            if (tmpl.fulfillment_type === 'tech_visit' || tmpl.fulfillment_type === 'shipment') {
              if (tmpl.fulfillment_interval_months) {
                const fd = new Date();
                fd.setMonth(fd.getMonth() + tmpl.fulfillment_interval_months);
                nextFulfillment = fd.toISOString().split('T')[0];
              }
            }

            try {
              const { data: newPlan, error: autoInsertErr } = await supabase
                .from('customer_service_plans')
                .insert({
                  customer_id:           customerId,
                  plan_id:               tmpl.id,
                  installed_system_id:   installedSystemId,
                  source:                'auto_install',
                  source_quote_id:       null,
                  status:                initialStatus,
                  billing_cycle:         tmpl.billing_cycle,
                  price:                 planPrice,
                  start_date:            todayDate,
                  billing_start_date:    hasCard ? todayDate : null,
                  next_billing_date:     hasCard ? todayDate : null,
                  next_fulfillment_date: nextFulfillment,
                  next_service:          nextFulfillment,
                  activated_at:          hasCard ? nowISO : null,
                })
                .select('id')
                .single();

              if (autoInsertErr) {
                if (autoInsertErr.code !== '23505') console.error(`[COMPLETE][S7b-B] Auto-enroll FAILED for "${tmpl.name}":`, autoInsertErr.message);
              } else if (newPlan) {
                activatedPlans.push({ id: newPlan.id, source: 'auto_install', template_id: tmpl.id, status: initialStatus, name: tmpl.name });
              }
            } catch (insertErr) {
              if (insertErr.code !== '23505') console.error('[COMPLETE][S7b-B] auto-enroll error:', insertErr.message);
            }
          }
        }
      } catch (e) {
        console.error('[COMPLETE][S7b-B] auto-enroll template lookup error:', e.message);
      }

      console.log('[COMPLETE][S7b] Plan activation complete. Total activated:', activatedPlans.length);

      for (const ap of activatedPlans) {
        try {
          await supabase.from('customer_activity_log').insert({
            customer_id: customerId,
            event_type:  ap.status === 'active' ? 'service_plan_activated' : 'service_plan_added',
            title:       `Service plan ${ap.status === 'active' ? 'activated' : 'added (card required)'}: ${ap.name || 'from quote'}`,
            actor_id:    null, actor_name: 'System',
            metadata: { plan_id: ap.id, template_id: ap.template_id, source: ap.source, status: ap.status },
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
            completed_by, install_fee: installFee,
            installed_system_id: installedSystemId, customer_id: customerId,
            ownership_type: ownershipType, ownership_source: ownershipSource,
            product_name: product?.name || null, product_sku: product?.sku || null,
            service_plans_activated: activatedPlans.length,
          },
          actor_id: completed_by || 'system', actor_name: null,
        });
      } catch(e) { console.error('[BEST-EFFORT] job_activity_log:', e.message); }

      if (customerId) {
        try {
          await supabase.from('customer_activity_log').insert({
            customer_id: customerId,
            event_type: 'system_installed',
            title: `System installed: ${product?.name || job.system_type || 'System'}`,
            actor_id: null, actor_name: 'Zenith Installer',
            metadata: {
              job_id, installed_system_id: installedSystemId, install_fee: installFee,
              ownership_type: ownershipType, ownership_source: ownershipSource,
              system_type: job.system_type || null,
              product_name: product?.name || null, product_sku: product?.sku || null,
              service_plans_activated: activatedPlans.length,
            },
          });
        } catch(e) { console.error('[BEST-EFFORT] customer_activity_log:', e.message); }
      }
    }

    // ── GAP 14: Auto-create post-install follow-up ───────────────
    if (customerId && !alreadyComplete) {
      try {
        const followUpDate = new Date(Date.now() + 24 * 60 * 60 * 1000)
        const customerNameForFU = product?.name
          ? `${job.customer_name_snapshot || 'Customer'} (${product.name})`
          : (job.customer_name_snapshot || 'Customer')
        await supabase.from('follow_up_tasks').insert({
          entity_type: 'customer', entity_id: customerId,
          title: `Post-install check-in: ${customerNameForFU}`,
          description: `Installation completed. Follow up to ensure satisfaction, answer questions, and confirm system is working properly.`,
          due_date: followUpDate.toISOString().split('T')[0],
          status: 'pending', priority: 'normal',
        })
      } catch (_) { /* fire-and-forget */ }
    }

    // ── Install confirmation email (fire-and-forget) ──────────────────
    // FIX: new — sends branded install complete email with warranty + service plan info
    if (customerId && !alreadyComplete) {
      try {
        fetch(`${APP_URL}/api/email/send-install-complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId,
            jobId: job_id,
            productName: product?.name || null,
            ownershipType,
            activatedPlans: activatedPlans.map(p => p.name),
          }),
        }).catch(() => {})
      } catch (_) {}
    }

    // ── SMS: Install complete + Google review (fire-and-forget) ──────
    // FIX: now routes through /api/openphone/send-sms (resolves phone number ID correctly)
    if (customerId && !alreadyComplete) {
      try {
        const { data: smsCustomer } = await supabase
          .from('customers').select('phone, full_name').eq('id', customerId).maybeSingle()
        if (smsCustomer?.phone) {
          const firstName = (smsCustomer.full_name || 'there').split(' ')[0]
          const msg = GOOGLE_REVIEW_URL
            ? `Hi ${firstName}, your water system installation is complete! Welcome to the Zenith family 💧 We'd love a quick Google review: ${GOOGLE_REVIEW_URL}`
            : `Hi ${firstName}, your water system installation is complete! Welcome to the Zenith family 💧 — Zenith Pure Solutions`
          await sendSms(smsCustomer.phone, msg, customerId)
        }
      } catch (_) { /* fire-and-forget */ }
    }

    // ── Schedule 24hr review email (picked up by quote-followup cron) ─
    if (customerId && !alreadyComplete) {
      const reviewSendAfter = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      supabase.from('jobs')
        .update({ review_email_send_after: reviewSendAfter })
        .eq('id', job_id)
        .then(() => {}).catch(() => {})
    }

    // ── 9. Skip charge if no customer or no fee ───────────────────────
    if (!customerId || installFee <= 0) {
      return res.status(200).json({
        success: true, job_completed: true,
        installed_system_id: installedSystemId,
        ownership_type: ownershipType, ownership_source: ownershipSource,
        charge_status: installFee <= 0 ? 'no_fee' : 'no_customer',
        install_fee: installFee, service_plans: activatedPlans,
      });
    }

    // ── 10. Double-charge guard ───────────────────────────────────────
    const { data: existingCharge } = await supabase
      .from('payment_transactions').select('id')
      .eq('customer_id', customerId).eq('type', 'install_fee').eq('status', 'succeeded').maybeSingle();

    if (existingCharge) {
      return res.status(200).json({
        success: true, job_completed: true,
        installed_system_id: installedSystemId,
        ownership_type: ownershipType, ownership_source: ownershipSource,
        charge_status: 'already_charged',
        charge_details: { reason: 'Install fee already charged for this customer' },
        service_plans: activatedPlans,
      });
    }

    const { data: customer } = await supabase
      .from('customers').select('id, stripe_customer_id, full_name, email')
      .eq('id', customerId).single();

    if (!customer?.stripe_customer_id) {
      return res.status(200).json({
        success: true, job_completed: true,
        installed_system_id: installedSystemId,
        ownership_type: ownershipType, ownership_source: ownershipSource,
        charge_status: 'skipped',
        charge_details: { reason: 'No Stripe customer ID' },
        install_fee: installFee, service_plans: activatedPlans,
      });
    }

    const { data: paymentMethod } = await supabase
      .from('payment_methods').select('id, external_id, last_four')
      .eq('customer_id', customerId).eq('is_default', true).eq('status', 'active').limit(1).maybeSingle();

    if (!paymentMethod?.external_id) {
      return res.status(200).json({
        success: true, job_completed: true,
        installed_system_id: installedSystemId,
        ownership_type: ownershipType, ownership_source: ownershipSource,
        charge_status: 'skipped',
        charge_details: { reason: 'No payment method on file' },
        install_fee: installFee, service_plans: activatedPlans,
      });
    }

    // ── 11. Stripe charge ─────────────────────────────────────────────
    let chargeResult = {};
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(installFee * 100), currency: 'usd',
        customer: customer.stripe_customer_id,
        payment_method: paymentMethod.external_id,
        off_session: true, confirm: true,
        description: `Install fee — Job ${job_id}`,
        metadata: { job_id, customer_id: customerId, type: 'install_fee' },
      });

      await supabase.from('payment_transactions').insert({
        customer_id: customerId, payment_method_id: paymentMethod.id,
        amount: installFee,
        status: paymentIntent.status === 'succeeded' ? 'succeeded' : 'pending',
        type: 'install_fee', external_id: paymentIntent.id,
        description: `Installation fee — ${customer.full_name || 'Customer'}`,
        attempted_at: new Date().toISOString(),
        completed_at: paymentIntent.status === 'succeeded' ? new Date().toISOString() : null,
      });

      chargeResult = {
        status: paymentIntent.status === 'succeeded' ? 'charged' : 'pending',
        amount: installFee, payment_intent_id: paymentIntent.id,
        last_four: paymentMethod.last_four,
      };
    } catch (stripeErr) {
      await supabase.from('payment_transactions').insert({
        customer_id: customerId, payment_method_id: paymentMethod.id,
        amount: installFee, status: 'failed', type: 'install_fee',
        description: `Installation fee FAILED — ${customer.full_name || 'Customer'}`,
        attempted_at: new Date().toISOString(), failure_reason: stripeErr.message,
      });
      chargeResult = { status: 'failed', error: stripeErr.message, amount: installFee };
    }

    return res.status(200).json({
      success: true, job_completed: true,
      installed_system_id: installedSystemId,
      ownership_type: ownershipType, ownership_source: ownershipSource,
      charge_status: chargeResult.status, charge_details: chargeResult,
      service_plans: activatedPlans,
    });

  } catch (err) {
    console.error('complete install error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
};
