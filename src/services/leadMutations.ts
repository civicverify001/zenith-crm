import { supabase } from '../lib/supabase'
import { logActivity } from './activityService'
import type { Lead } from '../modules/leads/leads.types'
import { LEAD_STAGE_LABELS } from '../types/domain.types'
import type { LeadStage } from '../types/domain.types'

// ─── Actor info passed to every mutation ─────────────────────────
export interface ActorInfo {
  actor_id: string
  actor_name?: string
}

// ─── Helpers ─────────────────────────────────────────────────────
const SELECT_WITH_REP = `
  *,
  assigned_rep:user_profiles!leads_assigned_rep_id_fkey(id, full_name, role)
`

function stageLabel(stage: string): string {
  return LEAD_STAGE_LABELS[stage as LeadStage] || stage
}

// ─── Generic forward stage transition ────────────────────────────
export async function moveStage(
  leadId: string,
  fromStage: string,
  toStage: string,
  actor: ActorInfo
): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .update({
      stage: toStage,
      stage_entered_at: new Date().toISOString(),
    })
    .eq('id', leadId)
    .select(SELECT_WITH_REP)
    .single()

  if (error) throw new Error(error.message)

  await logActivity({
    lead_id: leadId,
    event_type: 'stage_change',
    title: `Moved to ${stageLabel(toStage)}`,
    metadata: { from_stage: fromStage, to_stage: toStage },
    ...actor,
    from_stage: fromStage,
    to_stage: toStage,
  })

  return data as Lead
}

// ─── CHANGED: optional structured fields for reason code + re-engage date ─
export interface LostStructuredFields {
  lost_reason_code?: string
  lost_reengage_date?: string  // YYYY-MM-DD
}

// ─── Mark Lost (requires reason, min 5 chars) ────────────────────
// CHANGED: added optional 5th param `structured` — writes lost_reason_code
// and lost_reengage_date alongside the existing lost_reason string column.
// Fully backward-compatible — callers that don't pass structured still work.
export async function markLost(
  leadId: string,
  fromStage: string,
  actor: ActorInfo,
  lostReason: string,
  structured?: LostStructuredFields  // CHANGED: new optional param
): Promise<Lead> {
  const reason = lostReason.trim()
  if (!reason || reason.length < 5) {
    throw new Error('Lost reason must be at least 5 characters')
  }

  // CHANGED: merge structured fields into the update payload when provided
  const { data, error } = await supabase
    .from('leads')
    .update({
      stage: 'lost',
      stage_entered_at: new Date().toISOString(),
      lost_reason: reason,
      lost_at: new Date().toISOString(),
      // CHANGED: only written when structured is passed
      ...(structured?.lost_reason_code   && { lost_reason_code:   structured.lost_reason_code }),
      ...(structured?.lost_reengage_date && { lost_reengage_date: structured.lost_reengage_date }),
    })
    .eq('id', leadId)
    .select(SELECT_WITH_REP)
    .single()

  if (error) throw new Error(error.message)

  await logActivity({
    lead_id: leadId,
    event_type: 'lead_lost',
    title: 'Marked as Lost',
    // CHANGED: include reason code in activity metadata for reports
    metadata: {
      from_stage: fromStage,
      reason,
      ...(structured?.lost_reason_code   && { reason_code:    structured.lost_reason_code }),
      ...(structured?.lost_reengage_date && { reengage_date:  structured.lost_reengage_date }),
    },
    ...actor,
    from_stage: fromStage,
    to_stage: 'lost',
  })

  return data as Lead
}

