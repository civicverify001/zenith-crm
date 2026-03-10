// api/cron/autopay.js
// Vercel Cron Job — runs daily at 6 AM EST
// Finds rental contracts due for billing, charges default payment method
//
// Add to vercel.json:
// {
//   "crons": [{ "path": "/api/cron/autopay", "schedule": "0 11 * * *" }]
// }
// (11 UTC = 6 AM EST)

import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' })

export default async function handler(req, res) {
  // Verify this is a cron call (Vercel sends this header)
  // Or allow manual trigger with a secret
  const authHeader = req.headers.authorization
  const cronSecret = process.env.CRON_SECRET
  const isCron = req.headers['x-vercel-cron'] === '1'
  const isManual = cronSecret && authHeader === `Bearer ${cronSecret}`

  if (!isCron && !isManual) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const results = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  }

  try {
    const today = new Date().toISOString().slice(0, 10)
    const dayOfMonth = new Date().getDate()

    // ─── 1. Find active rental contracts due for billing ───
    // A contract is due if:
    // - status = 'active'
    // - type = 'rental'
    // - has a monthly_amount > 0
    // We check if there's already a successful payment this month to avoid double-charging
    const { data: contracts, error: contractErr } = await supabase
      .from('contracts')
      .select(`
        id, customer_id, monthly_amount, contract_number, start_date,
        billing_day, notes
      `)
      .eq('status', 'active')
      .eq('type', 'rental')
      .gt('monthly_amount', 0)

    if (contractErr) {
      console.error('Failed to fetch contracts:', contractErr)
      return res.status(500).json({ error: 'Failed to fetch contracts', details: contractErr.message })
    }

    if (!contracts || contracts.length === 0) {
      return res.status(200).json({ message: 'No active rental contracts found', ...results })
    }

    // ─── 2. Process each contract ───────────────────────────
    for (const contract of contracts) {
      results.processed++

      try {
        // Determine billing day (default to 1st of month if not set)
        const billingDay = contract.billing_day || 1
        if (dayOfMonth !== billingDay) {
          results.skipped++
          continue
        }

        // Check if already charged this month
        const monthStart = new Date()
        monthStart.setDate(1)
        monthStart.setHours(0, 0, 0, 0)

        const { data: existingTx } = await supabase
          .from('payment_transactions')
          .select('id')
          .eq('contract_id', contract.id)
          .eq('status', 'succeeded')
          .eq('type', 'autopay')
          .gte('attempted_at', monthStart.toISOString())
          .limit(1)

        if (existingTx && existingTx.length > 0) {
          results.skipped++
          continue // Already charged this month
        }

        // Get customer with Stripe ID
        const { data: customer } = await supabase
          .from('customers')
          .select('id, full_name, phone, email, stripe_customer_id')
          .eq('id', contract.customer_id)
          .single()

        if (!customer || !customer.stripe_customer_id) {
          results.skipped++
          results.errors.push({
            contract_id: contract.id,
            reason: 'No Stripe customer ID',
            customer_id: contract.customer_id,
          })
          continue
        }

        // Get default payment method
        const { data: paymentMethod } = await supabase
          .from('payment_methods')
          .select('id, external_id, type, last_four')
          .eq('customer_id', contract.customer_id)
          .eq('is_default', true)
          .eq('status', 'active')
          .single()

        if (!paymentMethod) {
          results.skipped++
          results.errors.push({
            contract_id: contract.id,
            reason: 'No default payment method',
            customer_name: customer.full_name,
          })

          // Create a follow-up task for missing payment method
          await supabase.from('follow_ups').insert({
            entity_type: 'customer',
            entity_id: customer.id,
            title: `Missing payment method — ${customer.full_name}`,
            description: `Autopay skipped for contract ${contract.contract_number}. No default payment method on file.`,
            due_date: today,
            status: 'pending',
            priority: 'high',
          })
          continue
        }

        // ─── 3. Charge via Stripe ─────────────────────────
        const amountCents = Math.round(contract.monthly_amount * 100)
        const description = `Monthly rental — Contract ${contract.contract_number || contract.id.slice(0, 8)}`

        let paymentIntent
        let chargeSucceeded = false

        try {
          paymentIntent = await stripe.paymentIntents.create({
            amount: amountCents,
            currency: 'usd',
            customer: customer.stripe_customer_id,
            payment_method: paymentMethod.external_id,
            off_session: true,
            confirm: true,
            description,
            metadata: {
              contract_id: contract.id,
              customer_id: customer.id,
              type: 'autopay',
            },
          })
          chargeSucceeded = paymentIntent.status === 'succeeded'
        } catch (stripeErr) {
          // Stripe charge failed
          paymentIntent = { id: stripeErr.payment_intent?.id || null }
          chargeSucceeded = false

          results.errors.push({
            contract_id: contract.id,
            customer_name: customer.full_name,
            reason: stripeErr.message,
            stripe_code: stripeErr.code,
          })
        }

        // ─── 4. Log transaction ─────────────────────────────
        await supabase.from('payment_transactions').insert({
          customer_id: customer.id,
          contract_id: contract.id,
          payment_method_id: paymentMethod.id,
          amount: contract.monthly_amount,
          status: chargeSucceeded ? 'succeeded' : 'failed',
          type: 'autopay',
          external_id: paymentIntent?.id || null,
          description,
          attempted_at: new Date().toISOString(),
          completed_at: chargeSucceeded ? new Date().toISOString() : null,
          failure_reason: chargeSucceeded ? null : (results.errors[results.errors.length - 1]?.reason || 'unknown'),
        })

        if (chargeSucceeded) {
          results.succeeded++

          // Update contract last_billed_at
          await supabase.from('contracts').update({
            last_billed_at: new Date().toISOString(),
          }).eq('id', contract.id)

          // Log audit
          await supabase.from('document_audit_log').insert({
            entity_type: 'contract',
            entity_id: contract.id,
            event: 'autopay_succeeded',
            actor_type: 'system',
            metadata: {
              amount: contract.monthly_amount,
              payment_intent: paymentIntent?.id,
            },
          })

        } else {
          results.failed++

          // ─── 5. Create follow-up task for failed payment ──
          await supabase.from('follow_ups').insert({
            entity_type: 'customer',
            entity_id: customer.id,
            title: `Failed payment — ${customer.full_name}`,
            description: `Autopay failed for contract ${contract.contract_number || ''}. Amount: $${contract.monthly_amount}. Reason: ${results.errors[results.errors.length - 1]?.reason || 'unknown'}. Contact customer to update payment method.`,
            due_date: today,
            status: 'pending',
            priority: 'urgent',
          })

          // Log audit
          await supabase.from('document_audit_log').insert({
            entity_type: 'contract',
            entity_id: contract.id,
            event: 'autopay_failed',
            actor_type: 'system',
            metadata: {
              amount: contract.monthly_amount,
              reason: results.errors[results.errors.length - 1]?.reason,
            },
          })
        }

      } catch (err) {
        results.failed++
        results.errors.push({
          contract_id: contract.id,
          reason: err.message || 'Unknown error',
        })
      }
    }

    // ─── 6. Log summary to email_log for audit ──────────────
    if (results.processed > 0) {
      await supabase.from('email_log').insert({
        customer_id: '00000000-0000-0000-0000-000000000000', // system
        email_type: 'autopay_summary',
        to_address: 'system@zenithpuresolutions.com',
        subject: `Autopay Run: ${results.succeeded} succeeded, ${results.failed} failed`,
        status: 'sent',
        sent_at: new Date().toISOString(),
      }).then(({ error }) => {
        if (error) console.error('Failed to log autopay summary:', error)
      })
    }

    return res.status(200).json({
      message: 'Autopay run complete',
      date: today,
      ...results,
    })

  } catch (err) {
    console.error('Autopay cron error:', err)
    return res.status(500).json({ error: 'Internal server error', message: err.message })
  }
}
