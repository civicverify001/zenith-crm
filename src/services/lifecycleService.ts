// src/services/lifecycleService.ts
// Single-customer lifecycle status computation
// Called inline after events: install complete, payment failed, buyout, etc.
//
// Uses CURRENT production tables:
//   - customer_service_plans (NOT maintenance_plans — deprecated)
//   - contracts (NOT rental_contracts)
//   - installed_systems
//   - payment_transactions
//
// Priority: at_risk > service_due > renewal_due > upsell > active > inactive

import { supabase } from '../lib/supabase'

export async function updateCustomerLifecycle(customerId: string): Promise<string> {
  try {
    const today = new Date().toISOString().split('T')[0]
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
    const sixtyDaysFromNow = new Date(Date.now() + 60 * 86400000).toISOString().split('T')[0]

    // Fetch current status
    const { data: customer } = await supabase
      .from('customers')
      .select('lifecycle_status, created_at')
      .eq('id', customerId)
      .single()

    if (!customer) return 'active'

    // 1. Check payment failures (at_risk triggers)
    const { data: failedTx } = await supabase
      .from('payment_transactions')
      .select('id')
      .eq('customer_id', customerId)
      .eq('status', 'failed')
      .gte('attempted_at', thirtyDaysAgo)
      .limit(1)

    const hasRecentFailedPayment = (failedTx || []).length > 0

    // 2. Check suspended plans
    const { data: suspendedPlans } = await supabase
      .from('customer_service_plans')
      .select('id')
      .eq('customer_id', customerId)
      .eq('status', 'payment_failed')
      .limit(1)

    const hasSuspendedPlan = (suspendedPlans || []).length > 0

    // 3. Check service due: active plans with next_service or next_fulfillment_date <= today
    const { data: activePlans } = await supabase
      .from('customer_service_plans')
      .select('id, status, next_service, next_fulfillment_date')
      .eq('customer_id', customerId)
      .in('status', ['active', 'pending_payment_method'])

    const hasServiceDue = (activePlans || []).some(p => {
      if (p.status !== 'active') return false
      if (p.next_service && p.next_service <= today) return true
      if (p.next_fulfillment_date && p.next_fulfillment_date <= today) return true
      return false
    })

    const hasActivePlan = (activePlans || []).some(p => p.status === 'active')

    // 4. Check contracts — renewal due within 60 days
    const { data: activeContracts } = await supabase
      .from('contracts')
      .select('id, end_date')
      .eq('customer_id', customerId)
      .eq('status', 'active')

    const hasActiveContract = (activeContracts || []).length > 0

    const hasRenewalDue = (activeContracts || []).some(c => {
      if (!c.end_date) return false
      return c.end_date <= sixtyDaysFromNow && c.end_date >= today
    })

    // 5. Check installed systems
    const { data: activeSystems } = await supabase
      .from('installed_systems')
      .select('id')
      .eq('customer_id', customerId)
      .eq('is_active', true)
      .limit(1)

    const hasActiveSystem = (activeSystems || []).length > 0

    // 6. Inactive check
    const isInactive = !hasActiveContract && !hasActivePlan && !hasActiveSystem

    // 7. Compute new status — priority order
    let newStatus: string

    if (hasRecentFailedPayment || hasSuspendedPlan) {
      newStatus = 'at_risk'
    } else if (hasServiceDue) {
      newStatus = 'service_due'
    } else if (hasRenewalDue) {
      newStatus = 'renewal_due'
    } else if (isInactive) {
      newStatus = 'inactive'
    } else if (hasActiveSystem && !hasActivePlan && hasActiveContract) {
      newStatus = 'upsell'
    } else {
      newStatus = 'active'
    }

    // 8. Update only if changed
    if (newStatus !== customer.lifecycle_status) {
      await supabase
        .from('customers')
        .update({
          lifecycle_status: newStatus,
          lifecycle_updated_at: new Date().toISOString(),
        })
        .eq('id', customerId)

      // Best-effort activity log
      await supabase.from('customer_activity_log').insert({
        customer_id: customerId,
        event_type: 'lifecycle_changed',
        title: `Lifecycle: ${customer.lifecycle_status || 'unknown'} → ${newStatus}`,
        actor_id: null,
        actor_name: 'System',
        metadata: { from: customer.lifecycle_status, to: newStatus },
      }).then(() => {}).catch(() => {})
    }

    return newStatus
  } catch (err) {
    console.error('[lifecycleService] Error updating lifecycle for', customerId, err)
    return 'active'
  }
}
