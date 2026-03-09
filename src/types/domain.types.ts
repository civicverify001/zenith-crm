import type { Database } from './database.types'

// ─── Enums (pulled from DB types for convenience) ───────────────
export type UserRole = Database['public']['Enums']['user_role']
export type LeadStage = Database['public']['Enums']['lead_stage']
export type JobStage = Database['public']['Enums']['job_stage']
export type CustomerStage = Database['public']['Enums']['customer_stage']
export type InvoiceType = Database['public']['Enums']['invoice_type']
export type InvoiceStatus = Database['public']['Enums']['invoice_status']
export type PaymentMethod = Database['public']['Enums']['payment_method']
export type WaterSource = Database['public']['Enums']['water_source']
export type QuoteType = Database['public']['Enums']['quote_type']

// ─── Auth / User ─────────────────────────────────────────────────
export interface UserProfile {
  id: string
  email: string
  full_name: string
  role: UserRole
  avatar_url?: string
  created_at: string
}

// ─── Lead ────────────────────────────────────────────────────────
export interface Lead {
  id: string
  full_name: string
  phone: string
  email?: string
  zip_code?: string
  source: LeadSource
  water_concern?: WaterConcern
  stage: LeadStage
  assigned_rep_id?: string
  urgent: boolean
  days_in_stage: number
  call_attempts: number
  lost_reason?: string
  re_engage_date?: string
  notes?: string
  created_at: string
  updated_at: string
}

// ─── Dropdown Enums ──────────────────────────────────────────────
export type LeadSource =
  | 'website_form'
  | 'phone_call'
  | 'email'
  | 'walk_in'
  | 'referral_realtor'
  | 'referral_partner'
  | 'google_ad'
  | 'meta_ad'
  | 'trade_show'
  | 'event'

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  website_form:      'Website Form',
  phone_call:        'Phone Call',
  email:             'Email',
  walk_in:           'Walk-In',
  referral_realtor:  'Referral — Realtor',
  referral_partner:  'Referral — Partner',
  google_ad:         'Google Ad',
  meta_ad:           'Meta Ad',
  trade_show:        'Trade Show',
  event:             'Event',
}

export type WaterConcern =
  | 'hard_water'
  | 'iron_rust'
  | 'sulfur_odor'
  | 'taste_chlorine'
  | 'pfas_chemicals'
  | 'lead_heavy_metals'
  | 'well_water'
  | 'general_filtration'
  | 'unknown'

export const WATER_CONCERN_LABELS: Record<WaterConcern, string> = {
  hard_water:        'Hard Water / Scale',
  iron_rust:         'Iron / Rust',
  sulfur_odor:       'Sulfur / Odor',
  taste_chlorine:    'Taste / Chlorine',
  pfas_chemicals:    'PFAS / Chemicals',
  lead_heavy_metals: 'Lead / Heavy Metals',
  well_water:        'Well Water Issues',
  general_filtration:'General Filtration',
  unknown:           'Unknown',
}

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new_lead:             'New Lead',
  qualifying:           'Qualifying',
  qualified:            'Qualified',
  site_visit_scheduled: 'Site Visit Scheduled',
  proposal_in_progress: 'Proposal in Progress',
  quote_sent:           'Quote Sent',
  agreement_signed:     'Agreement Signed',
  won:                  'Won',
  lost:                 'Lost',
  future_follow_up:     'Future Follow-Up',
  dnd:                  'DND',
}

export const JOB_STAGE_LABELS: Record<JobStage, string> = {
  scheduled:        'Scheduled',
  waiting_for_stock:'Waiting for Stock',
  in_progress:      'In Progress',
  complete:         'Complete',
}

export const CUSTOMER_STAGE_LABELS: Record<CustomerStage, string> = {
  active:       'Active',
  service_due:  'Service Due',
  renewal_due:  'Renewal Due',
  upsell:       'Upsell',
  at_risk:      'At Risk',
}

// ─── Stage color map ─────────────────────────────────────────────
export const LEAD_STAGE_COLORS: Record<LeadStage, string> = {
  new_lead:             'bg-muted/20 text-muted border-muted/30',
  qualifying:           'bg-purple/20 text-purple border-purple/30',
  qualified:            'bg-accent/20 text-accent border-accent/30',
  site_visit_scheduled: 'bg-cyan/20 text-cyan border-cyan/30',
  proposal_in_progress: 'bg-cyan/20 text-cyan border-cyan/30',
  quote_sent:           'bg-amber/20 text-amber border-amber/30',
  agreement_signed:     'bg-green/20 text-green border-green/30',
  won:                  'bg-green/20 text-green border-green/30',
  lost:                 'bg-red/20 text-red border-red/30',
  future_follow_up:     'bg-purple/20 text-purple border-purple/30',
  dnd:                  'bg-muted/20 text-muted border-muted/30',
}

// ─── Pipeline columns (active stages only) ──────────────────────
export const PIPELINE_COLUMNS: LeadStage[] = [
  'new_lead',
  'qualifying',
  'qualified',
  'site_visit_scheduled',
  'proposal_in_progress',
  'quote_sent',
  'agreement_signed',
]

export const HOLDING_STAGES: LeadStage[] = ['won', 'lost', 'future_follow_up', 'dnd']
