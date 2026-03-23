// api/cron/autopay.js
// Vercel Cron Job — runs daily at 6 AM EST
// Section 1: Charges rental contracts on their billing_day
// Section 2: Charges service plans where next_billing_date <= today
//            + Creates fulfillment_requests for tech_visit plans (Phase 3.5)
// Section 3: Retries payment_failed plans when new card on file
//
// DND rule: payment processing always runs regardless of DND.
//           Email + SMS notifications are skipped for DND customers.
//
// {
//   "crons": [{ "path": "/api/cron/autopay", "schedule": "0 11 * * *" }]
// }

import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' })

const OPENPHONE_KEY = process.env.OPENPHONE_API_KEY || ''
const OPENPHONE_NUM = process.env.OPENPHONE_NUMBER  || '+14633005100'

// ── DND check helper ──────────────────────────────────────────────
async function isCustomerDnd(customerId) {
  try {
    const { data: cust } = await supabase
      .from('customers').select('lead_id').eq('id', customerId).single()
    if (!cust?.lead_id) return false
    const { data: lead } = await supabase
      .from('leads').select('stage').eq('id', cust.lead_id).single()
    return lead?.stage === 'dnd'
  } catch (_) { return false }
}

// ─── Resend email helper ──────────────────────────────────────────────
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
    await supabase.from('email_log').insert({
      customer_id, email_type, to_address: to, subject,
      status: 'failed', created_at: new Date().toISOString(),
    }).then(() => {}).catch(() => {})
    return false
  }
}

// ─── OpenPhone SMS helper — fire-and-forget ───────────────────────
async function sendSms(to, message, customerId) {
  if (!OPENPHONE_KEY || !to) return
  try {
    const digits = to.replace(/\D/g, '')
    const e164   = digits.length === 10 ? `+1${digits}` : `+${digits}`
    const resp   = await fetch('https://api.openphone.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': OPENPHONE_KEY },
      body: JSON.stringify({ content: message, from: OPENPHONE_NUM, to: [e164] }),
    })
    const data = await resp.json()
    await supabase.from('communications_log').insert({
      entity_type: 'customer', entity_id: customerId, customer_id: customerId,
      direction: 'outbound', channel: 'sms', body: message,
      status: resp.ok ? 'sent' : 'failed',
      external_id: data?.data?.id || null,
      created_at: new Date().toISOString(),
    }).then(() => {}).catch(() => {})
  } catch (e) { console.error('[autopay] sendSms error:', e.message) }
}

// ─── Email templates ──────────────────────────────────────────────