// ─── Schedule Follow-Up (requires date >= today) ─────────────────
export async function scheduleFollowUp(
  leadId: string,
  fromStage: string,
  actor: ActorInfo,
  followupDate: string,
  followupNotes?: string
): Promise<Lead> {
  if (!followupDate) throw new Error('Follow-up date is required')
  const d = new Date(followupDate)
  const today = new Date(new Date().toDateString())
  if (d < today) throw new Error('Follow-up date must be today or later')

  const { data, error } = await supabase
    .from('leads')
    .update({
      stage: 'future_follow_up',
      stage_entered_at: new Date().toISOString(),
      followup_date: followupDate,
      followup_notes: followupNotes?.trim() || null,
    })
    .eq('id', leadId)
    .select(SELECT_WITH_REP)
    .single()

  if (error) throw new Error(error.message)

  await logActivity({
    lead_id: leadId,
    event_type: 'lead_followup',
    title: `Scheduled follow-up: ${followupDate}`,
    metadata: {
      from_stage: fromStage,
      followup_date: followupDate,
      followup_notes: followupNotes?.trim() || null,
    },
    ...actor,
    from_stage: fromStage,
    to_stage: 'future_follow_up',
  })

  return data as Lead
}

// ─── Mark DND ────────────────────────────────────────────────────
export async function markDND(
  leadId: string,
  fromStage: string,
  actor: ActorInfo
): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .update({
      stage: 'dnd',
      stage_entered_at: new Date().toISOString(),
      dnd_at: new Date().toISOString(),
    })
    .eq('id', leadId)
    .select(SELECT_WITH_REP)
    .single()

  if (error) throw new Error(error.message)

  await logActivity({
    lead_id: leadId,
    event_type: 'lead_dnd',
    title: 'Marked as Do Not Disturb',
    metadata: { previous_stage: fromStage },
    ...actor,
    from_stage: fromStage,
    to_stage: 'dnd',
  })

  return data as Lead
}

// ─── Sign Agreement ──────────────────────────────────────────────
export type PaymentMethodEnum = 'cash' | 'check' | 'card' | 'financing' | 'rental'
export type InstallPreferenceEnum = 'asap' | 'specific_date' | 'flexible'

export interface AgreementData {
  quote_total: number
  signed_by: string
  deposit_amount?: number
  payment_method: PaymentMethodEnum
  financing_provider?: string
  agreement_file_url?: string
  rental_monthly_amount?: number
  rental_term_months?: number
  install_preference?: InstallPreferenceEnum
  install_preferred_date?: string
}

export async function signAgreement(
  leadId: string,
  fromStage: string,
  actor: ActorInfo,
  data: AgreementData
): Promise<Lead> {
  if (!data.quote_total || data.quote_total <= 0)
    throw new Error('Quote total must be greater than 0')
  if (!data.signed_by?.trim())
    throw new Error('Signed by name is required')
  if (data.payment_method === 'financing' && !data.financing_provider?.trim())
    throw new Error('Financing provider is required when payment method is financing')
  if (data.payment_method === 'rental') {
    if (!data.rental_monthly_amount || data.rental_monthly_amount <= 0)
      throw new Error('Monthly rental amount is required')
    if (!data.rental_term_months || data.rental_term_months <= 0)
      throw new Error('Rental term (months) is required')
  }

  const { data: updated, error } = await supabase
    .from('leads')
    .update({
      stage: 'agreement_signed',
      stage_entered_at: new Date().toISOString(),
      quote_total: data.quote_total,
      signed_at: new Date().toISOString(),
      signed_by: data.signed_by.trim(),
      deposit_amount: data.deposit_amount || null,
      payment_method: data.payment_method,
      financing_provider: data.financing_provider?.trim() || null,
      agreement_file_url: data.agreement_file_url || null,
      has_signature: true,
      rental_monthly_amount: data.rental_monthly_amount || null,
      rental_term_months: data.rental_term_months || null,
      install_preference: data.install_preference || null,
      install_preferred_date: data.install_preferred_date || null,
    })
    .eq('id', leadId)
    .select(SELECT_WITH_REP)
    .single()

  if (error) throw new Error(error.message)

  await logActivity({
    lead_id: leadId,
    event_type: 'agreement_signed',
    title: data.payment_method === 'rental'
      ? `Rental agreement signed — $${data.rental_monthly_amount}/mo × ${data.rental_term_months} months`
      : `Agreement signed — $${data.quote_total.toLocaleString()}`,
    metadata: {
      quote_total: data.quote_total,
      deposit_amount: data.deposit_amount || null,
      payment_method: data.payment_method,
      financing_provider: data.financing_provider || null,
      rental_monthly_amount: data.rental_monthly_amount || null,
      rental_term_months: data.rental_term_months || null,
      signed_by: data.signed_by.trim(),
    },
    ...actor,
    from_stage: fromStage,
    to_stage: 'agreement_signed',
  })

  return updated as Lead
}

