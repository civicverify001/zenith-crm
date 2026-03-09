import { supabase } from '../lib/supabase'

// ═══════════════════════════════════════════════════════════════
// LIFECYCLE STATUS COMPUTATION + STORAGE
// FIX #6: Priority: at_risk > service_due > renewal_due > upsell > active
// ═══════════════════════════════════════════════════════════════
export async function updateCustomerLifecycle(customerId: string): Promise<string> {
  // Fetch current status
  const { data: customer } = await supabase.from('customers').select('lifecycle_status, created_at').eq('id', customerId).single()
  if (!customer) return 'active'

  // Warranty status via installed_systems → warranty_records
  const { data: systems } = await supabase.from('installed_systems').select('id').eq('customer_id', customerId).eq('is_active', true)
  const sysIds = (systems || []).map((s: any) => s.id)

  let hasWarrantyIssue = false
  if (sysIds.length > 0) {
    const { data: warranties } = await supabase.from('warranty_records').select('warranty_status').in('installed_system_id', sysIds)
    hasWarrantyIssue = (warranties || []).some((w: any) => w.warranty_status === 'void' || w.warranty_status === 'warning')
  }

  // Rental risk
  const { data: contracts } = await supabase.from('rental_contracts').select('rental_risk_status').eq('customer_id', customerId).eq('status', 'active')
  const hasRentalRisk = (contracts || []).some((c: any) => c.rental_risk_status !== null)

  // Schedule items
  const { data: schedItems } = await supabase.from('service_schedule_items').select('status')
    .eq('customer_id', customerId).in('status', ['due_soon', 'overdue'])
  const hasOverdue = (schedItems || []).some((i: any) => i.status === 'overdue')
  const hasDueSoon = (schedItems || []).some((i: any) => i.status === 'due_soon')

  // Maintenance plan renewal
  const { data: plans } = await supabase.from('maintenance_plans').select('renewal_date, status')
    .eq('customer_id', customerId).eq('status', 'active')
  const renewalSoon = (plans || []).some((p: any) => {
    if (!p.renewal_date) return false
    const days = Math.floor((new Date(p.renewal_date).getTime() - Date.now()) / 86400000)
    return days <= 30 && days >= 0
  })

  // FIX #6: Priority order — first match wins
  let newStatus: string
  if (hasWarrantyIssue || hasRentalRisk) {
    newStatus = 'at_risk'
  } else if (hasOverdue || hasDueSoon) {
    newStatus = 'service_due'
  } else if (renewalSoon) {
    newStatus = 'renewal_due'
  } else {
    // Upsell: active > 6 months, all clear
    const monthsActive = Math.floor((Date.now() - new Date(customer.created_at).getTime()) / (86400000 * 30))
    newStatus = monthsActive >= 6 ? 'upsell' : 'active'
  }

  if (newStatus !== customer.lifecycle_status) {
    await supabase.from('customers').update({ lifecycle_status: newStatus, lifecycle_updated_at: new Date().toISOString() }).eq('id', customerId)
    // Best-effort log
    await supabase.from('customer_activity_log').insert({
      customer_id: customerId, event_type: 'lifecycle_changed',
      title: `Lifecycle changed from ${customer.lifecycle_status} to ${newStatus}`,
      metadata: { from: customer.lifecycle_status, to: newStatus },
      actor_id: '00000000-0000-0000-0000-000000000000', actor_name: 'System',
    }).then(() => {}).catch(() => {})
  }

  return newStatus
}
