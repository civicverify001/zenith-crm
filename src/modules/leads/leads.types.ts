import type { LeadStage, LeadSource, WaterConcern } from '../../types/domain.types'

// ─── Database row shape ───────────────────────────────────────
export interface Lead {
  id: string
  full_name: string
  phone: string
  email: string | null
  zip_code: string | null
  address: string | null
  city: string | null
  state: string | null
  source: LeadSource
  water_concern: WaterConcern | null
  stage: LeadStage
  assigned_rep_id: string | null
  urgent: boolean
  notes: string | null
  stage_changed_at: string
  stage_entered_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string

  // Agreement Signed fields
  quote_total: number | null
  signed_at: string | null
  signed_by: string | null
  deposit_amount: number | null
  payment_method: string | null
  financing_provider: string | null
  agreement_file_url: string | null
  has_signature: boolean
  install_preference: string | null
  install_preferred_date: string | null
  equipment_summary: string | null

  // Bridge fields (temporary)
  job_created: boolean
  inventory_reserved: boolean

  // Terminal state fields
  lost_reason: string | null
  lost_at: string | null
  dnd_at: string | null
  followup_date: string | null
  followup_notes: string | null
  re_engage_date: string | null

  // Qualifying checklist
  qualifying_answers: Record<string, any> | null

  // Joined
  assigned_rep?: { id: string; full_name: string; role: string } | null
  _call_count?: number
  _days_in_stage?: number
}

// ─── Create / Update payloads ─────────────────────────────────
export interface CreateLeadPayload {
  full_name: string
  phone: string
  email?: string
  zip_code?: string
  address?: string
  city?: string
  state?: string
  source: LeadSource
  water_concern?: WaterConcern
  urgent?: boolean
  notes?: string
  assigned_rep_id?: string
}

export interface UpdateLeadPayload {
  full_name?: string
  phone?: string
  email?: string
  zip_code?: string
  source?: LeadSource
  water_concern?: WaterConcern
  stage?: LeadStage
  assigned_rep_id?: string | null
  urgent?: boolean
  lost_reason?: string | null
  re_engage_date?: string | null
  notes?: string
  quote_total?: number | null
  signed_at?: string | null
  signed_by?: string | null
  deposit_amount?: number | null
  payment_method?: string | null
  financing_provider?: string | null
  agreement_file_url?: string | null
  has_signature?: boolean
  install_preference?: string | null
  install_preferred_date?: string | null
  job_created?: boolean
  inventory_reserved?: boolean
  lost_at?: string | null
  dnd_at?: string | null
  followup_date?: string | null
  followup_notes?: string | null
  stage_entered_at?: string | null
}

// ─── Stage transition rules ───────────────────────────────────
export const ALLOWED_TRANSITIONS: Partial<Record<LeadStage, LeadStage[]>> = {
  new_lead:             ['qualifying', 'lost', 'dnd'],
  qualifying:           ['qualified', 'future_follow_up', 'lost', 'dnd'],
  qualified:            ['site_visit_scheduled', 'future_follow_up', 'lost', 'dnd'],
  site_visit_scheduled: ['proposal_in_progress', 'future_follow_up', 'lost', 'dnd'],
  proposal_in_progress: ['quote_sent', 'future_follow_up', 'lost'],
  quote_sent:           ['agreement_signed', 'future_follow_up', 'lost'],
  agreement_signed:     ['lost'],
  future_follow_up:     ['qualifying', 'lost', 'dnd'],
  won:                  [],
  lost:                 ['new_lead'],
  dnd:                  ['new_lead'],
}

// ─── Stage gate requirements ──────────────────────────────────
export const STAGE_GATE_REQUIREMENTS: Partial<Record<LeadStage, string[]>> = {
  qualifying:           ['name', 'phone', 'source'],
  qualified:            ['water_concern', 'min_1_call_attempt'],
  site_visit_scheduled: ['assigned_rep_id', 'appointment_exists'],
  proposal_in_progress: ['water_test_exists'],
  quote_sent:           ['quote_exists_with_items'],
  agreement_signed:     ['signature', 'deposit', 'install_address'],
}

// ─── Filter / Sort ────────────────────────────────────────────
export interface LeadFilters {
  stage?: LeadStage | 'all'
  assigned_rep_id?: string | 'all'
  source?: LeadSource | 'all'
  urgent?: boolean
  search?: string
}

export type LeadSortField = 'created_at' | 'updated_at' | 'full_name' | 'stage_changed_at'
export type SortDirection = 'asc' | 'desc'

