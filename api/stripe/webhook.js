// api/stripe/webhook.js
// Handles Stripe webhook events after checkout completes
// Wires: payment_methods, payment_transactions, contracts (active), invoices (paid)

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
