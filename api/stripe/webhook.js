// api/stripe/webhook.js
// Handles Stripe webhook events after checkout completes
// Wires: payment_methods, payment_transactions, contracts (active), invoices (paid)
// NEW: Email sends on card save (rental) and purchase payment

import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' })

export const config = { api: { bodyParser: false } }

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// ─── Resend email helper ──────────────────────────────────────────
async function sendEmail({ to, subject, html, customer_id, email_type, document_id = null }) {
  const now = new Date().toISOString()
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Zenith Pure Solutions <info@zenithpuresolutions.com>',
        to: [to],
        subject,
        html,
      }),
    })
    const data = await res.json()
    const sent = res.ok

    await supabase.from('email_log').insert({
      customer_id, email_type, to_address: to, subject,
      status: sent ? 'sent' : 'failed',
      external_id: data?.id || null,
      document_id,
      sent_at: sent ? now : null,
      created_at: now,
    }).then(() => {}).catch(() => {})

    return sent
  } catch (e) {
    console.error('sendEmail error:', e.message)
    return false
  }
}

// ─── Email templates ──────────────────────────────────────────────

function cardSavedHtml({ customerName, contractNumber, monthlyAmount, cardLast4 }) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#f3f4f6;font-family:system-ui,-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td style="background:#0a2540;padding:28px 32px;text-align:center;">
    <div style="display:inline-block;width:40px;height:40px;background:#0d7ea3;border-radius:10px;line-height:40px;text-align:center;font-weight:700;font-size:18px;color:white;">Z</div>
    <p style="color:white;font-weight:600;font-size:15px;margin:10px 0 2px;">Zenith Pure Solutions</p>
    <p style="color:#93c5fd;font-size:12px;margin:0;">Indianapolis, IN · (317) 690-4172</p>
  </td></tr>
  <tr><td style="background:#eff6ff;border-bottom:1px solid #bfdbfe;padding:20px 32px;text-align:center;">
    <div style="width:36px;height:36px;background:#dbeafe;border-radius:50%;display:inline-block;line-height:36px;font-size:18px;margin-bottom:8px;">✓</div>
    <p style="color:#1d4ed8;font-weight:600;font-size:16px;margin:0;">You're all set!</p>
    <p style="color:#2563eb;font-size:13px;margin:4px 0 0;">Payment method saved — autopay will begin after installation</p>
  </td></tr>
  <tr><td style="padding:28px 32px;">
    <p style="font-size:14px;color:#374151;margin:0 0 16px;">Hi ${customerName},</p>
    <p style="font-size:14px;color:#374151;margin:0 0 20px;line-height:1.6;">Your payment method has been saved securely. Here's a summary of your rental agreement:</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;padding:16px 20px;">
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Contract</td><td style="text-align:right;font-weight:600;color:#111827;padding:6px 0;font-size:13px;">${contractNumber || '—'}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Monthly payment</td><td style="text-align:right;font-weight:700;color:#111827;padding:6px 0;font-size:15px;">$${Number(monthlyAmount).toFixed(2)}/mo</td></tr>
      ${cardLast4 ? `<tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Card saved</td><td style="text-align:right;font-weight:600;color:#111827;padding:6px 0;font-size:13px;">Card ending ${cardLast4}</td></tr>` : ''}
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">First charge</td><td style="text-align:right;font-weight:600;color:#16a34a;padding:6px 0;font-size:13px;">After installation</td></tr>
    </table>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 18px;margin:20px 0;font-size:13px;color:#15803d;">
      No charge today. Autopay will begin automatically on the day of your installation. You'll receive a receipt after each payment.
    </div>
    <p style="font-size:14px;color:#374151;margin:0;line-height:1.6;">We'll be in touch shortly to schedule your installation. Questions? Call us at <a href="tel:3176904172" style="color:#0d7ea3;">(317) 690-4172</a>.</p>
  </td></tr>
  <tr><td style="border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
    <p style="font-size:11px;color:#9ca3af;margin:0;">Zenith Pure Solutions LLC · 6951 E 30th St, Suite B · Indianapolis, IN 46219</p>
    <p style="font-size:11px;color:#9ca3af;margin:4px 0 0;">info@zenithpuresolutions.com · zenithpuresolutions.com</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`
}

function purchaseReceiptHtml({ customerName, amount, invoiceNumber, cardLast4, isDeposit }) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#f3f4f6;font-family:system-ui,-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td style="background:#0a2540;padding:28px 32px;text-align:center;">
    <div style="display:inline-block;width:40px;height:40px;background:#0d7ea3;border-radius:10px;line-height:40px;text-align:center;font-weight:700;font-size:18px;color:white;">Z</div>
    <p style="color:white;font-weight:600;font-size:15px;margin:10px 0 2px;">Zenith Pure Solutions</p>
    <p style="color:#93c5fd;font-size:12px;margin:0;">Indianapolis, IN · (317) 690-4172</p>
  </td></tr>
  <tr><td style="background:#f0fdf4;border-bottom:1px solid #bbf7d0;padding:20px 32px;text-align:center;">
    <div style="width:36px;height:36px;background:#dcfce7;border-radius:50%;display:inline-block;line-height:36px;font-size:18px;margin-bottom:8px;">✓</div>
    <p style="color:#15803d;font-weight:600;font-size:16px;margin:0;">${isDeposit ? 'Deposit received' : 'Payment received'}</p>
    <p style="color:#16a34a;font-size:13px;margin:4px 0 0;">Your ${isDeposit ? 'deposit' : 'payment'} was processed successfully</p>
  </td></tr>
  <tr><td style="padding:28px 32px;">
    <p style="font-size:14px;color:#374151;margin:0 0 16px;">Hi ${customerName},</p>
    <p style="font-size:14px;color:#374151;margin:0 0 20px;line-height:1.6;">Thank you for your ${isDeposit ? 'deposit' : 'payment'}. Here's your receipt:</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;padding:16px 20px;">
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Amount</td><td style="text-align:right;font-weight:700;color:#111827;padding:6px 0;font-size:15px;">$${Number(amount).toFixed(2)}</td></tr>
      ${invoiceNumber ? `<tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Invoice</td><td style="text-align:right;font-weight:600;color:#111827;padding:6px 0;font-size:13px;">${invoiceNumber}</td></tr>` : ''}
      ${cardLast4 ? `<tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Payment method</td><td style="text-align:right;font-weight:600;color:#111827;padding:6px 0;font-size:13px;">Card ending ${cardLast4}</td></tr>` : ''}
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Date</td><td style="text-align:right;font-weight:600;color:#111827;padding:6px 0;font-size:13px;">${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</td></tr>
      ${isDeposit ? `<tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Remaining balance</td><td style="text-align:right;font-weight:600;color:#d97706;padding:6px 0;font-size:13px;">Due on installation day</td></tr>` : ''}
    </table>
    <p style="font-size:14px;color:#374151;margin:20px 0 0;line-height:1.6;">We'll be in touch to schedule your installation. Questions? Call <a href="tel:3176904172" style="color:#0d7ea3;">(317) 690-4172</a>.</p>
  </td></tr>
  <tr><td style="border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
    <p style="font-size:11px;color:#9ca3af;margin:0;">Zenith Pure Solutions LLC · 6951 E 30th St, Suite B · Indianapolis, IN 46219</p>
    <p style="font-size:11px;color:#9ca3af;margin:4px 0 0;">info@zenithpuresolutions.com · zenithpuresolutions.com</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`
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

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true })
  }

  const session = event.data.object
  const meta = session.metadata || {}
  const { quote_id, customer_id, quote_type, agreement_id, invoice_id } = meta
  const now = new Date().toISOString()

  try {
    // ── 1. Get payment method from Stripe ────────────────────────
    let stripePaymentMethodId = null
    let last4 = null, expMonth = null, expYear = null, brand = null

    if (session.payment_intent) {
      const pi = await stripe.paymentIntents.retrieve(session.payment_intent, { expand: ['payment_method'] })
      if (pi.payment_method && typeof pi.payment_method === 'object') {
        const pm = pi.payment_method
        stripePaymentMethodId = pm.id
        last4 = pm.card?.last4 || null
        expMonth = pm.card?.exp_month || null
        expYear = pm.card?.exp_year || null
        brand = pm.card?.brand || null

        if (pm.customer !== session.customer) {
          try { await stripe.paymentMethods.attach(pm.id, { customer: session.customer }) } catch (_) {}
        }
        try { await stripe.customers.update(session.customer, { invoice_settings: { default_payment_method: pm.id } }) } catch (_) {}
      }
    }

    if (session.setup_intent && !stripePaymentMethodId) {
      try {
        const si = await stripe.setupIntents.retrieve(session.setup_intent, { expand: ['payment_method'] })
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

    // ── 2. Save payment method ───────────────────────────────────
    let savedPmId = null
    if (stripePaymentMethodId && customer_id) {
      await supabase.from('payment_methods').update({ is_default: false }).eq('customer_id', customer_id)

      const { data: savedPm } = await supabase.from('payment_methods').insert({
        customer_id, type: 'card', provider: 'stripe',
        external_id: stripePaymentMethodId,
        last_four: last4, exp_month: expMonth, exp_year: expYear,
        is_default: true, status: 'active', created_at: now, updated_at: now,
      }).select().single()

      savedPmId = savedPm?.id || null

      if (session.customer) {
        await supabase.from('customers').update({ stripe_customer_id: session.customer }).eq('id', customer_id)
      }
    }

    // ── 3. Log payment transaction ───────────────────────────────
    // FIX: Check invoice deposit_percent to determine if this is a deposit or full payment
    const amountDollars = (session.amount_total || 0) / 100

    let txType = 'deposit'
    let txDescription = 'Purchase payment'

    if (quote_type === 'rental') {
      txType = 'first_month'
      txDescription = 'First month rental payment'
    } else if (quote_type === 'purchase' && invoice_id) {
      // Check invoice to determine deposit vs full payment
      try {
        const { data: invCheck } = await supabase
          .from('invoices')
          .select('deposit_percent, total')
          .eq('id', invoice_id)
          .single()

        if (invCheck) {
          const isFullPayment = invCheck.deposit_percent >= 100 ||
            (invCheck.total && Math.abs(amountDollars - invCheck.total) < 0.02)

          if (isFullPayment) {
            txType = 'purchase_full'
            txDescription = 'Purchase payment (full)'
          } else {
            txType = 'deposit'
            txDescription = `Purchase deposit (${invCheck.deposit_percent || 50}%)`
          }
        }
      } catch (e) {
        // fallback — use amount heuristic
        txType = 'deposit'
        txDescription = 'Purchase payment'
      }
    }

    await supabase.from('payment_transactions').insert({
      customer_id, contract_id: agreement_id || null, payment_method_id: savedPmId,
      amount: amountDollars, status: 'succeeded',
      type: txType,
      external_id: session.payment_intent || session.id,
      description: txDescription,
      attempted_at: now, completed_at: now,
    })

    // ── 4. Activate contract or mark invoice paid ────────────────
    let contractNumber = null
    let monthlyAmount = null
    let invoiceNumber = null

    if (quote_type === 'rental' && agreement_id) {
      const { data: contract } = await supabase
        .from('contracts').select('id, contract_number, monthly_amount')
        .eq('quote_id', quote_id).single()

      if (contract) {
        contractNumber = contract.contract_number
        monthlyAmount = contract.monthly_amount
        await supabase.from('contracts').update({ status: 'active', updated_at: now }).eq('id', contract.id)
        await supabase.from('document_audit_log').insert({
          entity_type: 'contract', entity_id: contract.id, event: 'contract_activated',
          actor_type: 'system', metadata: { trigger: 'stripe_payment', session_id: session.id, amount: amountDollars },
        })
      }
      await supabase.from('agreements').update({ status: 'active', updated_at: now }).eq('id', agreement_id)

    } else if (quote_type === 'purchase' && invoice_id) {
      const { data: inv } = await supabase
        .from('invoices').select('invoice_number').eq('id', invoice_id).single()
      invoiceNumber = inv?.invoice_number || null

      await supabase.from('invoices').update({
        status: 'paid', amount_paid: amountDollars, paid_at: now, updated_at: now,
      }).eq('id', invoice_id)

      await supabase.from('document_audit_log').insert({
        entity_type: 'invoice', entity_id: invoice_id, event: 'deposit_paid',
        actor_type: 'system', metadata: { trigger: 'stripe_payment', session_id: session.id, amount: amountDollars },
      })
    }

    // ── 5. Load customer for emails ──────────────────────────────
    let custEmail = null, custName = null
    if (customer_id) {
      const { data: cust } = await supabase
        .from('customers').select('email, full_name').eq('id', customer_id).single()
      custEmail = cust?.email || null
      custName = cust?.full_name || 'Valued Customer'
    }

    // ── 6. Send email based on flow type ─────────────────────────
    if (custEmail) {
      if (quote_type === 'rental') {
        await sendEmail({
          to: custEmail,
          subject: `Payment method saved — Zenith Pure Solutions`,
          html: cardSavedHtml({
            customerName: custName,
            contractNumber,
            monthlyAmount: monthlyAmount || amountDollars,
            cardLast4: last4,
          }),
          customer_id,
          email_type: 'card_saved_confirmation',
          document_id: agreement_id || null,
        })
      } else if (quote_type === 'purchase') {
        const isDeposit = txType === 'deposit'
        await sendEmail({
          to: custEmail,
          subject: `${isDeposit ? 'Deposit' : 'Payment'} received — $${amountDollars.toFixed(2)} — Zenith Pure Solutions`,
          html: purchaseReceiptHtml({
            customerName: custName,
            amount: amountDollars,
            invoiceNumber,
            cardLast4: last4,
            isDeposit,
          }),
          customer_id,
          email_type: 'payment_receipt',
          document_id: invoice_id || null,
        })
      }
    }

    // ── 7. Inventory commitment ──────────────────────────────────
    if (quote_id && customer_id) {
      try {
        let jobId = null
        const { data: existingJob } = await supabase
          .from('jobs').select('id').eq('source_quote_id', quote_id).limit(1).maybeSingle()

        if (existingJob) {
          jobId = existingJob.id
        } else {
          const { data: quote } = await supabase
            .from('quotes').select('id, customer_name, system_type, opportunity_id').eq('id', quote_id).single()

          if (quote) {
            const { data: custData } = await supabase
              .from('customers').select('full_name, phone, email, address, city, state, zip').eq('id', customer_id).single()

            const serviceAddress = custData
              ? [custData.address, custData.city, custData.state, custData.zip].filter(Boolean).join(', ')
              : ''

            const { data: newJob, error: jobErr } = await supabase.from('jobs').insert({
              lead_id: quote.opportunity_id || null,
              customer_name_snapshot: custData?.full_name || quote.customer_name || 'Customer',
              service_address_snapshot: serviceAddress,
              phone_snapshot: custData?.phone || null,
              email_snapshot: custData?.email || null,
              system_type: quote.system_type || null,
              source_quote_id: quote_id,
              status: 'ready_to_schedule',
              inventory_status: 'pending_check',
              created_at: now,
            }).select('id').single()

            if (jobErr) {
              console.error('Job creation failed:', jobErr.message)
            } else {
              jobId = newJob.id
            }

            await supabase.from('document_audit_log').insert({
              entity_type: 'job', entity_id: jobId, event: 'job_created_from_fulfillment',
              actor_type: 'system', metadata: { trigger: 'stripe_webhook', quote_id, quote_type, session_id: session.id },
            }).then(() => {}).catch(() => {})
          }
        }

        if (jobId) {
          const invResult = await commitForFulfillmentWebhook(supabase, jobId)
          console.log('Inventory commitment:', { jobId, ...invResult })

          // ── NEW: Set job status based on inventory result ──
          // reserved/not_required → ready_to_schedule (front desk calls to book)
          // short → waiting_for_stock (auto-moves to ready_to_schedule when stock arrives)
          if (invResult.status === 'short') {
            await supabase.from('jobs').update({ status: 'waiting_for_stock' }).eq('id', jobId)
          }
          // ready_to_schedule is already set at creation — no change needed for reserved/not_required
        }

        // ── NEW: Mark lead.job_created so Pipeline shows correct status ──
        if (jobId) {
          const { data: jobForLead } = await supabase.from('jobs').select('lead_id').eq('id', jobId).single()
          if (jobForLead?.lead_id) {
            await supabase.from('leads').update({ job_created: true }).eq('id', jobForLead.lead_id)
              .then(() => {}).catch(() => {})
          }
        }

      } catch (invErr) {
        console.error('Inventory commitment error (non-blocking):', invErr.message)
      }
    }

    console.log('Webhook processed:', { quote_type, quote_id, customer_id, agreement_id, invoice_id, amount: amountDollars, pm_saved: !!savedPmId, tx_type: txType })
    return res.status(200).json({ received: true })

  } catch (err) {
    console.error('Webhook processing error:', err)
    return res.status(200).json({ received: true, warning: err.message })
  }
}

// ─── Inventory commitment (unchanged) ────────────────────────────
async function commitForFulfillmentWebhook(supa, jobId) {
  const { data: job, error: jobErr } = await supa
    .from('jobs').select('id, source_quote_id, inventory_status').eq('id', jobId).single()

  if (jobErr || !job || !job.source_quote_id) return { status: 'skipped', reason: 'No source_quote_id' }

  const { data: lineItems } = await supa
    .from('document_line_items').select('product_id, quantity')
    .eq('document_id', job.source_quote_id).not('product_id', 'is', null)

  if (!lineItems || lineItems.length === 0) {
    await supa.from('jobs').update({ inventory_status: 'not_required', inventory_checked_at: new Date().toISOString() }).eq('id', jobId)
    return { status: 'not_required', reason: 'No line items with products' }
  }

  const productIds = [...new Set(lineItems.map(li => li.product_id).filter(Boolean))]
  const { data: products } = await supa.from('products').select('id, name, track_inventory, vendor_id, vendor_sku').in('id', productIds)
  const productMap = new Map((products || []).map(p => [p.id, p]))
  const trackedItems = lineItems.filter(li => productMap.get(li.product_id)?.track_inventory === true)

  if (trackedItems.length === 0) {
    await supa.from('jobs').update({ inventory_status: 'not_required', inventory_checked_at: new Date().toISOString() }).eq('id', jobId)
    return { status: 'not_required', reason: 'No tracked products' }
  }

  let anyShort = false
  const results = []

  for (const li of trackedItems) {
    const prod = productMap.get(li.product_id)
    const qty = li.quantity || 1
    const reservationKey = `${jobId}:${li.product_id}:fulfillment_committed`

    const { data: rpcResult, error: rpcErr } = await supa.rpc('rpc_reserve_stock', {
      p_product_id: li.product_id, p_job_id: jobId, p_quantity: qty, p_reservation_key: reservationKey,
    })

    if (rpcErr) { console.error(`Reserve RPC error for ${prod?.name}:`, rpcErr); anyShort = true; results.push({ product: prod?.name, result: 'error' }); continue }
    results.push({ product: prod?.name, result: rpcResult })

    if (rpcResult === 'short') {
      anyShort = true
      let vendorName = null
      if (prod?.vendor_id) {
        const { data: vendor } = await supa.from('product_vendors').select('name').eq('id', prod.vendor_id).single()
        vendorName = vendor?.name || null
      }
      const { data: inv } = await supa.from('inventory').select('quantity_available').eq('product_id', li.product_id).single()
      const available = inv?.quantity_available || 0
      const shortfall = qty - Math.max(0, available)

      await supa.from('reorder_requests').upsert({
        product_id: li.product_id, job_id: jobId, request_type: 'job_shortage',
        quantity_needed: shortfall > 0 ? shortfall : qty,
        vendor_name: vendorName, vendor_sku: prod?.vendor_sku || null, vendor_id: prod?.vendor_id || null, status: 'open',
      }, { onConflict: 'job_id,product_id', ignoreDuplicates: true }).then(() => {}).catch(err => { console.error('Reorder request error:', err.message) })
    }
  }

  const finalStatus = anyShort ? 'short' : 'reserved'
  await supa.from('jobs').update({ inventory_status: finalStatus, inventory_checked_at: new Date().toISOString(), inventory_reservation_key: `${jobId}:fulfillment_committed` }).eq('id', jobId)
  return { status: finalStatus, results }
}