// ─── Create Install Job (bridge field only) ──────────────────────
export async function createInstallJob(
  leadId: string,
  actor: ActorInfo,
  installPreference: InstallPreferenceEnum,
  installDate?: string
): Promise<Lead> {
  if (installPreference === 'specific_date' && !installDate)
    throw new Error('Install date required for specific date preference')

  const { data, error } = await supabase
    .from('leads')
    .update({
      job_created: true,
      install_preference: installPreference,
      install_preferred_date: installDate || null,
    })
    .eq('id', leadId)
    .select(SELECT_WITH_REP)
    .single()

  if (error) throw new Error(error.message)

  await logActivity({
    lead_id: leadId,
    event_type: 'job_created',
    title: 'Install job created',
    metadata: {
      install_preference: installPreference,
      install_date: installDate || null,
    },
    ...actor,
  })

  return data as Lead
}

// ─── Reopen from Lost ────────────────────────────────────────────
// CHANGED: also clears lost_reason_code and lost_reengage_date
export async function reopenFromLost(
  leadId: string,
  currentLead: Lead,
  actor: ActorInfo
): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .update({
      stage: 'new_lead',
      stage_entered_at: new Date().toISOString(),
      lost_reason: null,
      lost_at: null,
      lost_reason_code: null,   // CHANGED: clear new column
      lost_reengage_date: null, // CHANGED: clear new column
    })
    .eq('id', leadId)
    .select(SELECT_WITH_REP)
    .single()

  if (error) throw new Error(error.message)

  await logActivity({
    lead_id: leadId,
    event_type: 'stage_change',
    title: 'Reopened from Lost',
    metadata: {
      from_stage: 'lost',
      to_stage: 'new_lead',
      cleared_fields: ['lost_reason', 'lost_at', 'lost_reason_code', 'lost_reengage_date'],
      previous_lost_reason: currentLead.lost_reason || undefined,
    },
    ...actor,
    from_stage: 'lost',
    to_stage: 'new_lead',
  })

  return data as Lead
}

// ─── Reopen from DND (cleanup: nullify dnd_at) ──────────────────
export async function reopenFromDND(
  leadId: string,
  actor: ActorInfo
): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .update({
      stage: 'new_lead',
      stage_entered_at: new Date().toISOString(),
      dnd_at: null,
    })
    .eq('id', leadId)
    .select(SELECT_WITH_REP)
    .single()

  if (error) throw new Error(error.message)

  await logActivity({
    lead_id: leadId,
    event_type: 'stage_change',
    title: 'Reopened from DND',
    metadata: {
      from_stage: 'dnd',
      to_stage: 'new_lead',
      cleared_fields: ['dnd_at'],
    },
    ...actor,
    from_stage: 'dnd',
    to_stage: 'new_lead',
  })

  return data as Lead
}

// ─── Reopen from Future Follow-Up ───────────────────────────────
export async function reopenFromFollowUp(
  leadId: string,
  currentLead: Lead,
  actor: ActorInfo
): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .update({
      stage: 'qualifying',
      stage_entered_at: new Date().toISOString(),
      followup_date: null,
      followup_notes: null,
    })
    .eq('id', leadId)
    .select(SELECT_WITH_REP)
    .single()

  if (error) throw new Error(error.message)

  await logActivity({
    lead_id: leadId,
    event_type: 'stage_change',
    title: 'Reopened from Follow-Up',
    metadata: {
      from_stage: 'future_follow_up',
      to_stage: 'qualifying',
      cleared_fields: ['followup_date', 'followup_notes'],
      previous_followup_date: currentLead.followup_date || undefined,
      previous_followup_notes: currentLead.followup_notes || undefined,
    },
    ...actor,
    from_stage: 'future_follow_up',
    to_stage: 'qualifying',
  })

  return data as Lead
}
