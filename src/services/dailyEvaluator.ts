import { supabase } from '../lib/supabase'
import { evaluateGlobal } from './serviceScheduleService'
import { evaluateRentalRisk } from './rentalService'
import { updateCustomerLifecycle } from './lifecycleService'

// ═══════════════════════════════════════════════════════════════
// DAILY EVALUATOR — REQUIRED INFRASTRUCTURE (FIX #7)
//
// Phase 1: Admin-callable function from UI
// Phase 2: Supabase Edge Function on pg_cron (daily at 2am)
//
// Without this, warranty statuses go stale, rental risk is never
// updated between page loads, and lifecycle becomes unreliable.
// ═══════════════════════════════════════════════════════════════

export interface EvaluationResult {
  scheduleItemsEvaluated: number
  scheduleItemsChanged: number
  rentalContractsChecked: number
  rentalRiskChanges: number
  customersUpdated: number
  errors: string[]
  durationMs: number
}

export async function runDailyEvaluation(): Promise<EvaluationResult> {
  const start = Date.now()
  const result: EvaluationResult = {
    scheduleItemsEvaluated: 0, scheduleItemsChanged: 0,
    rentalContractsChecked: 0, rentalRiskChanges: 0,
    customersUpdated: 0, errors: [], durationMs: 0,
  }

  // ── 1. Evaluate all service schedule items ──
  try {
    const schedResult = await evaluateGlobal()
    result.scheduleItemsEvaluated = schedResult.evaluated
    result.scheduleItemsChanged = schedResult.changed
  } catch (e: any) {
    result.errors.push(`Schedule evaluation failed: ${e.message}`)
  }

  // ── 2. Evaluate all active rental contracts ──
  try {
    const { data: contracts } = await supabase.from('rental_contracts').select('id')
      .eq('status', 'active').eq('buyout_completed', false)

    for (const contract of (contracts || [])) {
      result.rentalContractsChecked++
      try {
        const oldRisk = contract.rental_risk_status
        const newRisk = await evaluateRentalRisk(contract.id)
        if (newRisk !== oldRisk) result.rentalRiskChanges++
      } catch (e: any) {
        result.errors.push(`Rental risk eval failed for ${contract.id}: ${e.message}`)
      }
    }
  } catch (e: any) {
    result.errors.push(`Rental risk batch failed: ${e.message}`)
  }

  // ── 3. Update lifecycle for all active customers ──
  try {
    const { data: customers } = await supabase.from('customers').select('id').limit(500)

    for (const cust of (customers || [])) {
      try {
        await updateCustomerLifecycle(cust.id)
        result.customersUpdated++
      } catch (e: any) {
        result.errors.push(`Lifecycle update failed for ${cust.id}: ${e.message}`)
      }
    }
  } catch (e: any) {
    result.errors.push(`Lifecycle batch failed: ${e.message}`)
  }

  result.durationMs = Date.now() - start
  return result
}
