import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchJobsByStatus,
  fetchJob,
  fetchJobActivity,
  fetchJobChecklist,
  fetchJobRequiredForms,
  fetchJobFormResponses,
  fetchJobPhotos,
  fetchTechnicians,
  assignTechnician,
  updateJobStatus,
  updateJobField,
  completeChecklistItem,
  uncompleteChecklistItem,
  verifyChecklistItem,
  submitFormResponse,
} from '../../services/jobService'
import type { Job, JobStatus } from './dispatch.types'
import { useAuth } from '../../hooks/useAuth'

export const JOB_KEYS = {
  all:        ['jobs'] as const,
  board:      () => [...JOB_KEYS.all, 'board'] as const,
  detail:     (id: string) => [...JOB_KEYS.all, 'detail', id] as const,
  activity:   (id: string) => [...JOB_KEYS.all, 'activity', id] as const,
  checklist:  (id: string) => [...JOB_KEYS.all, 'checklist', id] as const,
  forms:      (id: string) => [...JOB_KEYS.all, 'forms', id] as const,
  responses:  (id: string) => [...JOB_KEYS.all, 'responses', id] as const,
  photos:     (id: string) => [...JOB_KEYS.all, 'photos', id] as const,
  techs:      ['technicians'] as const,
}

// ─── Queries ──────────────────────────────────────────────────
export function useJobsBoard() {
  return useQuery({
    queryKey: JOB_KEYS.board(),
    queryFn: fetchJobsByStatus,
    staleTime: 20_000,
    refetchInterval: 60_000,
  })
}

export function useJob(id: string) {
  return useQuery({
    queryKey: JOB_KEYS.detail(id),
    queryFn: () => fetchJob(id),
    enabled: !!id,
  })
}

export function useJobActivity(jobId: string) {
  return useQuery({
    queryKey: JOB_KEYS.activity(jobId),
    queryFn: () => fetchJobActivity(jobId),
    enabled: !!jobId,
  })
}

export function useJobChecklist(jobId: string) {
  return useQuery({
    queryKey: JOB_KEYS.checklist(jobId),
    queryFn: () => fetchJobChecklist(jobId),
    enabled: !!jobId,
  })
}

export function useJobRequiredForms(jobId: string) {
  return useQuery({
    queryKey: JOB_KEYS.forms(jobId),
    queryFn: () => fetchJobRequiredForms(jobId),
    enabled: !!jobId,
  })
}

export function useJobFormResponses(jobId: string) {
  return useQuery({
    queryKey: JOB_KEYS.responses(jobId),
    queryFn: () => fetchJobFormResponses(jobId),
    enabled: !!jobId,
  })
}

export function useJobPhotos(jobId: string) {
  return useQuery({
    queryKey: JOB_KEYS.photos(jobId),
    queryFn: () => fetchJobPhotos(jobId),
    enabled: !!jobId,
  })
}

export function useTechnicians() {
  return useQuery({
    queryKey: JOB_KEYS.techs,
    queryFn: fetchTechnicians,
    staleTime: 300_000,
  })
}

// ─── Mutations ────────────────────────────────────────────────
export function useAssignTechnician() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()

  return useMutation({
    mutationFn: ({ jobId, techId }: { jobId: string; techId: string }) =>
      assignTechnician(jobId, techId, { actor_id: user!.id, actor_name: profile?.full_name }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: JOB_KEYS.board() })
      qc.setQueryData(JOB_KEYS.detail(updated.id), updated)
      qc.invalidateQueries({ queryKey: JOB_KEYS.activity(updated.id) })
    },
  })
}

export function useUpdateJobStatus() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()

  return useMutation({
    mutationFn: ({ jobId, newStatus, currentJob }: { jobId: string; newStatus: JobStatus; currentJob: Job }) =>
      updateJobStatus(jobId, newStatus, currentJob, { actor_id: user!.id, actor_name: profile?.full_name }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: JOB_KEYS.board() })
      qc.setQueryData(JOB_KEYS.detail(updated.id), updated)
      qc.invalidateQueries({ queryKey: JOB_KEYS.activity(updated.id) })
    },
  })
}

export function useUpdateJobField() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()

  return useMutation({
    mutationFn: ({ jobId, field, value }: { jobId: string; field: 'notes' | 'serial_number' | 'scheduled_date'; value: string | null }) =>
      updateJobField(jobId, field, value, { actor_id: user!.id, actor_name: profile?.full_name }),
    onSuccess: (updated) => {
      qc.setQueryData(JOB_KEYS.detail(updated.id), updated)
    },
  })
}

export function useCompleteChecklistItem() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()

  return useMutation({
    mutationFn: ({ itemId, jobId, photoUrl }: { itemId: string; jobId: string; photoUrl?: string }) =>
      completeChecklistItem(itemId, jobId, { actor_id: user!.id, actor_name: profile?.full_name }, photoUrl),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: JOB_KEYS.checklist(vars.jobId) })
      qc.invalidateQueries({ queryKey: JOB_KEYS.activity(vars.jobId) })
    },
  })
}

export function useUncompleteChecklistItem() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ itemId, jobId }: { itemId: string; jobId: string }) =>
      uncompleteChecklistItem(itemId),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: JOB_KEYS.checklist(vars.jobId) })
    },
  })
}

export function useVerifyChecklistItem() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()

  return useMutation({
    mutationFn: ({ itemId, jobId }: { itemId: string; jobId: string }) =>
      verifyChecklistItem(itemId, jobId, { actor_id: user!.id, actor_name: profile?.full_name }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: JOB_KEYS.checklist(vars.jobId) })
      qc.invalidateQueries({ queryKey: JOB_KEYS.activity(vars.jobId) })
    },
  })
}

export function useSubmitFormResponse() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()

  return useMutation({
    mutationFn: ({ jobId, formType, responseData, signatureUrl }: {
      jobId: string; formType: string; responseData: Record<string, any>; signatureUrl: string | null
    }) =>
      submitFormResponse(jobId, formType, responseData, signatureUrl, { actor_id: user!.id, actor_name: profile?.full_name }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: JOB_KEYS.forms(vars.jobId) })
      qc.invalidateQueries({ queryKey: JOB_KEYS.responses(vars.jobId) })
      qc.invalidateQueries({ queryKey: JOB_KEYS.activity(vars.jobId) })
    },
  })
}
