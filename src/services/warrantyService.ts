import { supabase } from '../lib/supabase'
import { updateCustomerLifecycle } from './lifecycleService'

function today(): string { return new Date().toISOString().split('T')[0] }

// ═══════════════════════════════════════════════════════════════
// EVALUATE WARRANTY FOR SINGLE SYSTEM
// Reads compliance requirements, schedule items, maintenance plan
// Determines valid/warning/void based on combined state
// ═══════════════════════════════════════════════════════════════
export async function evaluateWarrantyForSystem(installedSystemId: string): Promise<string> {
  // Fetch warranty record
  const { data: warranty } = await supabase.from('warranty_records').select('*').eq('installed_system_id', installedSystemId).single()
  if (!warranty) return 'unknown'

  // Fetch system for ownership info
  const { data: system } = await supabase.from('installed_systems').select('ownership_type, customer_id').eq('id', installedSystemId).single()
  if (!system) return 'unknown'

  // Fetch all active compliance requirements for this system
  const { data: requirements } = await supabase.from('compliance_requirements').select('*')
    .eq('installed_system_id', installedSystemId).eq('is_active', true).eq('affects_warranty', true)

  let worstStatus: 'valid' | 'warning' | 'void' = 'valid'
  let worstReason = ''
  const t = today()

  for (const req of (requirements || [])) {
    let reqStatus: 'valid' | 'warning' | 'void' = 'valid'
    let reason = ''

    // Check maintenance plan requirement
    if (req.requires_active_plan) {
      if (system.ownership_type === 'rented') {
        // Maintenance included in rental — always passes
        continue
      }
      // Purchased: check plan status
      const { data: plans } = await supabase.from('maintenance_plans').select('status, renewal_date')
        .eq('customer_id', system.customer_id).eq('status', 'active').limit(1)

      if (!plans?.length) {
        reqStatus = 'void'
        reason = 'No active maintenance plan'
      } else {
        const plan = plans[0]
        if (plan.renewal_date && plan.renewal_date < t) {
          // Past renewal date — check grace
          const renewalDate = new Date(plan.renewal_date + 'T00:00:00')
          const graceEnd = new Date(renewalDate)
          graceEnd.setMonth(graceEnd.getMonth() + (req.grace_period_months || 2))
          const graceStr = graceEnd.toISOString().split('T')[0]

          if (t >= graceStr) {
            reqStatus = 'void'
            reason = `Maintenance plan lapsed past grace period`
          } else {
            reqStatus = 'warning'
            reason = `Maintenance plan renewal overdue`
          }
        }
      }
    } else {
      // Service-based requirement — check latest schedule item
      const { data: items } = await supabase.from('service_schedule_items').select('*')
        .eq('compliance_requirement_id', req.id).order('due_date', { ascending: false }).limit(1)

      const latest = items?.[0]
      if (latest && latest.status === 'overdue') {
        if (t >= latest.grace_expiry_date) {
          reqStatus = 'void'
          reason = `${req.requirement_type.replace(/_/g, ' ')} overdue past grace period`
        } else {
          reqStatus = 'warning'
          reason = `${req.requirement_type.replace(/_/g, ' ')} overdue, within grace`
        }
      }

      // Special: Zenith-only check (RO filters)
      if (req.must_purchase_through_zenith && latest?.status === 'completed') {
        const { data: completion } = await supabase.from('service_completions').select('purchased_through_zenith')
          .eq('service_schedule_item_id', latest.id).limit(1).maybeSingle()

        if (completion && !completion.purchased_through_zenith) {
          reqStatus = 'void'
          reason = `${req.requirement_type.replace(/_/g, ' ')} not purchased through Zenith`
        }
      }
    }

    // Aggregate worst
    if (reqStatus === 'void') { worstStatus = 'void'; worstReason = reason }
    else if (reqStatus === 'warning' && worstStatus !== 'void') { worstStatus = 'warning'; worstReason = reason }
  }

  // Update warranty record if changed
  const oldStatus = warranty.warranty_status
  if (worstStatus !== oldStatus || worstReason !== warranty.status_reason) {
    await supabase.from('warranty_records').update({
      warranty_status: worstStatus, status_reason: worstReason || null,
      status_changed_at: worstStatus !== oldStatus ? new Date().toISOString() : warranty.status_changed_at,
      evaluated_at: new Date().toISOString(),
    }).eq('id', warranty.id)

    // Log if status actually changed
    if (worstStatus !== oldStatus && system.customer_id) {
      await supabase.from('customer_activity_log').insert({
        customer_id: system.customer_id, event_type: 'warranty_status_changed',
        title: `Warranty changed from ${oldStatus} to ${worstStatus}: ${worstReason || 'all clear'}`,
        metadata: { installed_system_id: installedSystemId, from: oldStatus, to: worstStatus, reason: worstReason },
        actor_id: '00000000-0000-0000-0000-000000000000', actor_name: 'System',
      }).then(() => {}).catch(() => {})
    }
  } else {
    // Always update evaluated_at even if no change
    await supabase.from('warranty_records').update({ evaluated_at: new Date().toISOString() }).eq('id', warranty.id)
  }

  return worstStatus
}

// ═══════════════════════════════════════════════════════════════
// EVALUATE ALL WARRANTIES FOR A CUSTOMER
// ═══════════════════════════════════════════════════════════════
export async function evaluateWarrantyForCustomer(customerId: string): Promise<void> {
  const { data: systems } = await supabase.from('installed_systems').select('id').eq('customer_id', customerId).eq('is_active', true)
  for (const sys of (systems || [])) {
    await evaluateWarrantyForSystem(sys.id)
  }
  await updateCustomerLifecycle(customerId)
}
