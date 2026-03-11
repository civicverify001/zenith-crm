// api/stripe/webhook.js
// Handles Stripe webhook events after checkout completes
// Wires: payment_methods, payment_transactions, contracts (active), invoices (paid)
// NEW: Step 6 — inventory commitment (creates job + reserves stock)

import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
})

export const config = { api: { bodyParser: false } }

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const sig = req.headers['stripe-signature']
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  let event
  try {
    const rawBody = await getRawBody(req)
    event = webhookSecret
      ? stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
      : JSON.parse(rawBody.toString())
  } catch (err) {
    console.error('Webhook signature error:', err.message)
    return res.status(400).json({ error: `Webhook Error: ${err.message}` })
  }

  // ── Only handle checkout.session.completed ────────────────────
  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true })
  }

  const session = event.data.object
  const meta = session.metadata || {}
  const {
    quote_id,
    customer_id,
    quote_type,
    agreement_id,
    invoice_id,
  } = meta

  const now = new Date().toISOString()

  try {
    // ── 1. Get the payment intent to retrieve payment method ──────
    let stripePaymentMethodId = null
    let last4 = null
    let expMonth = null
    let expYear = null
    let brand = null

    if (session.payment_intent) {
      const pi = await stripe.paymentIntents.retrieve(session.payment_intent, {
        expand: ['payment_method'],
      })

      if (pi.payment_method && typeof pi.payment_method === 'object') {
        const pm = pi.payment_method
        stripePaymentMethodId = pm.id
        last4 = pm.card?.last4 || null
        expMonth = pm.card?.exp_month || null
        expYear = pm.card?.exp_year || null
        brand = pm.card?.brand || null

        // Attach PM to Stripe customer if not already attached
        if (pm.customer !== session.customer) {
          try {
            await stripe.paymentMethods.attach(pm.id, { customer: session.customer })
          } catch (_) {
            // already attached — ignore
          }
        }

        // Set as default payment method on Stripe customer
        try {
          await stripe.customers.update(session.customer, {
            invoice_settings: { default_payment_method: pm.id },
          })
        } catch (_) {}
      }
    }

    // For setup mode (rental card save), get the setup intent PM
    if (session.setup_intent && !stripePaymentMethodId) {
      try {
        const si = await stripe.setupIntents.retrieve(session.setup_intent, {
          expand: ['payment_method'],
        })
        if (si.payment_method && typeof si.payment_method === 'object') {
          const pm = si.payment_method
          stripePaymentMethodId = pm.id
          last4 = pm.card?.last4 || null
          expMonth = pm.card?.exp_month || null
          expYear = pm.card?.exp_year || null
          brand = pm.card?.brand || null
        }
      } catch (_) {}
    }

    // ── 2. Save payment method to payment_methods table ───────────
    let savedPmId = null
    if (stripePaymentMethodId && customer_id) {
      // Clear existing default
      await supabase
        .from('payment_methods')
        .update({ is_default: false })
        .eq('customer_id', customer_id)

      const { data: savedPm } = await supabase
        .from('payment_methods')
        .insert({
          customer_id,
          type: 'card',
          provider: 'stripe',
          external_id: stripePaymentMethodId,
          last_four: last4,
          exp_month: expMonth,
          exp_year: expYear,
          is_default: true,
          status: 'active',
          created_at: now,
          updated_at: now,
        })
        .select()
        .single()

      savedPmId = savedPm?.id || null

      // Also save stripe_customer_id on the customer record
      if (session.customer) {
        await supabase
          .from('customers')
          .update({ stripe_customer_id: session.customer })
          .eq('id', customer_id)
      }
    }

    // ── 3. Log payment transaction ────────────────────────────────
    const amountDollars = (session.amount_total || 0) / 100

    await supabase.from('payment_transactions').insert({
      customer_id,
      contract_id: agreement_id || null,
      payment_method_id: savedPmId,
      amount: amountDollars,
      status: 'succeeded',
      type: quote_type === 'rental' ? 'first_month' : 'deposit',
      external_id: session.payment_intent || session.id,
      description: quote_type === 'rental'
        ? `First month rental payment`
        : `Purchase deposit (50%)`,
      attempted_at: now,
      completed_at: now,
    })

    // ── 4. Activate contract (rental) or mark invoice paid ────────
    if (quote_type === 'rental' && agreement_id) {
      // Find contract linked to this agreement
      const { data: contract } = await supabase
        .from('contracts')
        .select('id')
        .eq('quote_id', quote_id)
        .single()

      if (contract) {
        await supabase
          .from('contracts')
          .update({ status: 'active', updated_at: now })
          .eq('id', contract.id)

        // Log to audit trail
        await supabase.from('document_audit_log').insert({
          entity_type: 'contract',
          entity_id: contract.id,
          event: 'contract_activated',
          actor_type: 'system',
          metadata: {
            trigger: 'stripe_payment',
            session_id: session.id,
            amount: amountDollars,
          },
        })
      }

      // Mark agreement as active
      await supabase
        .from('agreements')
        .update({ status: 'active', updated_at: now })
        .eq('id', agreement_id)

    } else if (quote_type === 'purchase' && invoice_id) {
      await supabase
        .from('invoices')
        .update({
          status: 'paid',
          amount_paid: amountDollars,
          paid_at: now,
          updated_at: now,
        })
        .eq('id', invoice_id)

      await supabase.from('document_audit_log').insert({
        entity_type: 'invoice',
        entity_id: invoice_id,
        event: 'deposit_paid',
        actor_type: 'system',
        metadata: {
          trigger: 'stripe_payment',
          session_id: session.id,
          amount: amountDollars,
        },
      })
    }

    // ── 5. Log to email_log (receipt placeholder) ─────────────────
    if (customer_id) {
      const { data: cust } = await supabase
        .from('customers')
        .select('email, full_name')
        .eq('id', customer_id)
        .single()

      if (cust?.email) {
        await supabase.from('email_log').insert({
          customer_id,
          email_type: 'payment_receipt',
          to_address: cust.email,
          subject: quote_type === 'rental'
            ? 'Payment Received — Zenith Pure Solutions'
            : 'Deposit Received — Zenith Pure Solutions',
          status: 'queued',
          document_id: agreement_id || invoice_id || null,
          created_at: now,
        })
      }
    }

    // ── 6. INVENTORY: Create/find job + commit for fulfillment ────
    // This is the fulfillment trigger point.
    // Conditions already met by reaching here:
    //   - Rental: agreement signed + card saved (setup mode completed)
    //   - Purchase: payment confirmed (payment mode completed)
    //
    // We create a job with source_quote_id frozen to the exact quote,
    // then run inventory commitment (reserve stock or create demand).
    // ──────────────────────────────────────────────────────────────

    if (quote_id && customer_id) {
      try {
        // Check if a job already exists for this quote
        let jobId = null

        const { data: existingJob } = await supabase
          .from('jobs')
          .select('id')
          .eq('source_quote_id', quote_id)
          .limit(1)
          .maybeSingle()

        if (existingJob) {
          jobId = existingJob.id
        } else {
          // Load quote for job creation data
          const { data: quote } = await supabase
            .from('quotes')
            .select('id, customer_name, system_type, opportunity_id')
            .eq('id', quote_id)
            .single()

          if (quote) {
            // Load customer address for service_address_snapshot
            const { data: custData } = await supabase
              .from('customers')
              .select('full_name, phone, email, address, city, state, zip')
              .eq('id', customer_id)
              .single()

            const serviceAddress = custData
              ? [custData.address, custData.city, custData.state, custData.zip].filter(Boolean).join(', ')
              : ''

            // Create job with source_quote_id — the frozen link
            const { data: newJob, error: jobErr } = await supabase
              .from('jobs')
              .insert({
                lead_id: quote.opportunity_id || null,
                customer_name_snapshot: custData?.full_name || quote.customer_name || 'Customer',
                service_address_snapshot: serviceAddress,
                phone_snapshot: custData?.phone || null,
                email_snapshot: custData?.email || null,
                system_type: quote.system_type || null,
                source_quote_id: quote_id,
                status: 'scheduled',
                inventory_status: 'pending_check',
                created_at: now,
              })
              .select('id')
              .single()

            if (jobErr) {
              console.error('Job creation failed:', jobErr.message)
            } else {
              jobId = newJob.id
            }

            // Log audit
            await supabase.from('document_audit_log').insert({
              entity_type: 'job',
              entity_id: jobId,
              event: 'job_created_from_fulfillment',
              actor_type: 'system',
              metadata: {
                trigger: 'stripe_webhook',
                quote_id,
                quote_type,
                session_id: session.id,
              },
            }).then(() => {}).catch(() => {})
          }
        }

        // Run inventory commitment (idempotent — safe to call on retry)
        if (jobId) {
          const invResult = await commitForFulfillmentWebhook(supabase, jobId)
          console.log('Inventory commitment:', { jobId, ...invResult })
        }

      } catch (invErr) {
        // Inventory errors must NOT block the webhook response.
        // The deal is committed regardless — inventory is operational, not transactional.
        console.error('Inventory commitment error (non-blocking):', invErr.message)
      }
    }

    console.log('Webhook processed:', {
      quote_type, quote_id, customer_id, agreement_id, invoice_id,
      amount: amountDollars, pm_saved: !!savedPmId,
    })

    return res.status(200).json({ received: true })

  } catch (err) {
    console.error('Webhook processing error:', err)
    // Return 200 so Stripe doesn't retry — log the error
    return res.status(200).json({ received: true, warning: err.message })
  }
}


