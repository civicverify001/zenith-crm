import { supabase } from '../../lib/supabase'
import type {
  Lead,
  CreateLeadPayload,
  UpdateLeadPayload,
  LeadFilters,
  LeadSortField,
  SortDirection,
} from './leads.types'
import type { LeadStage } from '../../types/domain.types'

// ─── Fetch all leads with filters ────────────────────────────
export async function fetchLeads(
  filters: LeadFilters = {},
  sortField: LeadSortField = 'created_at',
  sortDir: SortDirection = 'desc'
): Promise<Lead[]> {
  let query = supabase
    .from('leads')
    .select(`
      *,
      assigned_rep:user_profiles!leads_assigned_rep_id_fkey(id, full_name, role)
    `)
    .order(sortField, { ascending: sortDir === 'asc' })

  if (filters.stage && filters.stage !== 'all') {
    query = query.eq('stage', filters.stage)
  } else if (!filters.stage) {
    // Default: exclude won/lost/dnd/future from main pipeline
    query = query.not('stage', 'in', '("won","lost","dnd")')
  }

  if (filters.assigned_rep_id && filters.assigned_rep_id !== 'all') {
    query = query.eq('assigned_rep_id', filters.assigned_rep_id)
  }

  if (filters.source && filters.source !== 'all') {
    query = query.eq('source', filters.source)
  }

  if (filters.urgent === true) {
    query = query.eq('urgent', true)
  }

  if (filters.search) {
    query = query.or(
      `full_name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%,email.ilike.%${filters.search}%`
    )
  }

  const { data, error } = await query

  if (error) throw new Error(error.message)
  return (data || []) as Lead[]
}

// ─── Fetch leads grouped by stage (kanban) ───────────────────
export async function fetchLeadsByStage(): Promise<Record<LeadStage, Lead[]>> {
  const { data, error } = await supabase
    .from('leads')
    .select(`
      *,
      assigned_rep:user_profiles!leads_assigned_rep_id_fkey(id, full_name, role)
    `)
    .not('stage', 'in', '("won","lost","dnd","future_follow_up")')
    .order('stage_changed_at', { ascending: false })

  if (error) throw new Error(error.message)

  const grouped: Record<string, Lead[]> = {}
  for (const lead of (data || []) as Lead[]) {
    if (!grouped[lead.stage]) grouped[lead.stage] = []
    grouped[lead.stage].push(lead)
  }
  return grouped as Record<LeadStage, Lead[]>
}

// ─── Fetch single lead ────────────────────────────────────────
export async function fetchLead(id: string): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .select(`
      *,
      assigned_rep:user_profiles!leads_assigned_rep_id_fkey(id, full_name, role)
    `)
    .eq('id', id)
    .single()

  if (error) throw new Error(error.message)
  return data as Lead
}

// ─── Create lead ──────────────────────────────────────────────
export async function createLead(
  payload: CreateLeadPayload,
  createdById: string
): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .insert({
      ...payload,
      stage: 'new_lead',
      created_by: createdById,
      stage_changed_at: new Date().toISOString(),
    })
    .select(`
      *,
      assigned_rep:user_profiles!leads_assigned_rep_id_fkey(id, full_name, role)
    `)
    .single()

  if (error) throw new Error(error.message)

  // Log activity
  await logActivity({
    event: 'lead_created',
    lead_id: (data as Lead).id,
    performed_by: createdById,
    metadata: { source: payload.source, stage: 'new_lead' },
  })

  return data as Lead
}

// ─── Update lead ──────────────────────────────────────────────
export async function updateLead(
  id: string,
  payload: UpdateLeadPayload,
  updatedById: string
): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .update(payload)
    .eq('id', id)
    .select(`
      *,
      assigned_rep:user_profiles!leads_assigned_rep_id_fkey(id, full_name, role)
    `)
    .single()

  if (error) throw new Error(error.message)
  return data as Lead
}

// ─── Update lead stage ────────────────────────────────────────
export async function updateLeadStage(
  id: string,
  newStage: LeadStage,
  performedById: string,
  options?: { lost_reason?: string; re_engage_date?: string }
): Promise<Lead> {
  const updatePayload: UpdateLeadPayload = {
    stage: newStage,
    ...options,
  }

  const { data, error } = await supabase
    .from('leads')
    .update({
      ...updatePayload,
      stage_changed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select(`
      *,
      assigned_rep:user_profiles!leads_assigned_rep_id_fkey(id, full_name, role)
    `)
    .single()

  if (error) throw new Error(error.message)

  await logActivity({
    event: 'lead_stage_changed',
    lead_id: id,
    performed_by: performedById,
    metadata: { new_stage: newStage },
  })

  return data as Lead
}

// ─── Assign rep ───────────────────────────────────────────────
export async function assignRep(
  leadId: string,
  repId: string | null,
  assignedById: string
): Promise<Lead> {
  return updateLead(leadId, { assigned_rep_id: repId }, assignedById)
}

// ─── Log call attempt ─────────────────────────────────────────
export async function logCallAttempt(
  leadId: string,
  userId: string,
  outcome: string,
  notes?: string
): Promise<void> {
  const { error } = await supabase.from('call_attempts').insert({
    lead_id: leadId,
    attempted_by: userId,
    outcome,
    notes,
  })

  if (error) throw new Error(error.message)

  await logActivity({
    event: 'call_attempt_logged',
    lead_id: leadId,
    performed_by: userId,
    metadata: { outcome },
  })
}

// ─── Fetch call attempts for a lead ──────────────────────────
export async function fetchCallAttempts(leadId: string) {
  const { data, error } = await supabase
    .from('call_attempts')
    .select('*, attempted_by_profile:user_profiles!call_attempts_attempted_by_fkey(full_name)')
    .eq('lead_id', leadId)
    .order('attempted_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data || []
}

// ─── Activity log helper ──────────────────────────────────────
export async function logActivity(entry: {
  event: string
  lead_id?: string
  customer_id?: string
  job_id?: string
  performed_by?: string
  metadata?: Record<string, unknown>
}) {
  await supabase.from('activity_logs').insert(entry)
  // Don't throw — activity log failures are non-critical
}

// ─── Fetch activity log for a lead ───────────────────────────
export async function fetchLeadActivity(leadId: string) {
  const { data, error } = await supabase
    .from('activity_logs')
    .select('*, performer:user_profiles!activity_logs_performed_by_fkey(full_name)')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw new Error(error.message)
  return data || []
}

// ─── Fetch reps (for assign dropdown) ────────────────────────
export async function fetchReps() {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, full_name, role')
    .in('role', ['admin', 'salesrep'])
    .eq('is_active', true)
    .order('full_name')

  if (error) throw new Error(error.message)
  return data || []
}

// ─── Pipeline counts (dashboard) ─────────────────────────────
export async function fetchPipelineCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('leads')
    .select('stage')
    .not('stage', 'in', '("won","lost","dnd")')

  if (error) return {}

  const counts: Record<string, number> = {}
  for (const row of data || []) {
    counts[row.stage] = (counts[row.stage] || 0) + 1
  }
  return counts
}
