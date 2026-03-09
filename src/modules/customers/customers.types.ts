// ─── Enums ───────────────────────────────────────────────────
export type OwnershipType = 'purchased' | 'rented'
export type CustomerLifecycle = 'active' | 'service_due' | 'renewal_due' | 'upsell' | 'at_risk'
export type WarrantyStatus = 'valid' | 'warning' | 'void'
export type ScheduleItemStatus = 'upcoming' | 'due_soon' | 'overdue' | 'completed' | 'skipped'
export type RentalContractStatus = 'active' | 'completed' | 'terminated'
export type RentalRisk = 'at_risk' | 'delinquent' | 'termination_pending'
export type ComplianceType = 'sediment_filter_replacement' | 'ro_pre_post_filter_replacement' | 'ro_membrane_replacement' | 'uv_bulb_replacement' | 'annual_maintenance' | 'maintenance_plan_renewal'
export type ProofReview = 'pending' | 'accepted' | 'rejected'
export type ProductCategory = 'softener' | 'carbon_filter' | 'ro_system' | 'uv_system' | 'sediment_filter'

// ─── Labels ──────────────────────────────────────────────────
export const LIFECYCLE_LABELS: Record<CustomerLifecycle, string> = {
  active: 'Active', service_due: 'Service Due', renewal_due: 'Renewal Due', upsell: 'Upsell', at_risk: 'At Risk',
}
export const LIFECYCLE_COLORS: Record<CustomerLifecycle, string> = {
  active: 'bg-green/20 text-green border-green/30',
  service_due: 'bg-amber/20 text-amber border-amber/30',
  renewal_due: 'bg-purple/20 text-purple border-purple/30',
  upsell: 'bg-accent/20 text-accent border-accent/30',
  at_risk: 'bg-red/20 text-red border-red/30',
}
export const WARRANTY_LABELS: Record<WarrantyStatus, string> = { valid: 'Valid', warning: 'Warning', void: 'Void' }
export const WARRANTY_COLORS: Record<WarrantyStatus, string> = { valid: 'bg-green/20 text-green', warning: 'bg-amber/20 text-amber', void: 'bg-red/20 text-red' }
export const OWNERSHIP_LABELS: Record<OwnershipType, string> = { purchased: 'Purchased', rented: 'Rented' }
export const SCHEDULE_LABELS: Record<ScheduleItemStatus, string> = { upcoming: 'Upcoming', due_soon: 'Due Soon', overdue: 'Overdue', completed: 'Completed', skipped: 'Skipped' }
export const SCHEDULE_COLORS: Record<ScheduleItemStatus, string> = { upcoming: 'text-muted', due_soon: 'text-amber', overdue: 'text-red', completed: 'text-green', skipped: 'text-muted' }
export const COMPLIANCE_TYPE_LABELS: Record<ComplianceType, string> = {
  sediment_filter_replacement: 'Sediment Filter', ro_pre_post_filter_replacement: 'RO Pre/Post Filters',
  ro_membrane_replacement: 'RO Membrane', uv_bulb_replacement: 'UV Bulb',
  annual_maintenance: 'Annual Maintenance', maintenance_plan_renewal: 'Maintenance Plan Renewal',
}
export const RENTAL_RISK_LABELS: Record<RentalRisk, string> = { at_risk: 'At Risk', delinquent: 'Delinquent', termination_pending: 'Termination Pending' }
