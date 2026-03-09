import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchLeads,
  fetchLeadsByStage,
  fetchLead,
  createLead,
  updateLead,
  updateLeadStage,
  assignRep,
  logCallAttempt,
  fetchCallAttempts,
  fetchLeadActivity,
  fetchReps,
  fetchPipelineCounts,
} from './leads.api'
import { getLeadActivity } from '../../services/activityService'
import type { CreateLeadPayload, UpdateLeadPayload, LeadFilters } from './leads.types'
import type { LeadStage } from '../../types/domain.types'
import { useAuth } from '../../hooks/useAuth'

// ─── Query keys ───────────────────────────────────────────────
export const LEAD_KEYS = {
  all:      ['leads'] as const,
  lists:    () => [...LEAD_KEYS.all, 'list'] as const,
  list:     (filters: LeadFilters) => [...LEAD_KEYS.lists(), filters] as const,
  kanban:   () => [...LEAD_KEYS.all, 'kanban'] as const,
  detail:   (id: string) => [...LEAD_KEYS.all, 'detail', id] as const,
  activity: (id: string) => [...LEAD_KEYS.all, 'activity', id] as const,
  calls:    (id: string) => [...LEAD_KEYS.all, 'calls', id] as const,
  reps:     ['reps'] as const,
  counts:   ['pipeline_counts'] as const,
}

// ─── Queries ──────────────────────────────────────────────────
export function useLeads(filters: LeadFilters = {}) {
  return useQuery({
    queryKey: LEAD_KEYS.list(filters),
    queryFn: () => fetchLeads(filters),
    staleTime: 30_000,
  })
}

export function useLeadsKanban() {
  return useQuery({
    queryKey: LEAD_KEYS.kanban(),
    queryFn: fetchLeadsByStage,
    staleTime: 20_000,
    refetchInterval: 60_000, // auto-refresh every minute
  })
}

export function useLead(id: string) {
  return useQuery({
    queryKey: LEAD_KEYS.detail(id),
    queryFn: () => fetchLead(id),
    enabled: !!id,
  })
}

export function useLeadActivity(leadId: string) {
  return useQuery({
    queryKey: LEAD_KEYS.activity(leadId),
    queryFn: () => fetchLeadActivity(leadId),
    enabled: !!leadId,
  })
}

export function useCallAttempts(leadId: string) {
  return useQuery({
    queryKey: LEAD_KEYS.calls(leadId),
    queryFn: () => fetchCallAttempts(leadId),
    enabled: !!leadId,
  })
}

export function useReps() {
  return useQuery({
    queryKey: LEAD_KEYS.reps,
    queryFn: fetchReps,
    staleTime: 300_000, // 5 min — reps rarely change
  })
}

export function usePipelineCounts() {
  return useQuery({
    queryKey: LEAD_KEYS.counts,
    queryFn: fetchPipelineCounts,
    staleTime: 30_000,
  })
}

// ─── Mutations ────────────────────────────────────────────────
export function useCreateLead() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: (payload: CreateLeadPayload) =>
      createLead(payload, user!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LEAD_KEYS.all })
      queryClient.invalidateQueries({ queryKey: LEAD_KEYS.counts })
    },
  })
}

export function useUpdateLead() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateLeadPayload }) =>
      updateLead(id, payload, user!.id),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: LEAD_KEYS.lists() })
      queryClient.invalidateQueries({ queryKey: LEAD_KEYS.kanban() })
      queryClient.setQueryData(LEAD_KEYS.detail(updated.id), updated)
    },
  })
}

export function useUpdateLeadStage() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: ({
      id,
      stage,
      lost_reason,
      re_engage_date,
    }: {
      id: string
      stage: LeadStage
      lost_reason?: string
      re_engage_date?: string
    }) => updateLeadStage(id, stage, user!.id, { lost_reason, re_engage_date }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: LEAD_KEYS.kanban() })
      queryClient.invalidateQueries({ queryKey: LEAD_KEYS.lists() })
      queryClient.invalidateQueries({ queryKey: LEAD_KEYS.counts })
      queryClient.setQueryData(LEAD_KEYS.detail(updated.id), updated)
      queryClient.invalidateQueries({ queryKey: LEAD_KEYS.activity(updated.id) })
    },
  })
}

export function useAssignRep() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: ({ leadId, repId }: { leadId: string; repId: string | null }) =>
      assignRep(leadId, repId, user!.id),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: LEAD_KEYS.kanban() })
      queryClient.setQueryData(LEAD_KEYS.detail(updated.id), updated)
    },
  })
}

export function useLogCallAttempt() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: ({
      leadId,
      outcome,
      notes,
    }: {
      leadId: string
      outcome: string
      notes?: string
    }) => logCallAttempt(leadId, user!.id, outcome, notes),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: LEAD_KEYS.calls(variables.leadId) })
      queryClient.invalidateQueries({ queryKey: LEAD_KEYS.activity(variables.leadId) })
    },
  })
}

// ─── New structured activity log (lead_activity_log table) ────
export function useNewLeadActivity(leadId: string) {
  return useQuery({
    queryKey: ['lead_activity_log', leadId],
    queryFn: () => getLeadActivity(leadId),
    enabled: !!leadId,
    staleTime: 10_000,
  })
}
