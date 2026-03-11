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

const TABS: { key: InstallTab; label: string; icon: string }[] = [
  { key: 'checklist', label: 'Checklist', icon: '✓' },
  { key: 'photos',   label: 'Photos',    icon: '📷' },
  { key: 'handover', label: 'Handover',  icon: '🤝' },
  { key: 'consents', label: 'Consents',  icon: '📋' },
  { key: 'activity', label: 'Activity',  icon: '🕐' },
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
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24 }}>
        <div style={{ color: '#64748b', fontSize: 14 }}>Loading installation...</div>
      </div>
    )
  }
  if (error || !currentJob) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#f87171', fontSize: 14, marginBottom: 8 }}>Failed to load installation.</div>
          <button onClick={() => navigate('/installations')} style={{ color: '#22d3ee', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
            ← Back to list
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{
        flexShrink: 0,
        padding: '12px 16px',
        borderBottom: '1px solid #1e3a4f',
        background: '#0f1923',
      }}>
        <button
          onClick={() => navigate('/installations')}
          style={{ color: '#64748b', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}
        >
          ← Back to Installations
        </button>

        {/* Name + badge row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 18, margin: 0, lineHeight: 1.3 }}>
              {currentJob.customer_name_snapshot}
            </h1>
            <div style={{ color: '#64748b', fontSize: 13, marginTop: 2, wordBreak: 'break-word' }}>
              {currentJob.service_address_snapshot}
            </div>
            {(currentJob.phone_snapshot || currentJob.email_snapshot) && (
              <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                {currentJob.phone_snapshot}
                {currentJob.email_snapshot && ` · ${currentJob.email_snapshot}`}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className={`stage-badge border ${JOB_STATUS_COLORS[currentJob.status]}`}>
              {JOB_STATUS_LABELS[currentJob.status]}
            </div>
            <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>
              {SYSTEM_TYPE_LABELS[currentJob.system_type]}
            </div>
          </div>
        </div>
      </div>

      {/* ── Action bar ── */}
      <div style={{
        flexShrink: 0,
        padding: '10px 16px',
        borderBottom: '1px solid #1e3a4f',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
        background: '#0f1923',
      }}>
        {currentJob.status === 'scheduled' && (
          <button
            onClick={() => handleStatusChange('in_progress')}
            disabled={statusPending}
            style={{
              fontSize: 13, padding: '9px 18px', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
              backgroundColor: 'rgba(6,182,212,0.15)', color: '#22d3ee', border: '1px solid rgba(6,182,212,0.3)',
              opacity: statusPending ? 0.5 : 1, whiteSpace: 'nowrap',
            }}
          >
            🔧 Start Installation
          </button>
        )}

        {currentJob.status === 'in_progress' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => handleStatusChange('complete')}
              disabled={statusPending || !canComplete}
              style={canComplete ? {
                fontSize: 13, padding: '9px 18px', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
                backgroundColor: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)',
                whiteSpace: 'nowrap',
              } : {
                fontSize: 13, padding: '9px 18px', borderRadius: 8, fontWeight: 600,
                backgroundColor: 'rgba(148,163,184,0.1)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.2)',
                cursor: 'not-allowed', opacity: 0.7, whiteSpace: 'nowrap',
              }}
              title={!canComplete ? 'Complete all requirements first' : undefined}
            >
              ✅ Mark Complete
            </button>
            {!canComplete && completionStatus && (
              <span style={{ color: '#fbbf24', fontSize: 12 }}>
                {completionStatus.issues.length} blocking issue{completionStatus.issues.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}

        {currentJob.status === 'complete' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ color: '#4ade80', fontSize: 13, fontWeight: 600 }}>
              ✅ Complete — {formatDate(currentJob.completed_at)}
            </div>
            {linkedCustomer && (
              <button
                onClick={() => navigate(`/customers/${linkedCustomer.id}`)}
                style={{
                  fontSize: 12, padding: '7px 14px', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
                  backgroundColor: 'rgba(56,189,248,0.12)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.25)',
                  whiteSpace: 'nowrap',
                }}
              >
                👤 {linkedCustomer.full_name}
              </button>
            )}
          </div>
        )}

        {/* Date chips */}
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap', alignItems: 'center' }}>
          {currentJob.scheduled_date && (
            <span style={{ color: '#64748b', fontSize: 12 }}>
              📅 {new Date(currentJob.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
          {currentJob.started_at && (
            <span style={{ color: '#64748b', fontSize: 12 }}>Started {formatDate(currentJob.started_at)}</span>
          )}
        </div>
      </div>

      {statusError && (
        <div style={{
          flexShrink: 0, margin: '8px 16px', borderRadius: 8, padding: '10px 14px',
          color: '#fbbf24', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)',
          fontSize: 13, fontWeight: 600,
        }}>
          ⚠️ {statusError}
        </div>
      )}

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

        {/* Completion Readiness */}
        <div style={{ padding: '12px 16px 0' }}>
          <CompletionReadinessPanel jobId={currentJob.id} jobStatus={currentJob.status} />
        </div>

        {/* Site Survey */}
        <div style={{ padding: '12px 16px 0' }}>
          <SiteSurveyCapture
            context="job"
            jobId={currentJob.id}
            opportunityId={currentJob.lead_id || null}
            systemTypeContext={{ jobSystemType: currentJob.system_type || null }}
            defaultCollapsed={true}
          />
        </div>

        {/* ── Tabs ── */}
        <div style={{ padding: '16px 16px 0' }}>
          {/* Tab bar — scrolls horizontally on mobile */}
          <div style={{
            display: 'flex',
            overflowX: 'auto',
            borderBottom: '1px solid #1e3a4f',
            scrollbarWidth: 'none',
            WebkitOverflowScrolling: 'touch',
            gap: 0,
          }}>
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  flexShrink: 0,
                  padding: '10px 18px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === tab.key ? '2px solid #22d3ee' : '2px solid transparent',
                  color: activeTab === tab.key ? '#22d3ee' : '#64748b',
                  transition: 'color 0.15s',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 14 }}>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content — full width, proper padding */}
          <div style={{ paddingTop: 16, paddingBottom: 32, minHeight: 300 }}>
            {activeTab === 'checklist' && <InstallerChecklistTab jobId={currentJob.id} />}
            {activeTab === 'photos'    && <PhotosTab jobId={currentJob.id} />}
            {activeTab === 'handover'  && <CustomerHandoverTab jobId={currentJob.id} />}
            {activeTab === 'consents'  && <ConsentsTab jobId={currentJob.id} />}
            {activeTab === 'activity'  && <JobActivityTab jobId={currentJob.id} />}
          </div>
        </div>

      </div>
    </div>
  )
}
