import { supabase } from '../lib/supabase'
import { updateCustomerLifecycle } from './lifecycleService'

interface ActorInfo { actor_id: string; actor_name?: string }

// ═══════════════════════════════════════════════════════════════
// RECORD PAYMENT
// ═══════════════════════════════════════════════════════════════
export async function recordPayment(
  contractId: string, amount: number, paymentDate: string, actor: ActorInfo
): Promise<void> {
  const { error: payErr } = await supabase.from('rental_payments').insert({
    rental_contract_id: contractId, amount, payment_date: paymentDate, status: 'paid',
  })
  if (payErr) throw new Error(`Payment recording failed: ${payErr.message}`)

  // Update contract totals
  const { data: contract } = await supabase.from('rental_contracts').select('total_paid, payments_made, customer_id').eq('id', contractId).single()
  if (contract) {
    await supabase.from('rental_contracts').update({
      total_paid: Number(contract.total_paid) + amount,
      payments_made: contract.payments_made + 1,
      last_payment_date: paymentDate,
      rental_risk_status: null, // Clear risk on payment
    }).eq('id', contractId)

    await supabase.from('customer_activity_log').insert({
      customer_id: contract.customer_id, event_type: 'rental_payment_received',
      title: `Rental payment received: $${amount.toFixed(2)}`,
      metadata: { contract_id: contractId, amount, payment_date: paymentDate },
      actor_id: actor.actor_id, actor_name: actor.actor_name || null,
    }).then(() => {}).catch(() => {})

    await updateCustomerLifecycle(contract.customer_id)
  }
}

// ═══════════════════════════════════════════════════════════════
// REVERSE PAYMENT
// ═══════════════════════════════════════════════════════════════
export async function reversePayment(paymentId: string, actor: ActorInfo): Promise<void> {
  const { data: payment } = await supabase.from('rental_payments').select('*').eq('id', paymentId).single()
  if (!payment) throw new Error('Payment not found')

  await supabase.from('rental_payments').update({ status: 'reversed' }).eq('id', paymentId)

  const { data: contract } = await supabase.from('rental_contracts').select('total_paid, payments_made, customer_id').eq('id', payment.rental_contract_id).single()
  if (contract) {
    await supabase.from('rental_contracts').update({
      total_paid: Math.max(0, Number(contract.total_paid) - Number(payment.amount)),
      payments_made: Math.max(0, contract.payments_made - 1),
    }).eq('id', payment.rental_contract_id)

    await evaluateRentalRisk(payment.rental_contract_id)
  }
}

// ═══════════════════════════════════════════════════════════════
// EVALUATE RENTAL RISK
// 5 days late = at_risk, 10 = delinquent, 20 = termination_pending
// ═══════════════════════════════════════════════════════════════
export async function evaluateRentalRisk(contractId: string): Promise<string | null> {
  const { data: contract } = await supabase.from('rental_contracts').select('*').eq('id', contractId).single()
  if (!contract || contract.status !== 'active') return null

  const lastPayment = contract.last_payment_date || contract.start_date
  const expectedNext = new Date(lastPayment + 'T00:00:00')
  expectedNext.setMonth(expectedNext.getMonth() + 1)

  const today = new Date()
  const daysLate = Math.floor((today.getTime() - expectedNext.getTime()) / 86400000)

  let newRisk: string | null = null
  if (daysLate >= 20) newRisk = 'termination_pending'
  else if (daysLate >= 10) newRisk = 'delinquent'
  else if (daysLate >= 5) newRisk = 'at_risk'

  if (newRisk !== contract.rental_risk_status) {
    await supabase.from('rental_contracts').update({ rental_risk_status: newRisk }).eq('id', contractId)

    await supabase.from('customer_activity_log').insert({
      customer_id: contract.customer_id, event_type: 'rental_risk_changed',
      title: newRisk ? `Rental risk: ${newRisk.replace(/_/g, ' ')}` : 'Rental risk cleared',
      metadata: { contract_id: contractId, from: contract.rental_risk_status, to: newRisk, days_late: daysLate },
      actor_id: '00000000-0000-0000-0000-000000000000', actor_name: 'System',
    }).then(() => {}).catch(() => {})

    await updateCustomerLifecycle(contract.customer_id)
  }

  return newRisk
}
