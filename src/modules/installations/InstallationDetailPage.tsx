import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useJob, useJobActivity, useUpdateJobStatus } from '../dispatch/useJobs'
import { useAuth } from '../../hooks/useAuth'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { JOB_KEYS } from '../dispatch/useJobs'
import { getCompletionStatus } from '../../services/jobService'
import type { CompletionStatus } from '../../services/jobService'
import type { Job, JobStatus } from '../dispatch/dispatch.types'
import { JOB_STATUS_LABELS, JOB_STATUS_COLORS, SYSTEM_TYPE_LABELS } from '../dispatch/dispatch.types'
import { supabase } from '../../lib/supabase'

import { CompletionReadinessPanel } from './CompletionReadinessPanel'
import { InstallerChecklistTab } from './tabs/InstallerChecklistTab'
import { PhotosTab } from './tabs/PhotosTab'
import { CustomerHandoverTab } from './tabs/CustomerHandoverTab'
import { ConsentsTab } from './tabs/ConsentsTab'
import { JobActivityTab } from '../dispatch/tabs/JobActivityTab'
import SiteSurveyCapture from '../leads/SiteSurveyCapture'

type InstallTab = 'checklist' | 'photos' | 'handover' | 'consents' | 'activity'

const TABS: { key: InstallTab; label: string }[] = [
  { key: 'checklist', label: 'Checklist' },
  { key: 'photos', label: 'Photos' },
  { key: 'handover', label: 'Handover' },
  { key: 'consents', label: 'Consents' },
  { key: 'activity', label: 'Activity' },
]