// ────────────────────────────────────────────────────────────
// INVENTORY COMMITMENT — Webhook-side version
//
// This is a self-contained version of commitForFulfillment
// that uses the server-side supabase client (service role).
// The frontend inventoryService.ts uses the browser client.
// Same logic, same RPCs, same idempotency.
// ────────────────────────────────────────────────────────────

async function commitForFulfillmentWebhook(supa, jobId) {
  // 1. Load job
  const { data: job, error: jobErr } = await supa
    .from('jobs')
    .select('id, source_quote_id, inventory_status')
    .eq('id', jobId)
    .single()

  if (jobErr || !job || !job.source_quote_id) {
    return { status: 'skipped', reason: 'No source_quote_id' }
  }

  // 2. Load line items from frozen source quote
  const { data: lineItems } = await supa
    .from('document_line_items')
    .select('product_id, quantity')
    .eq('document_id', job.source_quote_id)
    .not('product_id', 'is', null)

  if (!lineItems || lineItems.length === 0) {
    await supa.from('jobs').update({
      inventory_status: 'not_required',
      inventory_checked_at: new Date().toISOString(),
    }).eq('id', jobId)
    return { status: 'not_required', reason: 'No line items with products' }
  }

  // 3. Load products — only track_inventory = true
  const productIds = [...new Set(lineItems.map(li => li.product_id).filter(Boolean))]

  const { data: products } = await supa
    .from('products')
    .select('id, name, track_inventory, vendor_id, vendor_sku')
    .in('id', productIds)

  const productMap = new Map((products || []).map(p => [p.id, p]))

  const trackedItems = lineItems.filter(li => {
    const prod = productMap.get(li.product_id)
    return prod?.track_inventory === true
  })

  if (trackedItems.length === 0) {
    await supa.from('jobs').update({
      inventory_status: 'not_required',
      inventory_checked_at: new Date().toISOString(),
    }).eq('id', jobId)
    return { status: 'not_required', reason: 'No tracked products' }
  }

  // 4. Reserve each tracked product
  let anyShort = false
  const results = []

  for (const li of trackedItems) {
    const prod = productMap.get(li.product_id)
    const qty = li.quantity || 1
    const reservationKey = `${jobId}:${li.product_id}:fulfillment_committed`

    // Call atomic RPC
    const { data: rpcResult, error: rpcErr } = await supa
      .rpc('rpc_reserve_stock', {
        p_product_id: li.product_id,
        p_job_id: jobId,
        p_quantity: qty,
        p_reservation_key: reservationKey,
      })

    if (rpcErr) {
      console.error(`Reserve RPC error for ${prod?.name}:`, rpcErr)
      anyShort = true
      results.push({ product: prod?.name, result: 'error' })
      continue
    }

    results.push({ product: prod?.name, result: rpcResult })

    if (rpcResult === 'short') {
      anyShort = true

      // Get vendor name snapshot
      let vendorName = null
      if (prod?.vendor_id) {
        const { data: vendor } = await supa
          .from('product_vendors')
          .select('name')
          .eq('id', prod.vendor_id)
          .single()
        vendorName = vendor?.name || null
      }

      // Calculate shortage
      const { data: inv } = await supa
        .from('inventory')
        .select('quantity_available')
        .eq('product_id', li.product_id)
        .single()

      const available = inv?.quantity_available || 0
      const shortfall = qty - Math.max(0, available)

      // Create reorder request (idempotent via unique index)
      await supa.from('reorder_requests').upsert({
        product_id: li.product_id,
        job_id: jobId,
        request_type: 'job_shortage',
        quantity_needed: shortfall > 0 ? shortfall : qty,
        vendor_name: vendorName,
        vendor_sku: prod?.vendor_sku || null,
        vendor_id: prod?.vendor_id || null,
        status: 'open',
      }, {
        onConflict: 'job_id,product_id',
        ignoreDuplicates: true,
      }).then(() => {}).catch(err => {
        console.error('Reorder request error:', err.message)
      })
    }
  }

  // 5. Update job status
  const finalStatus = anyShort ? 'short' : 'reserved'

  await supa.from('jobs').update({
    inventory_status: finalStatus,
    inventory_checked_at: new Date().toISOString(),
    inventory_reservation_key: `${jobId}:fulfillment_committed`,
  }).eq('id', jobId)

  return { status: finalStatus, results }
}
