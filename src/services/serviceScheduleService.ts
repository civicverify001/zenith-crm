import { supabase } from '../lib/supabase'
import { evaluateWarrantyForSystem } from './warrantyService'

function addMonths(date: string, months: number): string {
  const d = new Date(date + 'T00:00:00'); d.setMonth(d.getMonth() + months); return d.toISOString().split('T')[0]
}

function today(): string { return new Date().toISOString().split('T')[0] }

function daysBetween(a: string, b: string): number {
  return Math.floor((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000)
}

// ═══════════════════════════════════════════════════════════════
// GENERATE NEXT SCHEDULE ITEM
// Called after a service completion or during initial seeding
// ═══════════════════════════════════════════════════════════════
export async function generateNextItem(complianceRequirementId: string, fromDate: string): Promise<void> {
  const { data: req } = await supabase.from('compliance_requirements').select('*').eq('id', complianceRequirementId).single()
  if (!req) return

  const dueDate = addMonths(fromDate, req.interval_months)
  const graceExpiry = addMonths(dueDate, req.grace_period_months)

  await supabase.from('service_schedule_items').insert({
    compliance_requirement_id: complianceRequirementId,
    installed_system_id: req.installed_system_id,
    customer_id: req.customer_id,
    due_date: dueDate,
    grace_expiry_date: graceExpiry,
    status: 'upcoming',
  })
}

// ═══════════════════════════════════════════════════════════════
// EVALUATE SINGLE ITEM (FIX #4)
// ═══════════════════════════════════════════════════════════════
export async function evaluateItem(itemId: string): Promise<string> {
  const { data: item } = await supabase.from('service_schedule_items').select('*').eq('id', itemId).single()
  if (!item || item.status === 'completed' || item.status === 'skipped') return item?.status || 'unknown'

  const t = today()
  const daysUntilDue = daysBetween(t, item.due_date)
  let newStatus: string

  if (daysUntilDue > 30) newStatus = 'upcoming'
  else if (daysUntilDue > 0) newStatus = 'due_soon'
  else newStatus = 'overdue'

  if (newStatus !== item.status) {
    await supabase.from('service_schedule_items').update({ status: newStatus, status_evaluated_at: new Date().toISOString() }).eq('id', itemId)

    // Newly overdue triggers warranty re-eval
    if (newStatus === 'overdue' && item.status !== 'overdue') {
      await evaluateWarrantyForSystem(item.installed_system_id)
    }
  }

  return newStatus
}

// ═══════════════════════════════════════════════════════════════
// EVALUATE BY SYSTEM (FIX #4)
// ═══════════════════════════════════════════════════════════════
export async function evaluateForSystem(installedSystemId: string): Promise<void> {
  const { data: items } = await supabase.from('service_schedule_items').select('id')
    .eq('installed_system_id', installedSystemId).in('status', ['upcoming', 'due_soon', 'overdue'])
  for (const item of (items || [])) { await evaluateItem(item.id) }
}

// ═══════════════════════════════════════════════════════════════
// EVALUATE BY CUSTOMER (FIX #4)
// ═══════════════════════════════════════════════════════════════
export async function evaluateForCustomer(customerId: string): Promise<void> {
  const { data: items } = await supabase.from('service_schedule_items').select('id')
    .eq('customer_id', customerId).in('status', ['upcoming', 'due_soon', 'overdue'])
  for (const item of (items || [])) { await evaluateItem(item.id) }
}

// ═══════════════════════════════════════════════════════════════
// EVALUATE GLOBAL (FIX #4 + #7: required cron)
// ═══════════════════════════════════════════════════════════════
export async function evaluateGlobal(): Promise<{ evaluated: number; changed: number }> {
  const { data: items } = await supabase.from('service_schedule_items').select('id, status, due_date')
    .in('status', ['upcoming', 'due_soon', 'overdue']).order('due_date').limit(1000)

  let evaluated = 0, changed = 0
  for (const item of (items || [])) {
    const oldStatus = item.status
    const newStatus = await evaluateItem(item.id)
    evaluated++
    if (newStatus !== oldStatus) changed++
  }
  return { evaluated, changed }
}

// ═══════════════════════════════════════════════════════════════
// COMPLETE A SERVICE (records completion + generates next item)
// ═══════════════════════════════════════════════════════════════
export async function completeService(
  scheduleItemId: string,
  completedBy: string,
  purchasedThroughZenith: boolean,
  cost?: number,
  notes?: string
): Promise<string> {
  const { data: item } = await supabase.from('service_schedule_items').select('*').eq('id', scheduleItemId).single()
  if (!item) throw new Error('Schedule item not found')

  // Create completion record
  const { data: completion, error: compErr } = await supabase.from('service_completions').insert({
    service_schedule_item_id: scheduleItemId,
    compliance_requirement_id: item.compliance_requirement_id,
    installed_system_id: item.installed_system_id,
    customer_id: item.customer_id,
    completed_date: today(),
    completed_by: completedBy,
    purchased_through_zenith: purchasedThroughZenith,
    cost, notes,
  }).select('id').single()

  if (compErr) throw new Error(`Completion failed: ${compErr.message}`)

  // Mark schedule item completed
  await supabase.from('service_schedule_items').update({
    status: 'completed', service_completion_id: (completion as any).id, completed_at: new Date().toISOString(),
  }).eq('id', scheduleItemId)

  // Generate next schedule item
  await generateNextItem(item.compliance_requirement_id, today())

  // Re-evaluate warranty for this system
  await evaluateWarrantyForSystem(item.installed_system_id)

  return (completion as any).id
}
