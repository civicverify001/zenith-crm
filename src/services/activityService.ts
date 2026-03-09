import { supabase } from '../lib/supabase'

// ─── Matches lead_event_type_enum in PostgreSQL ──────────────────
export type LeadEventType =
  | 'lead_created'
  | 'stage_change'
  | 'call_logged'
  | 'note_added'
  | 'agreement_signed'
  | 'job_created'
  | 'lead_lost'
  | 'lead_dnd'
  | 'lead_followup'
  | 'field_updated'
  | 'rep_changed'

// ─── Standardized metadata keys (no ad-hoc keys allowed) ────────
export interface ActivityMetadata {
  // lead_created
  source?: string
  assigned_rep?: string
  water_concern?: string
  // stage_change
  from_stage?: string
  to_stage?: string
  // lead_lost
  reason?: string
  // lead_followup
  followup_date?: string
  followup_notes?: string | null
  // lead_dnd
  previous_stage?: string
  // agreement_signed
  quote_total?: number
  deposit_amount?: number | null
  payment_method?: string
  financing_provider?: string | null
  signed_by?: string
  // job_created
  install_preference?: string
  install_date?: string | null
  // call_logged
  duration_seconds?: number
  outcome?: string
  notes?: string | null
  // field_updated
  field_name?: string
  old_value?: string | null
  new_value?: string
  // rep_changed
  from_rep?: string
  to_rep?: string
  // cleanup (reopen from terminal states)
  cleared_fields?: string[]
  previous_lost_reason?: string
  previous_followup_date?: string
  previous_followup_notes?: string | null
}

// ─── Entry shape for inserts ─────────────────────────────────────
export interface ActivityEntry {
  lead_id: string
  event_type: LeadEventType
  title: string
  metadata?: ActivityMetadata
  actor_id: string          // REQUIRED: auth.users UUID (system truth)
  actor_name?: string       // OPTIONAL: display snapshot
  from_stage?: string
  to_stage?: string
}

// ─── Row shape from DB ───────────────────────────────────────────
export interface ActivityRow {
  id: string
  lead_id: string
  event_type: LeadEventType
  title: string
  metadata: ActivityMetadata
  actor_id: string
  actor_name: string | null
  from_stage: string | null
  to_stage: string | null
  created_at: string
}

// ─── INSERT (append-only — no update/delete functions exist) ─────
export async function logActivity(entry: ActivityEntry): Promise<boolean> {
  const { error } = await supabase
    .from('lead_activity_log')
    .insert({
      lead_id: entry.lead_id,
      event_type: entry.event_type,
      title: entry.title,
      metadata: entry.metadata || {},
      actor_id: entry.actor_id,
      actor_name: entry.actor_name || null,
      from_stage: entry.from_stage || null,
      to_stage: entry.to_stage || null,
    })

  if (error) {
    console.error('Activity log insert failed:', error)
    // Activity log failure should NOT block the primary mutation
  }
  return !error
}

// ─── SELECT (read-only) ──────────────────────────────────────────
export async function getLeadActivity(leadId: string): Promise<ActivityRow[]> {
  const { data, error } = await supabase
    .from('lead_activity_log')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('Activity log fetch failed:', error)
    return []
  }
  return (data || []) as ActivityRow[]
}