function formatDate(str: string | null) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function InstallationDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const qc = useQueryClient()

  const { data: fetchedJob, isLoading, error } = useJob(jobId || '')
  const { mutateAsync: updateStatus, isPending: statusPending } = useUpdateJobStatus()

  const [job, setJob] = useState<Job | null>(null)
  const [activeTab, setActiveTab] = useState<InstallTab>('checklist')
  const [statusError, setStatusError] = useState('')

  const currentJob = job || fetchedJob

  const { data: completionStatus } = useQuery<CompletionStatus>({
    queryKey: ['job_completion', currentJob?.id],
    queryFn: () => getCompletionStatus(currentJob!.id),
    enabled: !!currentJob?.id && currentJob?.status === 'in_progress',
    staleTime: 5_000,
    refetchInterval: 10_000,
  })

  // Find linked customer for completed jobs
  const { data: linkedCustomer } = useQuery({
    queryKey: ['job_customer', currentJob?.id],
    queryFn: async () => {
      if (!currentJob?.lead_id) return null
      const { data } = await supabase.from('customers').select('id, full_name').eq('lead_id', currentJob.lead_id).maybeSingle()
      return data
    },
    enabled: !!currentJob?.id && currentJob?.status === 'complete',
  })

  const canComplete = completionStatus?.ready === true

  const handleJobUpdated = useCallback((updated: Job) => {
    setJob(updated)
    qc.invalidateQueries({ queryKey: JOB_KEYS.board() })
    qc.invalidateQueries({ queryKey: JOB_KEYS.activity(updated.id) })
    qc.invalidateQueries({ queryKey: ['job_completion', updated.id] })
  }, [qc])

  async function handleStatusChange(newStatus: JobStatus) {
    if (!currentJob) return
    setStatusError('')
    try {
      const updated = await updateStatus({ jobId: currentJob.id, newStatus, currentJob })
      handleJobUpdated(updated)
    } catch (e: any) {
      setStatusError(e.message)
    }
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><div className="text-muted text-sm">Loading installation...</div></div>
  }
  if (error || !currentJob) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-sm mb-2" style={{ color: '#f87171' }}>Failed to load installation.</div>
          <button onClick={() => navigate('/installations')} className="text-accent text-sm hover:underline">← Back to list</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-shrink-0">
        <div>
          <button
            onClick={() => navigate('/installations')}
            className="text-xs text-muted hover:text-accent transition-colors mb-2 flex items-center gap-1"
          >
            ← Back to Installations
          </button>
          <h1 className="text-xl font-bold text-white">{currentJob.customer_name_snapshot}</h1>
          <div className="text-sm text-muted mt-0.5">{currentJob.service_address_snapshot}</div>
          <div className="text-xs text-muted mt-0.5">
            {currentJob.phone_snapshot}
            {currentJob.email_snapshot && ` · ${currentJob.email_snapshot}`}
          </div>
        </div>
        <div className="text-right">
          <div className={`stage-badge border ${JOB_STATUS_COLORS[currentJob.status]}`}>
            {JOB_STATUS_LABELS[currentJob.status]}
          </div>
          <div className="text-xs text-muted mt-1">{SYSTEM_TYPE_LABELS[currentJob.system_type]}</div>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap gap-2 mb-4 flex-shrink-0">
        {currentJob.status === 'scheduled' && (
          <button
            onClick={() => handleStatusChange('in_progress')}
            disabled={statusPending}
            className="text-xs px-4 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'rgba(6,182,212,0.15)', color: '#22d3ee', border: '1px solid rgba(6,182,212,0.3)' }}
          >
            🔧 Start Installation
          </button>
        )}
        {currentJob.status === 'in_progress' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleStatusChange('complete')}
              disabled={statusPending || !canComplete}
              className="text-xs px-4 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50"
              style={canComplete
                ? { backgroundColor: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }
                : { backgroundColor: 'rgba(148,163,184,0.1)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.2)', cursor: 'not-allowed' }
              }
              title={!canComplete ? 'Complete all requirements first' : undefined}
            >
              ✅ Mark Complete
            </button>
            {!canComplete && completionStatus && (
              <span className="text-xs" style={{ color: '#fbbf24' }}>
                {completionStatus.issues.length} blocking issue{completionStatus.issues.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}
        {currentJob.status === 'complete' && (
          <div className="flex items-center gap-3">
            <div className="text-xs font-semibold px-3 py-2" style={{ color: '#4ade80' }}>
              ✅ Installation Complete — {formatDate(currentJob.completed_at)}
            </div>
            {/* Link to customer */}
            {linkedCustomer && (
              <button
                onClick={() => navigate(`/customers/${linkedCustomer.id}`)}
                className="text-xs px-3 py-2 rounded-lg font-semibold transition-colors"
                style={{ backgroundColor: 'rgba(56,189,248,0.12)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.25)' }}
              >
                👤 View Customer: {linkedCustomer.full_name}
              </button>
            )}
          </div>
        )}

        {/* Info chips */}
        <div className="flex items-center gap-2 ml-auto">
          {currentJob.scheduled_date && (
            <span className="text-xs text-muted">
              📅 {new Date(currentJob.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
          {currentJob.started_at && (
            <span className="text-xs text-muted">Started {formatDate(currentJob.started_at)}</span>
          )}
        </div>
      </div>

      {statusError && (
        <div className="mb-4 text-sm font-semibold rounded-lg px-4 py-3" style={{ color: '#fbbf24', backgroundColor: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
          ⚠️ {statusError}
        </div>
      )}

      {/* Completion Readiness */}
      <div className="mb-4 flex-shrink-0">
        <CompletionReadinessPanel jobId={currentJob.id} jobStatus={currentJob.status} />
      </div>

      {/* Site Survey — installer sees lead survey + can add supplemental photos */}
      <div className="mb-4 flex-shrink-0">
        <SiteSurveyCapture
          context="job"
          jobId={currentJob.id}
          opportunityId={currentJob.lead_id || null}
          systemTypeContext={{
            jobSystemType: currentJob.system_type || null,
          }}
          defaultCollapsed={true}
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border flex-shrink-0 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wide whitespace-nowrap transition-colors ${
              activeTab === tab.key
                ? 'text-accent border-b-2 border-accent'
                : 'text-muted hover:text-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto py-5">
        {activeTab === 'checklist' && <InstallerChecklistTab jobId={currentJob.id} />}
        {activeTab === 'photos' && <PhotosTab jobId={currentJob.id} />}
        {activeTab === 'handover' && <CustomerHandoverTab jobId={currentJob.id} />}
        {activeTab === 'consents' && <ConsentsTab jobId={currentJob.id} />}
        {activeTab === 'activity' && <JobActivityTab jobId={currentJob.id} />}
      </div>
    </div>
  )
}
