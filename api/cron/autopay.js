// api/cron/autopay.js
// Vercel Cron Job — runs daily at 6 AM EST
// Section 1: Charges rental contracts on their billing_day
// Section 2: Charges service plans where next_billing_date <= today
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
  const authHeader = req.headers.authorization
  const cronSecret = process.env.CRON_SECRET
  const isCron = req.headers['x-vercel-cron'] === '1'
  const isManual = cronSecret && authHeader === `Bearer ${cronSecret}`

  if (!isCron && !isManual) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const results = {
    // Rental results
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    // Service plan results
    plans_processed: 0,
    plans_succeeded: 0,
    plans_failed: 0,
    plans_skipped: 0,
    plans_errors: [],
  }

  try {
    const today = new Date().toISOString().slice(0, 10)
    const dayOfMonth = new Date().getDate()

    // ══════════════════════════════════════════════════════════
    // SECTION 1: RENTAL CONTRACT BILLING (unchanged logic)
    // ══════════════════════════════════════════════════════════

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
      console.log('No active rental contracts found')
    } else {
      for (const contract of contracts) {
        results.processed++

        try {
          const billingDay = contract.billing_day || 1
          if (dayOfMonth !== billingDay) {
            results.skipped++
            continue
          }

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
            continue
          }

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

            await supabase.from('follow_up_tasks').insert({
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
            paymentIntent = { id: stripeErr.payment_intent?.id || null }
            chargeSucceeded = false

            results.errors.push({
              contract_id: contract.id,
              customer_name: customer.full_name,
              reason: stripeErr.message,
              stripe_code: stripeErr.code,
            })
          }

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

            await supabase.from('contracts').update({
              last_billed_at: new Date().toISOString(),
            }).eq('id', contract.id)

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

            await supabase.from('follow_up_tasks').insert({
              entity_type: 'customer',
              entity_id: customer.id,
              title: `Failed payment — ${customer.full_name}`,
              description: `Autopay failed for contract ${contract.contract_number || ''}. Amount: $${contract.monthly_amount}. Reason: ${results.errors[results.errors.length - 1]?.reason || 'unknown'}. Contact customer to update payment method.`,
              due_date: today,
              status: 'pending',
              priority: 'urgent',
            })

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
    }

    // ══════════════════════════════════════════════════════════
    // SECTION 2: SERVICE PLAN BILLING
    // ══════════════════════════════════════════════════════════
    // Charges active service plans where next_billing_date <= today.
    // Unlike rental contracts (which use billing_day matching),
    // service plans use an explicit next_billing_date that advances
    // by the plan's billing cycle after each successful charge.

    const { data: duePlans, error: planErr } = await supabase
      .from('customer_service_plans')
      .select('id, customer_id, plan_id, billing_cycle, price, next_billing_date, failed_billing_count, status')
      .eq('status', 'active')
      .not('next_billing_date', 'is', null)
      .lte('next_billing_date', today)

    if (planErr) {
      console.error('Failed to fetch service plans:', planErr)
      // Don't return — rental billing already completed above
    }

    if (duePlans && duePlans.length > 0) {
      // Fetch plan names for descriptions
      const planIds = [...new Set(duePlans.map(p => p.plan_id))]
      const { data: planTemplates } = await supabase
        .from('service_plans')
        .select('id, name')
        .in('id', planIds)

      const planNameMap = {}
      if (planTemplates) {
        for (const t of planTemplates) { planNameMap[t.id] = t.name }
      }

      for (const plan of duePlans) {
        results.plans_processed++

        try {
          // ── Get customer + Stripe info ──────────────────────
          const { data: customer } = await supabase
            .from('customers')
            .select('id, full_name, email, stripe_customer_id')
            .eq('id', plan.customer_id)
            .single()

          if (!customer || !customer.stripe_customer_id) {
            results.plans_skipped++
            results.plans_errors.push({
              plan_id: plan.id,
              reason: 'No Stripe customer ID',
              customer_id: plan.customer_id,
            })
            continue
          }

          // ── Get default payment method ──────────────────────
          const { data: paymentMethod } = await supabase
            .from('payment_methods')
            .select('id, external_id, type, last_four')
            .eq('customer_id', plan.customer_id)
            .eq('is_default', true)
            .eq('status', 'active')
            .single()

          if (!paymentMethod) {
            results.plans_skipped++

            // Transition to pending_payment_method
            await supabase.from('customer_service_plans').update({
              status: 'pending_payment_method',
            }).eq('id', plan.id)

            results.plans_errors.push({
              plan_id: plan.id,
              reason: 'No default payment method — plan moved to pending_payment_method',
              customer_name: customer.full_name,
            })

            // Activity log
            try {
              await supabase.from('customer_activity_log').insert({
                customer_id: plan.customer_id,
                event_type: 'service_plan_payment_method_required',
                title: `Service plan needs card: ${planNameMap[plan.plan_id] || 'Unknown'}`,
                actor_id: null,
                metadata: { plan_id: plan.id },
              })
            } catch (e) { /* best effort */ }

            continue
          }

          // ── Charge via Stripe ───────────────────────────────
          const planName = planNameMap[plan.plan_id] || 'Service Plan'
          const amountCents = Math.round(plan.price * 100)
          const description = `${planName} — ${plan.billing_cycle} charge`

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
                service_plan_id: plan.id,
                customer_id: customer.id,
                type: 'service_plan',
              },
            })
            chargeSucceeded = paymentIntent.status === 'succeeded'
          } catch (stripeErr) {
            paymentIntent = { id: stripeErr.payment_intent?.id || null }
            chargeSucceeded = false

            results.plans_errors.push({
              plan_id: plan.id,
              customer_name: customer.full_name,
              reason: stripeErr.message,
              stripe_code: stripeErr.code,
            })
          }

          // ── Log transaction ─────────────────────────────────
          await supabase.from('payment_transactions').insert({
            customer_id: customer.id,
            payment_method_id: paymentMethod.id,
            amount: plan.price,
            status: chargeSucceeded ? 'succeeded' : 'failed',
            type: 'service_plan',
            external_id: paymentIntent?.id || null,
            description,
            attempted_at: new Date().toISOString(),
            completed_at: chargeSucceeded ? new Date().toISOString() : null,
            failure_reason: chargeSucceeded ? null : (results.plans_errors[results.plans_errors.length - 1]?.reason || 'unknown'),
          })

          if (chargeSucceeded) {
            // ── SUCCESS: advance billing date ─────────────────
            results.plans_succeeded++

            const nextDate = advanceBillingDate(plan.next_billing_date, plan.billing_cycle)
            const isOneTime = plan.billing_cycle === 'one_time'

            await supabase.from('customer_service_plans').update({
              last_billed_at: new Date().toISOString(),
              next_billing_date: isOneTime ? null : nextDate,
              failed_billing_count: 0,
              // One-time plans with no fulfillment: mark completed
              ...(isOneTime ? { status: 'completed' } : {}),
            }).eq('id', plan.id)

            // Activity log
            try {
              await supabase.from('customer_activity_log').insert({
                customer_id: plan.customer_id,
                event_type: 'service_plan_payment_succeeded',
                title: `Payment succeeded: ${planName} — $${plan.price}`,
                actor_id: null,
                metadata: {
                  plan_id: plan.id,
                  amount: plan.price,
                  payment_intent: paymentIntent?.id,
                  next_billing_date: isOneTime ? null : nextDate,
                },
              })
            } catch (e) { /* best effort */ }

          } else {
            // ── FAILURE: increment counter, maybe escalate ────
            results.plans_failed++

            const newFailCount = (plan.failed_billing_count || 0) + 1
            const shouldEscalate = newFailCount >= 3

            await supabase.from('customer_service_plans').update({
              failed_billing_count: newFailCount,
              ...(shouldEscalate ? { status: 'payment_failed' } : {}),
            }).eq('id', plan.id)

            // Create follow-up task
            await supabase.from('follow_up_tasks').insert({
              entity_type: 'customer',
              entity_id: customer.id,
              title: `Service plan payment failed — ${customer.full_name}`,
              description: `${planName} charge of $${plan.price} failed (attempt ${newFailCount}).${shouldEscalate ? ' Plan billing suspended after 3 failures.' : ' Will retry tomorrow.'} Reason: ${results.plans_errors[results.plans_errors.length - 1]?.reason || 'unknown'}`,
              due_date: today,
              status: 'pending',
              priority: shouldEscalate ? 'urgent' : 'high',
            })

            // Activity log
            try {
              await supabase.from('customer_activity_log').insert({
                customer_id: plan.customer_id,
                event_type: 'service_plan_payment_failed',
                title: `Payment failed: ${planName} — attempt ${newFailCount}${shouldEscalate ? ' (SUSPENDED)' : ''}`,
                actor_id: null,
                metadata: {
                  plan_id: plan.id,
                  amount: plan.price,
                  failed_count: newFailCount,
                  escalated: shouldEscalate,
                },
              })
            } catch (e) { /* best effort */ }
          }

        } catch (err) {
          results.plans_failed++
          results.plans_errors.push({
            plan_id: plan.id,
            reason: err.message || 'Unknown error',
          })
        }
      }
    }

    // ── Summary email log ─────────────────────────────────────
    const totalProcessed = results.processed + results.plans_processed
    if (totalProcessed > 0) {
      const subject = [
        `Autopay: ${results.succeeded}/${results.processed} rentals`,
        results.plans_processed > 0 ? `${results.plans_succeeded}/${results.plans_processed} plans` : null,
        (results.failed + results.plans_failed) > 0 ? `${results.failed + results.plans_failed} failed` : null,
      ].filter(Boolean).join(', ')

      await supabase.from('email_log').insert({
        customer_id: '00000000-0000-0000-0000-000000000000',
        email_type: 'autopay_summary',
        to_address: 'system@zenithpuresolutions.com',
        subject,
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

// ── Helper: advance billing date by cycle ─────────────────────
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