function paymentReceiptHtml({ customerName, amount, description, contractNumber, nextDate, cardLast4, isServicePlan }) {
  const nextLine = nextDate
    ? `<tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Next payment</td><td style="text-align:right;font-weight:600;color:#111827;padding:6px 0;font-size:13px;">${nextDate}</td></tr>`
    : ''
  const contractLine = contractNumber
    ? `<tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">${isServicePlan ? 'Service plan' : 'Contract'}</td><td style="text-align:right;font-weight:600;color:#111827;padding:6px 0;font-size:13px;">${contractNumber}</td></tr>`
    : ''
  const cardLine = cardLast4
    ? `<tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Payment method</td><td style="text-align:right;font-weight:600;color:#111827;padding:6px 0;font-size:13px;">Card ending ${cardLast4}</td></tr>`
    : ''

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
    <p style="color:#15803d;font-weight:600;font-size:16px;margin:0;">Payment received</p>
    <p style="color:#16a34a;font-size:13px;margin:4px 0 0;">Your payment was processed successfully</p>
  </td></tr>
  <tr><td style="padding:28px 32px;">
    <p style="font-size:14px;color:#374151;margin:0 0 20px;">Hi ${customerName},</p>
    <p style="font-size:14px;color:#374151;margin:0 0 24px;line-height:1.6;">Your payment has been processed. Here's your receipt:</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;padding:16px 20px;">
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Amount charged</td><td style="text-align:right;font-weight:700;color:#111827;padding:6px 0;font-size:15px;">$${Number(amount).toFixed(2)}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Description</td><td style="text-align:right;font-weight:600;color:#111827;padding:6px 0;font-size:13px;">${description}</td></tr>
      ${contractLine}
      ${cardLine}
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Date</td><td style="text-align:right;font-weight:600;color:#111827;padding:6px 0;font-size:13px;">${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</td></tr>
      ${nextLine}
    </table>
    <p style="font-size:13px;color:#6b7280;margin:20px 0 0;line-height:1.6;">Questions? Reply to this email or call <a href="tel:3176904172" style="color:#0d7ea3;">(317) 690-4172</a>.</p>
  </td></tr>
  <tr><td style="border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
    <p style="font-size:11px;color:#9ca3af;margin:0;">Zenith Pure Solutions LLC · 6951 E 30th St, Suite B · Indianapolis, IN 46219</p>
    <p style="font-size:11px;color:#9ca3af;margin:4px 0 0;">info@zenithpuresolutions.com · zenithpuresolutions.com</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`
}

function paymentFailedHtml({ customerName, amount, description, contractNumber, attemptCount, isFinal, isServicePlan }) {
  const retryNote = isFinal
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 18px;font-size:13px;color:#b91c1c;margin:16px 0;">Your ${isServicePlan ? 'service plan' : 'account'} has been paused after 3 failed attempts. Please contact us to restore service.</div>`
    : `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px 18px;font-size:13px;color:#c2410c;margin:16px 0;">We'll retry automatically tomorrow. After 3 failed attempts your service will be paused.</div>`

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#f3f4f6;font-family:system-ui,-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td style="background:#0a2540;padding:28px 32px;text-align:center;">
    <p style="color:white;font-weight:600;font-size:15px;margin:0;">Zenith Pure Solutions</p>
    <p style="color:#93c5fd;font-size:12px;margin:4px 0 0;">Indianapolis, IN · (317) 690-4172</p>
  </td></tr>
  <tr><td style="background:#fef2f2;border-bottom:1px solid #fecaca;padding:20px 32px;text-align:center;">
    <div style="width:36px;height:36px;background:#fee2e2;border-radius:50%;display:inline-block;line-height:36px;font-size:18px;margin-bottom:8px;">!</div>
    <p style="color:#b91c1c;font-weight:600;font-size:16px;margin:0;">Payment failed</p>
    <p style="color:#dc2626;font-size:13px;margin:4px 0 0;">Action required — please update your payment method</p>
  </td></tr>
  <tr><td style="padding:28px 32px;">
    <p style="font-size:14px;color:#374151;margin:0 0 16px;">Hi ${customerName},</p>
    <p style="font-size:14px;color:#374151;margin:0 0 8px;line-height:1.6;">We were unable to process your payment of <strong>$${Number(amount).toFixed(2)}</strong>${contractNumber ? ` for ${isServicePlan ? 'service plan' : 'contract'} ${contractNumber}` : ''}.</p>
    <p style="font-size:13px;color:#6b7280;margin:0 0 16px;">Description: ${description} · Attempt ${attemptCount} of 3</p>
    ${retryNote}
    <p style="font-size:14px;color:#374151;margin:16px 0 0;line-height:1.6;">Please call us at <a href="tel:3176904172" style="color:#0d7ea3;font-weight:600;">(317) 690-4172</a> or reply to this email to update your payment method.</p>
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
  const authHeader = req.headers.authorization
  const cronSecret = process.env.CRON_SECRET
  const isCron = req.headers['x-vercel-cron'] === '1'
  const isManual = cronSecret && authHeader === `Bearer ${cronSecret}`

  if (!isCron && !isManual) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const results = {
    processed: 0, succeeded: 0, failed: 0, skipped: 0, errors: [],
    plans_processed: 0, plans_succeeded: 0, plans_failed: 0, plans_skipped: 0, plans_errors: [],
    fulfillment_created: 0,
  }

  try {
    const today = new Date().toISOString().slice(0, 10)
    const dayOfMonth = new Date().getDate()

    // ══════════════════════════════════════════════════════════
    // SECTION 1: RENTAL CONTRACT BILLING
    // ══════════════════════════════════════════════════════════

    const { data: contracts, error: contractErr } = await supabase
      .from('contracts')
      .select('id, customer_id, monthly_amount, contract_number, start_date, billing_day, notes')
      .eq('status', 'active').eq('type', 'rental').gt('monthly_amount', 0)

    if (contractErr) {
      console.error('Failed to fetch contracts:', contractErr)
      return res.status(500).json({ error: 'Failed to fetch contracts', details: contractErr.message })
    }

    for (const contract of (contracts || [])) {
      results.processed++
      try {
        const billingDay = contract.billing_day || 1
        if (dayOfMonth !== billingDay) { results.skipped++; continue }

        const monthStart = new Date()
        monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)

        const { data: existingTx } = await supabase
          .from('payment_transactions').select('id')
          .eq('contract_id', contract.id).eq('status', 'succeeded').eq('type', 'autopay')
          .gte('attempted_at', monthStart.toISOString()).limit(1)

        if (existingTx && existingTx.length > 0) { results.skipped++; continue }

        const { data: customer } = await supabase
          .from('customers').select('id, full_name, phone, email, stripe_customer_id')
          .eq('id', contract.customer_id).single()

        if (!customer || !customer.stripe_customer_id) {
          results.skipped++
          results.errors.push({ contract_id: contract.id, reason: 'No Stripe customer ID', customer_id: contract.customer_id })
          continue
        }

        // ── DND check (Section 1) — payment runs regardless, comms skip ──
        const isDnd = await isCustomerDnd(customer.id)
        if (isDnd) console.log(`[autopay] S1 DND customer — charging but skipping comms: ${customer.full_name}`)

        const { data: paymentMethod } = await supabase
          .from('payment_methods').select('id, external_id, type, last_four')
          .eq('customer_id', contract.customer_id).eq('is_default', true).eq('status', 'active').single()

        if (!paymentMethod) {
          results.skipped++
          results.errors.push({ contract_id: contract.id, reason: 'No default payment method', customer_name: customer.full_name })
          await supabase.from('follow_up_tasks').insert({
            entity_type: 'customer', entity_id: customer.id,
            title: `Missing payment method — ${customer.full_name}`,
            description: `Autopay skipped for contract ${contract.contract_number}. No default payment method on file.`,
            due_date: today, status: 'pending', priority: 'high',
          })
          continue
        }

        const amountCents = Math.round(contract.monthly_amount * 100)
        const description = `Monthly rental — Contract ${contract.contract_number || contract.id.slice(0, 8)}`
        let paymentIntent, chargeSucceeded = false

        try {
          paymentIntent = await stripe.paymentIntents.create({
            amount: amountCents, currency: 'usd',
            customer: customer.stripe_customer_id,
            payment_method: paymentMethod.external_id,
            off_session: true, confirm: true, description,
            metadata: { contract_id: contract.id, customer_id: customer.id, type: 'autopay' },
          })
          chargeSucceeded = paymentIntent.status === 'succeeded'
        } catch (stripeErr) {
          paymentIntent = { id: stripeErr.payment_intent?.id || null }
          chargeSucceeded = false
          results.errors.push({ contract_id: contract.id, customer_name: customer.full_name, reason: stripeErr.message, stripe_code: stripeErr.code })
        }

        await supabase.from('payment_transactions').insert({
          customer_id: customer.id, contract_id: contract.id, payment_method_id: paymentMethod.id,
          amount: contract.monthly_amount, status: chargeSucceeded ? 'succeeded' : 'failed',
          type: 'autopay', external_id: paymentIntent?.id || null, description,
          attempted_at: new Date().toISOString(),
          completed_at: chargeSucceeded ? new Date().toISOString() : null,
          failure_reason: chargeSucceeded ? null : (results.errors[results.errors.length - 1]?.reason || 'unknown'),
        })

        if (chargeSucceeded) {
          results.succeeded++
          await supabase.from('contracts').update({ last_billed_at: new Date().toISOString() }).eq('id', contract.id)
          await supabase.from('document_audit_log').insert({
            entity_type: 'contract', entity_id: contract.id, event: 'autopay_succeeded',
            actor_type: 'system', metadata: { amount: contract.monthly_amount, payment_intent: paymentIntent?.id },
          })

          if (!isDnd) {
            // ── EMAIL: Payment receipt ──────────────────────────
            if (customer.email) {
              const nextBillingDate = new Date()
              nextBillingDate.setMonth(nextBillingDate.getMonth() + 1)
              const nextStr = nextBillingDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
              await sendEmail({
                to: customer.email,
                subject: `Payment received — $${contract.monthly_amount.toFixed(2)} — Zenith Pure Solutions`,
                html: paymentReceiptHtml({
                  customerName: customer.full_name, amount: contract.monthly_amount,
                  description, contractNumber: contract.contract_number,
                  nextDate: nextStr, cardLast4: paymentMethod.last_four, isServicePlan: false,
                }),
                customer_id: customer.id, email_type: 'payment_receipt',
              })
            }

            // ── SMS: Payment receipt ────────────────────────────
            if (customer.phone) {
              const firstName = (customer.full_name || 'there').split(' ')[0]
              await sendSms(customer.phone,
                `Hi ${firstName}, your $${contract.monthly_amount.toFixed(2)} rental payment was received. Thank you! — Zenith Pure Solutions`,
                customer.id)
            }
          }

        } else {
          results.failed++
          await supabase.from('follow_up_tasks').insert({
            entity_type: 'customer', entity_id: customer.id,
            title: `Failed payment — ${customer.full_name}`,
            description: `Autopay failed for contract ${contract.contract_number || ''}. Amount: $${contract.monthly_amount}. Reason: ${results.errors[results.errors.length - 1]?.reason || 'unknown'}.`,
            due_date: today, status: 'pending', priority: 'urgent',
          })
          await supabase.from('document_audit_log').insert({
            entity_type: 'contract', entity_id: contract.id, event: 'autopay_failed',
            actor_type: 'system', metadata: { amount: contract.monthly_amount, reason: results.errors[results.errors.length - 1]?.reason },
          })

          if (!isDnd) {
            // ── EMAIL: Failed payment notice ────────────────────
            if (customer.email) {
              await sendEmail({
                to: customer.email,
                subject: `Payment failed — action required — Zenith Pure Solutions`,
                html: paymentFailedHtml({
                  customerName: customer.full_name, amount: contract.monthly_amount,
                  description, contractNumber: contract.contract_number,
                  attemptCount: 1, isFinal: false, isServicePlan: false,
                }),
                customer_id: customer.id, email_type: 'payment_failed',
              })
            }

            // ── SMS: Failed payment notice ──────────────────────
            if (customer.phone) {
              const firstName = (customer.full_name || 'there').split(' ')[0]
              await sendSms(customer.phone,
                `Hi ${firstName}, your autopay of $${contract.monthly_amount.toFixed(2)} failed. Please call us at (317) 690-4172 to update your payment method. — Zenith Pure Solutions`,
                customer.id)
            }
          }
        }

      } catch (err) {
        results.failed++
        results.errors.push({ contract_id: contract.id, reason: err.message || 'Unknown error' })
      }
    }

    // ══════════════════════════════════════════════════════════
    // SECTION 2: SERVICE PLAN BILLING
    // ══════════════════════════════════════════════════════════

    const { data: duePlans, error: planErr } = await supabase
      .from('customer_service_plans')
      .select('id, customer_id, plan_id, billing_cycle, price, next_billing_date, failed_billing_count, status')
      .eq('status', 'active').not('next_billing_date', 'is', null).lte('next_billing_date', today)

    if (planErr) console.error('Failed to fetch service plans:', planErr)

    if (duePlans && duePlans.length > 0) {
      const planIds = [...new Set(duePlans.map(p => p.plan_id))]
      const { data: planTemplates } = await supabase.from('service_plans').select('id, name, fulfillment_type').in('id', planIds)
      const planNameMap = {}
      const planFulfillmentMap = {}
      if (planTemplates) for (const t of planTemplates) {
        planNameMap[t.id] = t.name
        planFulfillmentMap[t.id] = t.fulfillment_type
      }

      for (const plan of duePlans) {
        results.plans_processed++
        try {
          const { data: customer } = await supabase
            .from('customers').select('id, full_name, email, phone, stripe_customer_id')
            .eq('id', plan.customer_id).single()

          if (!customer || !customer.stripe_customer_id) {
            results.plans_skipped++
            results.plans_errors.push({ plan_id: plan.id, reason: 'No Stripe customer ID', customer_id: plan.customer_id })
            continue
          }

          // ── DND check (Section 2) ─────────────────────────────
          const isDnd = await isCustomerDnd(customer.id)
          if (isDnd) console.log(`[autopay] S2 DND customer — charging but skipping comms: ${customer.full_name}`)

          const { data: paymentMethod } = await supabase
            .from('payment_methods').select('id, external_id, type, last_four')
            .eq('customer_id', plan.customer_id).eq('is_default', true).eq('status', 'active').single()

          if (!paymentMethod) {
            results.plans_skipped++
            await supabase.from('customer_service_plans').update({ status: 'pending_payment_method' }).eq('id', plan.id)
            results.plans_errors.push({ plan_id: plan.id, reason: 'No default payment method', customer_name: customer.full_name })
            await supabase.from('customer_activity_log').insert({
              customer_id: plan.customer_id, event_type: 'service_plan_payment_method_required',
              title: `Service plan needs card: ${planNameMap[plan.plan_id] || 'Unknown'}`,
              actor_id: null, metadata: { plan_id: plan.id },
            }).then(() => {}).catch(() => {})
            continue
          }

          const planName = planNameMap[plan.plan_id] || 'Service Plan'
          const amountCents = Math.round(plan.price * 100)
          const description = `${planName} — ${plan.billing_cycle} charge`
          let paymentIntent, chargeSucceeded = false

          try {
            paymentIntent = await stripe.paymentIntents.create({
              amount: amountCents, currency: 'usd',
              customer: customer.stripe_customer_id,
              payment_method: paymentMethod.external_id,
              off_session: true, confirm: true, description,
              metadata: { service_plan_id: plan.id, customer_id: customer.id, type: 'service_plan' },
            })
            chargeSucceeded = paymentIntent.status === 'succeeded'
          } catch (stripeErr) {
            paymentIntent = { id: stripeErr.payment_intent?.id || null }
            chargeSucceeded = false
            results.plans_errors.push({ plan_id: plan.id, customer_name: customer.full_name, reason: stripeErr.message, stripe_code: stripeErr.code })
          }

          const { data: txRecord } = await supabase.from('payment_transactions').insert({
            customer_id: customer.id, payment_method_id: paymentMethod.id,
            amount: plan.price, status: chargeSucceeded ? 'succeeded' : 'failed',
            type: 'service_plan', external_id: paymentIntent?.id || null, description,
            attempted_at: new Date().toISOString(),
            completed_at: chargeSucceeded ? new Date().toISOString() : null,
            failure_reason: chargeSucceeded ? null : (results.plans_errors[results.plans_errors.length - 1]?.reason || 'unknown'),
          }).select('id').single()

          if (chargeSucceeded) {
            results.plans_succeeded++
            const nextDate = advanceBillingDate(plan.next_billing_date, plan.billing_cycle)
            const isOneTime = plan.billing_cycle === 'one_time'
            await supabase.from('customer_service_plans').update({
              last_billed_at: new Date().toISOString(),
              next_billing_date: isOneTime ? null : nextDate,
              failed_billing_count: 0,
              ...(isOneTime ? { status: 'completed' } : {}),
            }).eq('id', plan.id)

            await supabase.from('customer_activity_log').insert({
              customer_id: plan.customer_id, event_type: 'service_plan_payment_succeeded',
              title: `Payment succeeded: ${planName} — $${plan.price}`,
              actor_id: null, metadata: { plan_id: plan.id, amount: plan.price, payment_intent: paymentIntent?.id, next_billing_date: isOneTime ? null : nextDate },
            }).then(() => {}).catch(() => {})

            // ══════════════════════════════════════════════════
            // PHASE 3.5: Create fulfillment request for tech visit plans
            // ══════════════════════════════════════════════════
            const fulfillmentType = planFulfillmentMap[plan.plan_id]
            if (fulfillmentType === 'tech_visit' || fulfillmentType === 'maintenance_visit') {
              try {
                const { error: frError } = await supabase
                  .from('fulfillment_requests')
                  .insert({
                    customer_id: plan.customer_id,
                    customer_service_plan_id: plan.id,
                    type: fulfillmentType,
                    status: 'paid_awaiting_schedule',
                    payment_transaction_id: txRecord?.id || null,
                    due_date: today,
                    notes: `Auto-created by autopay after successful ${planName} charge`,
                  })
                if (frError) {
                  if (frError.code === '23505') {
                    console.log(`[autopay] Fulfillment request already exists for plan ${plan.id} — skipping`)
                  } else {
                    console.error(`[autopay] Failed to create fulfillment request for plan ${plan.id}:`, frError.message)
                  }
                } else {
                  results.fulfillment_created++
                }
              } catch (frErr) {
                console.error('[autopay] Fulfillment request error:', frErr.message)
              }
            }

            if (!isDnd) {
              // ── EMAIL: Service plan receipt ─────────────────
              if (customer.email) {
                const nextStr = isOneTime ? null : (nextDate
                  ? new Date(nextDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                  : null)
                await sendEmail({
                  to: customer.email,
                  subject: `Payment received — ${planName} — Zenith Pure Solutions`,
                  html: paymentReceiptHtml({
                    customerName: customer.full_name, amount: plan.price,
                    description, contractNumber: planName,
                    nextDate: nextStr, cardLast4: paymentMethod.last_four, isServicePlan: true,
                  }),
                  customer_id: customer.id, email_type: 'payment_receipt',
                })
              }

              // ── SMS: Service plan receipt ───────────────────
              if (customer.phone) {
                const firstName = (customer.full_name || 'there').split(' ')[0]
                await sendSms(customer.phone,
                  `Hi ${firstName}, your $${plan.price.toFixed(2)} ${planName} payment was received. Thank you! — Zenith Pure Solutions`,
                  customer.id)
              }
            }

          } else {
            results.plans_failed++
            const newFailCount = (plan.failed_billing_count || 0) + 1
            const shouldEscalate = newFailCount >= 3
            await supabase.from('customer_service_plans').update({
              failed_billing_count: newFailCount,
              ...(shouldEscalate ? { status: 'payment_failed' } : {}),
            }).eq('id', plan.id)

            await supabase.from('follow_up_tasks').insert({
              entity_type: 'customer', entity_id: customer.id,
              title: `Service plan payment failed — ${customer.full_name}`,
              description: `${planName} charge of $${plan.price} failed (attempt ${newFailCount}).${shouldEscalate ? ' Plan billing suspended after 3 failures.' : ' Will retry tomorrow.'} Reason: ${results.plans_errors[results.plans_errors.length - 1]?.reason || 'unknown'}`,
              due_date: today, status: 'pending', priority: shouldEscalate ? 'urgent' : 'high',
            })

            await supabase.from('customer_activity_log').insert({
              customer_id: plan.customer_id, event_type: 'service_plan_payment_failed',
              title: `Payment failed: ${planName} — attempt ${newFailCount}${shouldEscalate ? ' (SUSPENDED)' : ''}`,
              actor_id: null, metadata: { plan_id: plan.id, amount: plan.price, failed_count: newFailCount, escalated: shouldEscalate },
            }).then(() => {}).catch(() => {})

            if (!isDnd) {
              // ── EMAIL: Service plan failure ─────────────────
              if (customer.email) {
                await sendEmail({
                  to: customer.email,
                  subject: `Payment failed — ${planName} — action required — Zenith Pure Solutions`,
                  html: paymentFailedHtml({
                    customerName: customer.full_name, amount: plan.price,
                    description, contractNumber: planName,
                    attemptCount: newFailCount, isFinal: shouldEscalate, isServicePlan: true,
                  }),
                  customer_id: customer.id, email_type: 'payment_failed',
                })
              }

              // ── SMS: Service plan failure ───────────────────
              if (customer.phone) {
                const firstName = (customer.full_name || 'there').split(' ')[0]
                const msg = shouldEscalate
                  ? `Hi ${firstName}, your ${planName} payment failed after 3 attempts. Your plan is paused. Please call us at (317) 690-4172. — Zenith Pure Solutions`
                  : `Hi ${firstName}, your ${planName} payment of $${plan.price.toFixed(2)} failed. Please call us at (317) 690-4172 to update your card. — Zenith Pure Solutions`
                await sendSms(customer.phone, msg, customer.id)
              }
            }
          }

        } catch (err) {
          results.plans_failed++
          results.plans_errors.push({ plan_id: plan.id, reason: err.message || 'Unknown error' })
        }
      }
    }

    // ══════════════════════════════════════════════════════════
    // SECTION 3: RETRY PAYMENT_FAILED PLANS
    // ══════════════════════════════════════════════════════════

    const { data: failedPlans } = await supabase
      .from('customer_service_plans')
      .select('id, customer_id, plan_id, billing_cycle, price, next_billing_date, failed_billing_count')
      .eq('status', 'payment_failed')

    if (failedPlans && failedPlans.length > 0) {
      const planIds = [...new Set(failedPlans.map(p => p.plan_id))]
      const { data: retryTemplates } = await supabase.from('service_plans').select('id, name').in('id', planIds)
      const retryNameMap = {}
      if (retryTemplates) for (const t of retryTemplates) retryNameMap[t.id] = t.name

      for (const plan of failedPlans) {
        try {
          const { data: customer } = await supabase
            .from('customers').select('id, full_name, email, phone, stripe_customer_id')
            .eq('id', plan.customer_id).single()

          if (!customer?.stripe_customer_id) continue

          // ── DND check (Section 3) ─────────────────────────────
          const isDnd = await isCustomerDnd(customer.id)

          const { data: paymentMethod } = await supabase
            .from('payment_methods').select('id, external_id, last_four')
            .eq('customer_id', plan.customer_id).eq('is_default', true).eq('status', 'active').single()

          if (!paymentMethod) continue

          const planName = retryNameMap[plan.plan_id] || 'Service Plan'
          const amountCents = Math.round(plan.price * 100)
          const description = `${planName} — retry charge`
          let chargeSucceeded = false
          let paymentIntent = null

          try {
            paymentIntent = await stripe.paymentIntents.create({
              amount: amountCents, currency: 'usd',
              customer: customer.stripe_customer_id,
              payment_method: paymentMethod.external_id,
              off_session: true, confirm: true, description,
              metadata: { service_plan_id: plan.id, customer_id: customer.id, type: 'service_plan_retry' },
            })
            chargeSucceeded = paymentIntent.status === 'succeeded'
          } catch (stripeErr) {
            chargeSucceeded = false
          }

          await supabase.from('payment_transactions').insert({
            customer_id: customer.id, payment_method_id: paymentMethod.id,
            amount: plan.price, status: chargeSucceeded ? 'succeeded' : 'failed',
            type: 'service_plan_retry', external_id: paymentIntent?.id || null, description,
            attempted_at: new Date().toISOString(),
            completed_at: chargeSucceeded ? new Date().toISOString() : null,
          })

          if (chargeSucceeded) {
            const nextDate = advanceBillingDate(today, plan.billing_cycle)
            await supabase.from('customer_service_plans').update({
              status: 'active', failed_billing_count: 0,
              last_billed_at: new Date().toISOString(), next_billing_date: nextDate,
            }).eq('id', plan.id)

            await supabase.from('customer_activity_log').insert({
              customer_id: plan.customer_id, event_type: 'service_plan_retry_succeeded',
              title: `Payment retry succeeded: ${planName} — $${plan.price} — plan reactivated`,
              actor_id: null, metadata: { plan_id: plan.id, amount: plan.price },
            }).then(() => {}).catch(() => {})

            if (!isDnd) {
              if (customer.email) {
                await sendEmail({
                  to: customer.email,
                  subject: `Payment received — ${planName} — Zenith Pure Solutions`,
                  html: paymentReceiptHtml({
                    customerName: customer.full_name, amount: plan.price,
                    description: `${planName} — account reactivated`, contractNumber: planName,
                    nextDate: nextDate ? new Date(nextDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null,
                    cardLast4: paymentMethod.last_four, isServicePlan: true,
                  }),
                  customer_id: customer.id, email_type: 'payment_receipt',
                })
              }

              if (customer.phone) {
                const firstName = (customer.full_name || 'there').split(' ')[0]
                await sendSms(customer.phone,
                  `Hi ${firstName}, your ${planName} payment was successful and your plan is reactivated! Thank you. — Zenith Pure Solutions`,
                  customer.id)
              }
            }

            results.plans_succeeded++
          } else {
            await supabase.from('customer_activity_log').insert({
              customer_id: plan.customer_id, event_type: 'service_plan_retry_failed',
              title: `Payment retry failed: ${planName} — manual action required`,
              actor_id: null, metadata: { plan_id: plan.id },
            }).then(() => {}).catch(() => {})
            results.plans_failed++
          }

        } catch (err) {
          console.error('[autopay] Section 3 retry error:', err.message)
        }
      }
    }

    // ── Internal summary log ──────────────────────────────────────
    const totalProcessed = results.processed + results.plans_processed
    if (totalProcessed > 0) {
      const subject = [
        `Autopay: ${results.succeeded}/${results.processed} rentals`,
        results.plans_processed > 0 ? `${results.plans_succeeded}/${results.plans_processed} plans` : null,
        (results.failed + results.plans_failed) > 0 ? `${results.failed + results.plans_failed} failed` : null,
        results.fulfillment_created > 0 ? `${results.fulfillment_created} fulfillment queued` : null,
      ].filter(Boolean).join(', ')

      await supabase.from('email_log').insert({
        customer_id: '00000000-0000-0000-0000-000000000000',
        email_type: 'autopay_summary', to_address: 'system@zenithpuresolutions.com',
        subject, status: 'sent', sent_at: new Date().toISOString(),
      }).then(({ error }) => { if (error) console.error('Failed to log autopay summary:', error) })
    }

    return res.status(200).json({ message: 'Autopay run complete', date: today, ...results })

  } catch (err) {
    console.error('Autopay cron error:', err)
    return res.status(500).json({ error: 'Internal server error', message: err.message })
  }
}

function advanceBillingDate(dateStr, cycle) {
  const d = new Date(dateStr + 'T00:00:00')
  switch (cycle) {
    case 'monthly':   d.setMonth(d.getMonth() + 1); break
    case 'quarterly': d.setMonth(d.getMonth() + 3); break
    case 'yearly':    d.setFullYear(d.getFullYear() + 1); break
    case 'one_time':  return null
    default:          d.setMonth(d.getMonth() + 1)
  }
  return d.toISOString().split('T')[0]
}
