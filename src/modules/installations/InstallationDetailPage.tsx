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

import { CompletionReadinessPanel } from './CompletionReadinessPanel'
import { InstallerChecklistTab } from './tabs/InstallerChecklistTab'
import { PhotosTab } from './tabs/PhotosTab'
import { CustomerHandoverTab } from './tabs/CustomerHandoverTab'
import { ConsentsTab } from './tabs/ConsentsTab'
import { JobActivityTab } from '../dispatch/tabs/JobActivityTab'

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

  // Sync fetched job into local state
  const currentJob = job || fetchedJob

  // Completion readiness — controls Mark Complete button
  const { data: completionStatus } = useQuery<CompletionStatus>({
    queryKey: ['job_completion', currentJob?.id],
    queryFn: () => getCompletionStatus(currentJob!.id),
    enabled: !!currentJob?.id && currentJob?.status === 'in_progress',
    staleTime: 5_000,
    refetchInterval: 10_000,
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
          <div className="text-red text-sm mb-2">Failed to load installation.</div>
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

      {/* Action bar — Installations owns Start Job + Mark Complete */}
      <div className="flex flex-wrap gap-2 mb-4 flex-shrink-0">
        {currentJob.status === 'scheduled' && (
          <button
            onClick={() => handleStatusChange('in_progress')}
            disabled={statusPending}
            className="text-xs px-4 py-2 bg-cyan/15 text-cyan border border-cyan/30 rounded-lg font-semibold hover:bg-cyan/25 transition-colors disabled:opacity-50"
          >
            🔧 Start Installation
          </button>
        )}
        {currentJob.status === 'in_progress' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleStatusChange('complete')}
              disabled={statusPending || !canComplete}
              className={`text-xs px-4 py-2 rounded-lg font-semibold transition-colors ${
                canComplete
                  ? 'bg-green/15 text-green border border-green/30 hover:bg-green/25'
                  : 'bg-muted/10 text-muted border border-border cursor-not-allowed'
              }`}
              title={!canComplete ? 'Complete all requirements first' : undefined}
            >
              ✅ Mark Complete
            </button>
            {!canComplete && completionStatus && (
              <span className="text-xs text-amber">
                {completionStatus.issues.length} blocking issue{completionStatus.issues.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}
        {currentJob.status === 'complete' && (
          <div className="text-xs text-green font-semibold px-3 py-2">
            ✅ Installation Complete — {formatDate(currentJob.completed_at)}
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
  <div className="mb-4 text-sm text-amber-300 bg-amber-500/15 border border-amber-500/30 rounded-lg px-4 py-3 font-semibold">
    ⚠️ {statusError}
  </div>
)}

      {/* Completion Readiness */}
      <div className="mb-4 flex-shrink-0">
        <CompletionReadinessPanel jobId={currentJob.id} jobStatus={currentJob.status} />
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
