import { useState, useCallback, useEffect } from 'react'
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
import MarkCompleteButton from './MarkCompleteButton'
import { WaterTestForm } from '../shared/WaterTestForm'
import { WaterTestHistory, WaterTestComparison } from '../shared/WaterTestResults'
import { fetchByJob, fetchByLead, type WaterTest } from '../../services/waterTestService'

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

function useIsMobile() {
  const [v, setV] = useState(window.innerWidth < 768)
  useEffect(() => { const h = () => setV(window.innerWidth < 768); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h) }, [])
  return v
}

export function InstallationDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const qc = useQueryClient()
  const mob = useIsMobile()

  const { data: fetchedJob, isLoading, error } = useJob(jobId || '')
  const { mutateAsync: updateStatus, isPending: statusPending } = useUpdateJobStatus()

  const [job, setJob] = useState<Job | null>(null)
  const [activeTab, setActiveTab] = useState<InstallTab>('checklist')
  const [statusError, setStatusError] = useState('')

  // Water test state
  const [waterTests, setWaterTests] = useState<WaterTest[]>([])
  const [allTests, setAllTests] = useState<WaterTest[]>([]) // includes lead tests for before/after
  const [showWaterTestForm, setShowWaterTestForm] = useState(false)
  const [editingWaterTest, setEditingWaterTest] = useState<WaterTest | null>(null)
  const [waterTestsLoaded, setWaterTestsLoaded] = useState(false)

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

  // ── Install fee: fetch from accepted/signed quote linked to this job ──
  const { data: installFeeData } = useQuery({
    queryKey: ['job_install_fee', currentJob?.id],
    queryFn: async () => {
      const fallback = { installFee: 0, customerName: currentJob?.customer_name_snapshot || 'Customer' }

      let quote: any = null
      if (currentJob?.lead_id) {
        const { data: q } = await supabase
          .from('quotes')
          .select('install_fee, customer_name, customer_id')
          .or(`opportunity_id.eq.${currentJob.lead_id},lead_id.eq.${currentJob.lead_id}`)
          .in('status', ['accepted', 'signed'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        quote = q || null
      }

      if (!quote) {
        const { data: cust } = await supabase
          .from('customers')
          .select('id')
          .eq('job_id', currentJob!.id)
          .maybeSingle()
        if (cust?.id) {
          const { data: q } = await supabase
            .from('quotes')
            .select('install_fee, customer_name')
            .eq('customer_id', cust.id)
            .in('status', ['accepted', 'signed'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          quote = q || null
        }
      }

      if (!quote) return fallback
      return {
        installFee: quote.install_fee ? parseFloat(quote.install_fee) : 0,
        customerName: quote.customer_name || currentJob?.customer_name_snapshot || 'Customer',
      }
    },
    enabled: !!currentJob?.id && (currentJob?.status === 'in_progress' || currentJob?.status === 'scheduled'),
    staleTime: 30_000,
  })

  // ── Load water tests for this job + lead (for before/after) ──
  useEffect(() => {
    if (!currentJob?.id) return
    loadWaterTests()
  }, [currentJob?.id])

  async function loadWaterTests() {
    if (!currentJob) return
    const jobTests = await fetchByJob(currentJob.id)
    setWaterTests(jobTests)

    // Also load lead tests for before/after comparison
    const leadTests = currentJob.lead_id ? await fetchByLead(currentJob.lead_id) : []
    const combined = [...leadTests, ...jobTests]
    // Deduplicate
    const seen = new Set<string>()
    const deduped = combined.filter(t => {
      if (seen.has(t.id)) return false
      seen.add(t.id)
      return true
    })
    setAllTests(deduped)
    setWaterTestsLoaded(true)
  }

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

  function handleInstallCompleted(result: any) {
    qc.invalidateQueries({ queryKey: JOB_KEYS.detail(currentJob!.id) })
    qc.invalidateQueries({ queryKey: JOB_KEYS.board() })
    qc.invalidateQueries({ queryKey: JOB_KEYS.activity(currentJob!.id) })
    qc.invalidateQueries({ queryKey: ['job_completion', currentJob!.id] })
    qc.invalidateQueries({ queryKey: ['job_customer', currentJob!.id] })

    if (currentJob) {
      setJob({
        ...currentJob,
        status: 'complete' as JobStatus,
        completed_at: new Date().toISOString(),
      })
    }
  }

  // Water test handlers
  function handleWaterTestSaved(test: WaterTest) {
    setShowWaterTestForm(false)
    setEditingWaterTest(null)
    loadWaterTests()
  }

  function handleEditWaterTest(test: WaterTest) {
    setEditingWaterTest(test)
    setShowWaterTestForm(true)
  }

  async function handleDeleteWaterTest(test: WaterTest) {
    if (!confirm('Delete this water test? This cannot be undone.')) return
    const { deleteWaterTest } = await import('../../services/waterTestService')
    await deleteWaterTest(test.id)
    loadWaterTests()
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

  const userRole = profile?.role
  const canMarkComplete = userRole === 'admin' || userRole === 'tech'
  const showWaterTest = currentJob.status === 'in_progress' || currentJob.status === 'complete'
  const hasInitialTest = allTests.some(t => t.test_type === 'initial')
  const hasPostInstall = waterTests.some(t => t.test_type === 'post_install')

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
        flexDirection: mob ? 'column' : 'row',
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
              ...(mob ? { alignSelf: 'stretch', textAlign: 'center' } : {}),
            }}
          >
            🔧 Start Installation
          </button>
        )}

        {currentJob.status === 'in_progress' && canMarkComplete && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', ...(mob ? { width: '100%' } : {}) }}>
            {canComplete ? (
              <MarkCompleteButton
                jobId={currentJob.id}
                jobStatus={currentJob.status}
                installFee={installFeeData?.installFee ?? null}
                customerName={installFeeData?.customerName || currentJob.customer_name_snapshot || 'Customer'}
                completedBy={user?.id}
                onCompleted={handleInstallCompleted}
              />
            ) : (
              <>
                <button
                  disabled
                  style={{
                    fontSize: 13, padding: '9px 18px', borderRadius: 8, fontWeight: 600,
                    backgroundColor: 'rgba(148,163,184,0.1)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.2)',
                    cursor: 'not-allowed', opacity: 0.7, whiteSpace: 'nowrap',
                  }}
                  title="Complete all requirements first"
                >
                  ✅ Mark Complete
                </button>
                {completionStatus && (
                  <span style={{ color: '#fbbf24', fontSize: 12 }}>
                    {completionStatus.issues.length} blocking issue{completionStatus.issues.length !== 1 ? 's' : ''}
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {currentJob.status === 'in_progress' && !canMarkComplete && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', ...(mob ? { width: '100%' } : {}) }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', ...(mob ? { width: '100%' } : {}) }}>
            <div style={{ color: '#4ade80', fontSize: 13, fontWeight: 600 }}>
              ✅ Complete — {formatDate(currentJob.completed_at)}
            </div>
            {(currentJob as any).install_fee_charged && (
              <span style={{
                fontSize: 11, padding: '3px 8px', borderRadius: 6,
                backgroundColor: 'rgba(34,197,94,0.12)', color: '#4ade80',
                border: '1px solid rgba(34,197,94,0.25)',
              }}>
                💳 Install fee charged
              </span>
            )}
            {(currentJob as any).install_fee_charge_status === 'failed' && (
              <span style={{
                fontSize: 11, padding: '3px 8px', borderRadius: 6,
                backgroundColor: 'rgba(239,68,68,0.12)', color: '#f87171',
                border: '1px solid rgba(239,68,68,0.25)',
              }}>
                ⚠️ Install fee charge failed
              </span>
            )}
            {(currentJob as any).install_fee_charge_status === 'skipped' && (
              <span style={{
                fontSize: 11, padding: '3px 8px', borderRadius: 6,
                backgroundColor: 'rgba(251,191,36,0.12)', color: '#fbbf24',
                border: '1px solid rgba(251,191,36,0.25)',
              }}>
                No card — fee not charged
              </span>
            )}
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

        <div style={{ display: 'flex', gap: 8, marginLeft: mob ? 0 : 'auto', flexWrap: 'wrap', alignItems: 'center' }}>
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

        {/* ── Post-Install Water Test Section ── */}
        {showWaterTest && waterTestsLoaded && (
          <div style={{ padding: '12px 16px 0' }}>
            <div style={{
              background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14,
              overflow: 'hidden',
            }}>
              {/* Header */}
              <div style={{
                padding: '12px 16px', borderBottom: '1px solid #1e3a4f',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>💧</span>
                  <div>
                    <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>
                      Post-Install Water Test
                    </div>
                    <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                      {hasPostInstall
                        ? 'Post-install test recorded'
                        : hasInitialTest
                          ? 'Initial test found — record post-install to show improvement'
                          : 'Record readings after installation'
                      }
                    </div>
                  </div>
                </div>
                {!showWaterTestForm && (
                  <button
                    onClick={() => { setEditingWaterTest(null); setShowWaterTestForm(true) }}
                    style={{
                      padding: '5px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                      background: 'rgba(34,211,238,0.1)', color: '#22d3ee',
                      border: '1px solid rgba(34,211,238,0.25)', cursor: 'pointer',
                    }}
                  >
                    + {hasPostInstall ? 'New Test' : 'Record Test'}
                  </button>
                )}
              </div>

              <div style={{ padding: 16 }}>
                {/* Water test form */}
                {showWaterTestForm && (
                  <div style={{ marginBottom: 12 }}>
                    <WaterTestForm
                      jobId={currentJob.id}
                      leadId={currentJob.lead_id || undefined}
                      testType="post_install"
                      existingTest={editingWaterTest}
                      onSaved={handleWaterTestSaved}
                      onCancel={() => { setShowWaterTestForm(false); setEditingWaterTest(null) }}
                    />
                  </div>
                )}

                {/* Before/After comparison (if both initial and post-install exist) */}
                {!showWaterTestForm && hasInitialTest && hasPostInstall && (
                  <div style={{ marginBottom: 12 }}>
                    <WaterTestComparison tests={allTests} />
                  </div>
                )}

                {/* Job water test history */}
                {!showWaterTestForm && waterTests.length > 0 && (
                  <WaterTestHistory
                    tests={waterTests}
                    onEdit={handleEditWaterTest}
                    onDelete={handleDeleteWaterTest}
                  />
                )}

                {/* Empty state */}
                {!showWaterTestForm && waterTests.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '16px 0' }}>
                    <div style={{ fontSize: 24, marginBottom: 6, opacity: 0.4 }}>💧</div>
                    <p style={{ color: '#64748b', fontSize: 12 }}>
                      {hasInitialTest
                        ? 'Record a post-install test to show the improvement after installation.'
                        : 'No water tests yet. Record a test after installation to document results.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Tabs ── */}
        <div style={{ padding: '16px 16px 0' }}>
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
