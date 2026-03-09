// ─── Database enums ──────────────────────────────────────────
export type JobStatus = 'scheduled' | 'waiting_for_stock' | 'in_progress' | 'complete'
export type JobType = 'standard_install' | 'service' | 'warranty' | 'filter_change' | 'rental_setup'
export type SystemType = 'softener_only' | 'pure_start_softener' | 'advanced_softener' | 'dual_tank' | 'ro_install' | 'combo_whole_home_ro'
export type JobEventType = 'job_created' | 'status_change' | 'tech_assigned' | 'checklist_item_completed' | 'tech_verification' | 'photo_uploaded' | 'handover_submitted' | 'consent_submitted' | 'job_completed' | 'note_added'
export type FormType = 'whole_home_handover' | 'ro_handover' | 'ro_drilling_consent'
export type FormStatus = 'pending' | 'completed'
export type PhotoCategory = 'before_install' | 'after_install' | 'equipment' | 'plumbing' | 'general'
export type ChecklistSection = 'pre_installation' | 'system_installation' | 'programming' | 'final_testing' | 'cleanup' | 'photo_requirements' | 'technician_verification'

// ─── Job row ─────────────────────────────────────────────────
export interface Job {
  id: string
  lead_id: string | null
  status: JobStatus
  job_type: JobType
  system_type: SystemType
  assigned_technician_id: string | null
  scheduled_date: string | null
  assigned_at: string | null
  started_at: string | null
  completed_at: string | null
  customer_name_snapshot: string
  phone_snapshot: string
  email_snapshot: string | null
  service_address_snapshot: string
  equipment_summary: string | null
  quote_total_snapshot: number | null
  payment_method_snapshot: string | null
  serial_number: string | null
  notes: string | null
  handover_signed: boolean
  requires_new_faucet_hole: boolean
  ready_for_customer_conversion: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  // Joined
  assigned_technician?: { id: string; full_name: string; role: string } | null
}

// ─── Job activity row ────────────────────────────────────────
export interface JobActivity {
  id: string
  job_id: string
  event_type: JobEventType
  title: string
  metadata: Record<string, any>
  actor_id: string
  actor_name: string | null
  from_status: string | null
  to_status: string | null
  created_at: string
}

// ─── Checklist ───────────────────────────────────────────────
export interface ChecklistTemplate {
  id: string
  name: string
  system_type: SystemType
  version: number
  is_active: boolean
}

export interface ChecklistTemplateItem {
  id: string
  template_id: string
  section: ChecklistSection
  item_text: string
  sort_order: number
  is_required: boolean
  requires_photo: boolean
  requires_tech_verification: boolean
}

export interface JobChecklistItem {
  id: string
  job_id: string
  template_id: string | null
  template_version: number | null
  section: ChecklistSection
  item_text: string
  sort_order: number
  is_required: boolean
  requires_photo: boolean
  requires_tech_verification: boolean
  completed: boolean
  completed_at: string | null
  completed_by: string | null
  photo_url: string | null
  tech_verified: boolean
  tech_verified_at: string | null
}

// ─── Photos ──────────────────────────────────────────────────
export interface JobPhoto {
  id: string
  job_id: string
  photo_url: string
  caption: string | null
  category: PhotoCategory
  uploaded_by: string | null
  created_at: string
}

// ─── Forms ───────────────────────────────────────────────────
export interface JobRequiredForm {
  id: string
  job_id: string
  form_type: FormType
  required: boolean
  requires_signature: boolean
  status: FormStatus
  completed_at: string | null
  completed_by: string | null
}

export interface JobFormResponse {
  id: string
  job_id: string
  form_type: FormType
  response_data: Record<string, any>
  customer_signature_url: string | null
  submitted_by: string | null
  submitted_at: string
}

// ─── Labels ──────────────────────────────────────────────────
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  scheduled: 'Scheduled',
  waiting_for_stock: 'Waiting for Stock',
  in_progress: 'In Progress',
  complete: 'Complete',
}

export const JOB_STATUS_COLORS: Record<JobStatus, string> = {
  scheduled: 'bg-accent/20 text-accent border-accent/30',
  waiting_for_stock: 'bg-amber/20 text-amber border-amber/30',
  in_progress: 'bg-cyan/20 text-cyan border-cyan/30',
  complete: 'bg-green/20 text-green border-green/30',
}

export const SYSTEM_TYPE_LABELS: Record<SystemType, string> = {
  softener_only: 'Softener Only',
  pure_start_softener: 'Pure Start + Softener',
  advanced_softener: 'Advanced + Softener',
  dual_tank: 'Dual Tank',
  ro_install: 'RO Install',
  combo_whole_home_ro: 'Combo (Whole Home + RO)',
}

export const FORM_TYPE_LABELS: Record<FormType, string> = {
  whole_home_handover: 'Whole Home Customer Handover',
  ro_handover: 'RO Customer Handover',
  ro_drilling_consent: 'RO Drilling Consent',
}

export const CHECKLIST_SECTION_LABELS: Record<ChecklistSection, string> = {
  pre_installation: 'Pre-Installation',
  system_installation: 'System Installation',
  programming: 'Programming',
  final_testing: 'Final Testing',
  cleanup: 'Cleanup',
  photo_requirements: 'Photo Requirements',
  technician_verification: 'Technician Verification',
}

export const DISPATCH_COLUMNS: JobStatus[] = ['scheduled', 'waiting_for_stock', 'in_progress', 'complete']

// ─── Form rules by system type ───────────────────────────────
export const SYSTEM_REQUIRED_FORMS: Record<SystemType, FormType[]> = {
  softener_only: ['whole_home_handover'],
  pure_start_softener: ['whole_home_handover'],
  advanced_softener: ['whole_home_handover'],
  dual_tank: ['whole_home_handover'],
  ro_install: ['ro_handover'],
  combo_whole_home_ro: ['whole_home_handover', 'ro_handover'],
}

// RO drilling consent is conditional — added when new faucet hole is needed
export function getRequiredForms(systemType: SystemType, needsFaucetHole: boolean): FormType[] {
  const forms = [...SYSTEM_REQUIRED_FORMS[systemType]]
  if (needsFaucetHole && (systemType === 'ro_install' || systemType === 'combo_whole_home_ro')) {
    forms.push('ro_drilling_consent')
  }
  return forms
}
