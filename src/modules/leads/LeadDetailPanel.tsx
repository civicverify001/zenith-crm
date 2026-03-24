import { useState, useCallback, useEffect } from 'react'
import type { Lead } from './leads.types'
import { useAssignRep, useLogCallAttempt, useCallAttempts, useReps, useNewLeadActivity, LEAD_KEYS } from './useLeads'
import { useAuth } from '../../hooks/useAuth'
import { usePermissions } from '../../hooks/usePermissions'
import {
  LEAD_STAGE_LABELS,
  LEAD_STAGE_COLORS,
  LEAD_SOURCE_LABELS,
  WATER_CONCERN_LABELS,
} from '../../types/domain.types'
import { StageActionBar } from './StageActionBar'
import { ActivityFeed } from './ActivityFeed'
import { AgreementSignedPanel } from './AgreementSignedPanel'
import SiteSurveyCapture from './SiteSurveyCapture'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { moveStage } from '../../services/leadMutations'
import { QuoteBuilder } from '../quotes/QuoteBuilder'
import QualifyingChecklist from './QualifyingChecklist'
import SiteVisitScheduler from './SiteVisitScheduler'
import SiteVisitChecklist from './SiteVisitChecklist'
import { WaterTestForm } from '../shared/WaterTestForm'
import { WaterTestHistory, RecommendationSummary } from '../shared/WaterTestResults'
import { fetchByLead, type WaterTest } from '../../services/waterTestService'

interface Props {
  lead: Lead
  onClose: () => void
  onLeadUpdated?: (lead: Lead) => void
  onLeadDeleted?: (leadId: string) => void
}

function formatDate(str: string) {
  return new Date(str).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function daysSince(str: string | null | undefined) {
  if (!str) return 0
  return Math.floor((Date.now() - new Date(str).getTime()) / 86400000)
}

type Tab = 'overview' | 'activity' | 'calls'

export function LeadDetailPanel({ lead: initialLead, onClose, onLeadUpdated, onLeadDeleted }: Props) {
  const { role, user, profile } = useAuth()
  const { can } = usePermissions()
  const queryClient = useQueryClient()
  const isAdmin = profile?.role === 'admin'
  const isSalesRep = role === 'salesrep'

  const [lead, setLead] = useState<Lead>(initialLead)
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [showCallModal, setShowCallModal] = useState(false)
  const [callOutcome, setCallOutcome] = useState('answered')
  const [callNotes, setCallNotes] = useState('')
  const [deleting, setDeleting] = useState(false)

  // SMS modal state
  const [showSmsModal, setShowSmsModal] = useState(false)
  const [smsMessage, setSmsMessage] = useState('')
  const [smsSending, setSmsSending] = useState(false)
  const [smsTemplates, setSmsTemplates] = useState<any[]>([])

  const [showQuoteBuilder, setShowQuoteBuilder] = useState(false)
  const [pendingCustomerId, setPendingCustomerId] = useState<string | null>(null)
  const [quoteLink, setQuoteLink] = useState<string | null>(null)
  const [preparingQuote, setPreparingQuote] = useState(false)
  const [qualifyingComplete, setQualifyingComplete] = useState(false)
  const [showVisitScheduler, setShowVisitScheduler] = useState(false)
  const [visitInfo, setVisitInfo] = useState<{ rep_name: string; date: string; hour: number } | null>(null)
  const [siteVisitComplete, setSiteVisitComplete] = useState(false)
  const [visitConfirmed, setVisitConfirmed] = useState(false)
  // Water test state
  const [waterTests, setWaterTests] = useState<WaterTest[]>([])
  const [showWaterTestForm, setShowWaterTestForm] = useState(false)
  const [editingWaterTest, setEditingWaterTest] = useState<WaterTest | null>(null)
  const [waterTestsLoaded, setWaterTestsLoaded] = useState(false)

  // Load SMS templates
  useEffect(() => {
    supabase.from('sms_templates').select('*').eq('is_active', true).order('stage').order('name')
      .then(({ data }) => setSmsTemplates(data || []))
  }, [])

  const { mutateAsync: assignRep } = useAssignRep()
  const { mutateAsync: logCall, isPending: callPending } = useLogCallAttempt()
  const { data: activity, isLoading: activityLoading } = useNewLeadActivity(lead.id)
  const { data: calls } = useCallAttempts(lead.id)
  const { data: reps } = useReps()

  // ── Load existing quote link when in quote_sent stage ────────
  useEffect(() => {
    if (lead.stage !== 'quote_sent') return
    supabase
      .from('quotes')
      .select('public_token, quote_number, status')
      .eq('lead_id', lead.id)
      .in('status', ['sent', 'viewed', 'signed', 'accepted'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.public_token) {
          setQuoteLink(`${window.location.origin}/q/${data.public_token}`)
        }
      })
  }, [lead.id, lead.stage])

  // ── Load existing site visit info ──────────────────────────────
  useEffect(() => {
    if (!['site_visit_scheduled', 'proposal_in_progress', 'quote_sent', 'agreement_signed'].includes(lead.stage)) return
    supabase
      .from('site_visits')
      .select('assigned_rep_id, visit_date, visit_hour, status, notes')
      .eq('lead_id', lead.id)
      .eq('status', 'scheduled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(async ({ data }) => {
        if (data) {
          const { data: rep } = await supabase
            .from('user_profiles')
            .select('full_name')
            .eq('id', data.assigned_rep_id)
            .maybeSingle()
          const repName = rep?.full_name || 'Rep'
          setVisitInfo({ rep_name: repName, date: data.visit_date, hour: data.visit_hour })
          // Check for inbound CONFIRM reply from customer
          const { data: confirmMsg } = await supabase
            .from('communications_log')
            .select('id')
            .eq('entity_type', 'lead')
            .eq('entity_id', lead.id)
            .eq('direction', 'inbound')
            .ilike('body', 'CONFIRM%')
            .limit(1)
            .maybeSingle()
          setVisitConfirmed(!!confirmMsg)
        }
      })
  }, [lead.id, lead.stage])

  // ── Load water tests for this lead ─────────────────────────────
  const WATER_TEST_STAGES = ['site_visit_scheduled', 'proposal_in_progress', 'quote_sent', 'agreement_signed', 'won']
  useEffect(() => {
    if (!WATER_TEST_STAGES.includes(lead.stage)) return
    fetchByLead(lead.id).then(tests => {
      setWaterTests(tests)
      setWaterTestsLoaded(true)
    })
  }, [lead.id, lead.stage])

  // ── Handle visit scheduled ─────────────────────────────────────
  async function handleVisitScheduled(visit: { rep_name: string; date: string; hour: number }) {
    setVisitInfo(visit)
    setShowVisitScheduler(false)
    if (user) {
      try {
        const actor = { actor_id: user.id, actor_name: profile?.full_name }
        const updated = await moveStage(lead.id, lead.stage, 'site_visit_scheduled', actor)
        handleLeadUpdated(updated)
      } catch (e) {
        console.error('Stage move after visit schedule failed:', e)
      }
    }
  }

  const handleLeadUpdated = useCallback((updated: Lead) => {
    setLead(updated)
    onLeadUpdated?.(updated)
    queryClient.invalidateQueries({ queryKey: LEAD_KEYS.kanban() })
    queryClient.invalidateQueries({ queryKey: LEAD_KEYS.counts })
    queryClient.invalidateQueries({ queryKey: LEAD_KEYS.activity(updated.id) })
    queryClient.invalidateQueries({ queryKey: ['lead_activity_log', updated.id] })
  }, [onLeadUpdated, queryClient])

  // ── Water test handlers ─────────────────────────────────────────
  function handleWaterTestSaved(test: WaterTest) {
    setShowWaterTestForm(false)
    setEditingWaterTest(null)
    fetchByLead(lead.id).then(tests => setWaterTests(tests))
  }

  function handleEditWaterTest(test: WaterTest) {
    setEditingWaterTest(test)
    setShowWaterTestForm(true)
  }

  async function handleDeleteWaterTest(test: WaterTest) {
    if (!confirm('Delete this water test? This cannot be undone.')) return
    const { deleteWaterTest } = await import('../../services/waterTestService')
    await deleteWaterTest(test.id)
    fetchByLead(lead.id).then(tests => setWaterTests(tests))
  }

  // ── Send Text to lead ────────────────────────────────────────────
  async function handleSendLeadSms() {
    if (!smsMessage.trim() || !lead.phone) return
    setSmsSending(true)
    try {
      await fetch('/api/openphone/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: lead.phone,
          message: smsMessage.trim(),
          entity_type: 'lead',
          entity_id: lead.id,
        }),
      })
      setShowSmsModal(false)
      setSmsMessage('')
    } catch (e) {
      console.error('Send SMS error:', e)
    } finally {
      setSmsSending(false)
    }
  }

  // ── Delete lead (admin only) ─────────────────────────────────
  async function handleDeleteLead() {
    if (!confirm(`Delete lead "${lead.full_name}"?\n\nThis will also delete linked quotes, agreements, and activity. Cannot be undone.`)) return
    setDeleting(true)
    try {
      const { data: quotes } = await supabase.from('quotes').select('id').eq('lead_id', lead.id)
      if (quotes?.length) {
        const quoteIds = quotes.map(q => q.id)
        await supabase.from('agreements').delete().in('quote_id', quoteIds)
        await supabase.from('quotes').delete().in('id', quoteIds)
      }
      await supabase.from('lead_activity_log').delete().eq('lead_id', lead.id)
      await supabase.from('call_attempts').delete().eq('lead_id', lead.id)
      await supabase.from('customers').update({ lead_id: null }).eq('lead_id', lead.id)
      const { error } = await supabase.from('leads').delete().eq('id', lead.id)
      if (error) throw error
      queryClient.invalidateQueries({ queryKey: LEAD_KEYS.kanban() })
      queryClient.invalidateQueries({ queryKey: LEAD_KEYS.counts })
      onLeadDeleted?.(lead.id)
      onClose()
    } catch (err: any) {
      alert('Delete failed: ' + (err.message || err))
      setDeleting(false)
    }
  }

  // ── Open quote builder ───────────────────────────────────────
  async function handleCreateQuote() {
    if (!user) return
    setPreparingQuote(true)
    try {
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('lead_id', lead.id)
        .maybeSingle()

      let customerId = existing?.id

      if (!customerId) {
        const { data: newCust, error } = await supabase
          .from('customers')
          .insert({
            lead_id:          lead.id,
            full_name:        lead.full_name,
            phone:            lead.phone,
            email:            lead.email || null,
            address:          lead.address || null,
            city:             lead.city   || null,
            state:            lead.state  || null,
            zip:              lead.zip_code || null,
            lifecycle_status: 'lead',
          })
          .select('id')
          .single()
        if (error) throw error
        customerId = newCust.id
      }

      setPendingCustomerId(customerId)
      setShowQuoteBuilder(true)

      const stagesBeforeProposal = ['new_lead', 'qualifying', 'qualified', 'site_visit_scheduled']
      if (stagesBeforeProposal.includes(lead.stage)) {
        const actor = { actor_id: user.id, actor_name: profile?.full_name }
        try {
          const updated = await moveStage(lead.id, lead.stage, 'proposal_in_progress', actor)
          handleLeadUpdated(updated)
        } catch { /* non-critical */ }
      }
    } catch (e: any) {
      alert('Could not set up quote: ' + e.message)
    } finally {
      setPreparingQuote(false)
    }
  }

  async function handleQuoteSaved(quote: any) {
    if (quote.public_token) {
      setQuoteLink(`${window.location.origin}/q/${quote.public_token}`)
    }
    if (['sent', 'send', 'pending'].includes(quote.status) && lead.stage !== 'quote_sent' && user) {
      try {
        const actor = { actor_id: user.id, actor_name: profile?.full_name }
        const updated = await moveStage(lead.id, lead.stage, 'quote_sent', actor)
        handleLeadUpdated(updated)
      } catch (e) {
        console.error('Stage move failed:', e)
      }
    }
    setShowQuoteBuilder(false)
  }

  async function handleLogCall() {
    try {
      await logCall({ leadId: lead.id, outcome: callOutcome, notes: callNotes })
      setShowCallModal(false)
      setCallNotes('')

      // ── consult_noshow_task (fire-and-forget) ─────────────
      if (callOutcome === 'no_show') {
        supabase.from('follow_up_tasks').insert({
          entity_type: 'lead',
          entity_id: lead.id,
          title: `No-show follow-up: ${lead.full_name}`,
          description: 'Customer did not show for scheduled consultation. Follow up to reschedule.',
          due_date: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().split('T')[0],
          status: 'pending',
          priority: 'high',
          assigned_to: lead.assigned_rep_id || null,
        }).then(() => {}).catch(() => {})
      }
    } catch (e) { console.error(e) }
  }

  const stageEnteredAt = lead.stage_entered_at || lead.stage_changed_at
  const daysInStage = daysSince(stageEnteredAt)
  const fullAddress = [lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ')
  const showWaterTests = WATER_TEST_STAGES.includes(lead.stage)

  return (
    <>
      <div className="fixed inset-0 z-40 flex justify-end">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />

        <div className="relative w-full max-w-lg bg-surface border-l border-border h-full overflow-y-auto shadow-2xl flex flex-col">

          {/* Header */}
          <div className="flex items-start justify-between p-5 border-b border-border flex-shrink-0">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-accent/20 text-accent font-bold flex items-center justify-center text-sm">
                {lead.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-white">{lead.full_name}</h2>
                  {lead.urgent && <span className="text-orange text-sm">🔥</span>}
                </div>
                <div className="text-sm text-muted">{lead.phone}</div>
                {lead.email && <div className="text-xs text-muted">{lead.email}</div>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <button
                  onClick={handleDeleteLead}
                  disabled={deleting}
                  title="Delete lead"
                  className="text-red-500/50 hover:text-red-400 hover:bg-red-500/10 rounded-lg p-1.5 transition-colors disabled:opacity-40"
                  style={{ fontSize: 15, lineHeight: 1 }}
                >
                  {deleting ? '…' : '🗑'}
                </button>
              )}
              <button onClick={onClose} className="text-muted hover:text-white text-xl leading-none">✕</button>
            </div>
          </div>

          {/* Stage badge + actions */}
          <div className="px-5 py-3 border-b border-border flex-shrink-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <div className={`stage-badge border ${LEAD_STAGE_COLORS[lead.stage]}`}>
                {LEAD_STAGE_LABELS[lead.stage]}
              </div>

              {/* Log Call — hidden for sales reps */}
              {!isSalesRep && (
                <button
                  onClick={() => setShowCallModal(true)}
                  className="text-xs px-2.5 py-1 bg-green/10 text-green border border-green/30 rounded-lg hover:bg-green/20 transition-colors"
                >
                  📞 Log Call
                </button>
              )}

              {/* Send Text — available to all roles */}
              {lead.phone && (
                <button
                  onClick={() => {
                    setSmsMessage(`Hi ${lead.full_name.split(' ')[0]}, `)
                    setShowSmsModal(true)
                  }}
                  className="text-xs px-2.5 py-1 rounded-lg border transition-colors"
                  style={{
                    background: 'rgba(34,197,94,0.1)',
                    color: '#22c55e',
                    borderColor: 'rgba(34,197,94,0.3)',
                  }}
                >
                  💬 Send Text
                </button>
              )}
            </div>

            <StageActionBar
              lead={lead}
              onLeadUpdated={handleLeadUpdated}
              onCreateQuote={handleCreateQuote}
              qualifyingComplete={qualifyingComplete}
              onScheduleVisit={() => setShowVisitScheduler(true)}
              siteVisitComplete={siteVisitComplete}
              callAttemptCount={calls?.length || 0}
              hasNoContactRequest={calls?.some((c: any) => c.outcome === 'no_contact_requested') ?? false}
            />

            {preparingQuote && (
              <div className="text-xs text-accent animate-pulse">Opening quote builder…</div>
            )}
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border flex-shrink-0">
            {(['overview', 'activity', 'calls'] as Tab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                  activeTab === tab ? 'text-accent border-b-2 border-accent' : 'text-muted hover:text-slate-300'
                }`}
              >
                {tab}
                {tab === 'calls' && calls && calls.length > 0 && (
                  <span className="ml-1 bg-muted/30 rounded-full px-1.5 py-0.5 text-xs">{calls.length}</span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-5">

            {activeTab === 'overview' && (
              <div className="space-y-4">

                {lead.stage === 'qualifying' && (
                  <QualifyingChecklist lead={lead} onLeadUpdated={handleLeadUpdated} onCompletionChange={setQualifyingComplete} />
                )}

                {lead.stage === 'site_visit_scheduled' && (
                  <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, overflow: 'hidden' }}>
                    <div style={{ padding: '10px 14px', borderBottom: '1px solid #1e3a4f', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13 }}>📋</span>
                      <span style={{ color: '#94a3b8', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Qualifying Notes (from office)</span>
                    </div>
                    <div style={{ padding: '10px 14px' }}>
                      <QualifyingChecklist lead={lead} onLeadUpdated={handleLeadUpdated} onCompletionChange={setQualifyingComplete} readOnly />
                    </div>
                  </div>
                )}

                {/* Site Visit Info */}
                {visitInfo && ['site_visit_scheduled', 'proposal_in_progress', 'quote_sent', 'agreement_signed'].includes(lead.stage) && (
                  <div className="rounded-xl p-4" style={{ backgroundColor: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="text-xs font-bold uppercase tracking-wide" style={{ color: '#60a5fa' }}>
                          📅 Site Visit {lead.stage === 'site_visit_scheduled' ? 'Scheduled' : 'Completed'}
                        </div>
                        {visitConfirmed
                          ? <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: 'rgba(74,222,128,0.2)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.4)', boxShadow: '0 0 8px rgba(74,222,128,0.2)' }}>✓ Confirmed</span>
                          : <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: 'rgba(100,116,139,0.15)', color: '#64748b', border: '1px solid rgba(100,116,139,0.2)' }}>Awaiting</span>
                        }
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-white">
                        <span className="font-semibold">{visitInfo.rep_name}</span>
                        {' · '}
                        {new Date(visitInfo.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                        {' · '}
                        {({9:'9:00 AM',10:'10:00 AM',11:'11:00 AM',12:'12:00 PM',13:'1:00 PM',14:'2:00 PM',15:'3:00 PM',16:'4:00 PM'} as Record<number,string>)[visitInfo.hour]}
                      </div>
                    </div>
                  </div>
                )}

                {/* Site Visit Checklist */}
                {lead.stage === 'site_visit_scheduled' && (
                  <SiteVisitChecklist lead={lead} onLeadUpdated={handleLeadUpdated} onCompletionChange={setSiteVisitComplete} />
                )}

                {/* ── Water Test Section ──────────────────────────────── */}
                {showWaterTests && waterTestsLoaded && (
                  <div>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: 10,
                    }}>
                      <div style={{
                        fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                        color: '#22d3ee',
                      }}>
                        💧 Water Test
                        {waterTests.length > 0 && (
                          <span style={{ color: '#64748b', fontWeight: 400, marginLeft: 6 }}>
                            ({waterTests.length} recorded)
                          </span>
                        )}
                      </div>
                      {!showWaterTestForm && (
                        <button
                          onClick={() => { setEditingWaterTest(null); setShowWaterTestForm(true) }}
                          style={{
                            padding: '4px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                            background: 'rgba(34,211,238,0.1)', color: '#22d3ee',
                            border: '1px solid rgba(34,211,238,0.25)', cursor: 'pointer',
                          }}
                        >
                          + {waterTests.length > 0 ? 'New Test' : 'Record Test'}
                        </button>
                      )}
                    </div>

                    {showWaterTestForm && (
                      <div style={{ marginBottom: 12 }}>
                        <WaterTestForm
                          leadId={lead.id}
                          testType="initial"
                          existingTest={editingWaterTest}
                          onSaved={handleWaterTestSaved}
                          onCancel={() => { setShowWaterTestForm(false); setEditingWaterTest(null) }}
                        />
                      </div>
                    )}

                    {!showWaterTestForm && waterTests.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <RecommendationSummary tests={waterTests} />
                      </div>
                    )}

                    {!showWaterTestForm && waterTests.length > 0 && (
                      <WaterTestHistory
                        tests={waterTests}
                        onEdit={handleEditWaterTest}
                        onDelete={handleDeleteWaterTest}
                      />
                    )}

                    {!showWaterTestForm && waterTests.length === 0 && (
                      <div style={{
                        background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14,
                        padding: '20px', textAlign: 'center',
                      }}>
                        <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>💧</div>
                        <p style={{ color: '#64748b', fontSize: 12 }}>
                          No water test recorded yet. Record a test during the site visit to get product recommendations.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Quote link */}
                {lead.stage === 'quote_sent' && quoteLink && (
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
                    <div className="text-xs font-bold text-blue-400 uppercase tracking-wide mb-1">
                      📄 Quote Sent — Awaiting Signature
                    </div>
                    <div className="text-xs text-slate-400 mb-3">
                      Share this link. Customer signs quote → agreement auto-generates → payment collected.
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-900/50 rounded-lg px-3 py-2 text-xs text-blue-300 font-mono break-all">
                        {quoteLink}
                      </div>
                      <button
                        onClick={() => { navigator.clipboard.writeText(quoteLink); alert('Copied!') }}
                        className="flex-shrink-0 px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-xs font-semibold rounded-lg transition-colors"
                      >
                        Copy
                      </button>
                    </div>
                    <a
                      href={quoteLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-xs text-blue-500 hover:text-blue-400 underline"
                    >
                      Preview as customer →
                    </a>
                  </div>
                )}

                {lead.stage === 'agreement_signed' && <AgreementSignedPanel lead={lead} onLeadUpdated={handleLeadUpdated} />}

                {/* FEATURE FLAG: Site Survey hidden — re-enable when ready */}
                {false && <SiteSurveyCapture
                  context="lead"
                  opportunityId={lead.id}
                  systemTypeContext={{ opportunityProductType: lead.water_concern || null }}
                  defaultCollapsed={true}
                />}

                {lead.stage === 'lost' && lead.lost_reason && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                    <div className="text-xs text-red-400 font-semibold mb-1">Lost Reason</div>
                    <div className="text-sm text-slate-300">{lead.lost_reason}</div>
                    {lead.lost_at && <div className="text-xs text-muted mt-1">Lost on {formatDate(lead.lost_at)}</div>}
                  </div>
                )}

                {lead.stage === 'future_follow_up' && lead.followup_date && (
                  <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3">
                    <div className="text-xs text-purple-400 font-semibold mb-1">Scheduled Follow-Up</div>
                    <div className="text-sm text-slate-300">
                      {new Date(lead.followup_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                    </div>
                    {lead.followup_notes && <div className="text-xs text-muted mt-1">{lead.followup_notes}</div>}
                  </div>
                )}

                {lead.stage === 'dnd' && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                    <div className="text-xs text-amber-400 font-semibold mb-1">Do Not Disturb</div>
                    <div className="text-sm text-muted">
                      No further contact.{lead.dnd_at && <span> Since {formatDate(lead.dnd_at)}</span>}
                    </div>
                  </div>
                )}

                <InfoRow label="Source" value={LEAD_SOURCE_LABELS[lead.source]} />
                {lead.water_concern && <InfoRow label="Water Concern" value={WATER_CONCERN_LABELS[lead.water_concern]} />}
                {fullAddress && <InfoRow label="Address" value={fullAddress} />}
                {!fullAddress && lead.zip_code && <InfoRow label="ZIP Code" value={lead.zip_code} />}
                <InfoRow label="Days in Stage" value={`${daysInStage} day${daysInStage !== 1 ? 's' : ''}`} />
                <InfoRow label="Created" value={formatDate(lead.created_at)} />

                {/* Assign Rep — read-only for sales reps */}
                <div>
                  <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Assigned Rep</div>
                  {!isSalesRep && can('leads', 'assign_rep') && reps ? (
                    <select
                      value={lead.assigned_rep_id || ''}
                      onChange={e => assignRep({ leadId: lead.id, repId: e.target.value || null })}
                      className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-accent"
                    >
                      <option value="">— Unassigned —</option>
                      {reps.map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
                    </select>
                  ) : (
                    <div className="text-sm text-slate-300">{lead.assigned_rep?.full_name || '— Unassigned —'}</div>
                  )}
                </div>

                {lead.notes && (
                  <div style={{
                    background: lead.stage === 'site_visit_scheduled' ? 'rgba(251,191,36,0.08)' : undefined,
                    border: lead.stage === 'site_visit_scheduled' ? '1px solid rgba(251,191,36,0.3)' : '1px solid #1e3a4f',
                    borderRadius: 12, padding: '10px 14px',
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, color: lead.stage === 'site_visit_scheduled' ? '#fbbf24' : '#64748b' }}>
                      {lead.stage === 'site_visit_scheduled' ? '📝 Office Notes for Rep' : 'Notes'}
                    </div>
                    <div className="text-sm text-slate-300 whitespace-pre-wrap">{lead.notes}</div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'activity' && (
              <ActivityFeed activity={activity || []} isLoading={activityLoading} />
            )}

            {activeTab === 'calls' && (
              <div className="space-y-2">
                {!calls?.length && <p className="text-sm text-muted text-center py-8">No call attempts logged.</p>}
                {calls?.map((c: any) => (
                  <div key={c.id} className="bg-card border border-border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-slate-300 capitalize">{c.outcome?.replace(/_/g, ' ')}</span>
                      <span className="text-xs text-muted">{formatDate(c.attempted_at)}</span>
                    </div>
                    {c.notes && <p className="text-xs text-muted">{c.notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Log Call modal — not available to sales reps */}
          {showCallModal && !isSalesRep && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center p-4 z-20">
              <div className="bg-card border border-border rounded-2xl w-full max-w-sm p-5 shadow-2xl">
                <h3 className="font-bold text-white mb-4">Log Call Attempt</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Outcome</label>
                    <select
                      value={callOutcome}
                      onChange={e => setCallOutcome(e.target.value)}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-accent"
                    >
                      <option value="answered">Answered</option>
                      <option value="voicemail">Voicemail</option>
                      <option value="no_answer">No Answer</option>
                      <option value="callback_scheduled">Callback Scheduled</option>
                      <option value="no_show">🚫 No Show</option>
                      <option value="no_contact_requested">⛔ Requested No Contact</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Notes</label>
                    <textarea
                      value={callNotes}
                      onChange={e => setCallNotes(e.target.value)}
                      placeholder="Brief notes..."
                      rows={3}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent resize-none"
                    />
                  </div>
                </div>
                <div className="flex gap-3 mt-4">
                  <button onClick={() => setShowCallModal(false)} className="flex-1 py-2 text-sm text-muted hover:text-white transition-colors">Cancel</button>
                  <button
                    onClick={handleLogCall}
                    disabled={callPending}
                    className="flex-1 py-2 bg-green hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
                  >
                    {callPending ? 'Saving...' : 'Log Call'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Send Text modal */}
          {showSmsModal && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center p-4 z-20">
              <div className="bg-card border border-border rounded-2xl w-full max-w-sm p-5 shadow-2xl">
                <h3 className="font-bold text-white mb-1">Send Text</h3>
                <p className="text-xs text-muted mb-4">To: {lead.phone}</p>
                <div>
                  {smsTemplates.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Use Template</label>
                      <select
                        defaultValue=""
                        onChange={e => {
                          const t = smsTemplates.find(t => t.id === e.target.value)
                          if (!t) return
                          const firstName = lead.full_name?.split(' ')[0] || lead.full_name || ''
                          setSmsMessage(
                            t.body
                              .replace(/{first_name}/g, firstName)
                              .replace(/{rep_name}/g, profile?.full_name || 'Your Zenith Rep')
                              .replace(/{company}/g, 'Zenith Pure Solutions')
                              .replace(/{review_url}/g, import.meta.env.VITE_GOOGLE_REVIEW_URL || '')
                              .replace(/{visit_date}/g, visitInfo?.date ? new Date(visitInfo.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '')
                              .replace(/{install_date}/g, '')
                          )
                          e.target.value = ''
                        }}
                        className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-accent"
                      >
                        <option value="">— Pick a template —</option>
                        {smsTemplates.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Message</label>
                  <textarea
                    value={smsMessage}
                    onChange={e => setSmsMessage(e.target.value)}
                    placeholder="Type your message..."
                    rows={4}
                    autoFocus
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent resize-none"
                  />
                  <div className="text-right text-xs text-muted mt-1">{smsMessage.length} chars</div>
                </div>
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={() => { setShowSmsModal(false); setSmsMessage('') }}
                    className="flex-1 py-2 text-sm text-muted hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSendLeadSms}
                    disabled={smsSending || !smsMessage.trim()}
                    className="flex-1 py-2 font-semibold rounded-lg text-sm transition-colors disabled:opacity-50"
                    style={{ background: '#22c55e', color: '#fff' }}
                  >
                    {smsSending ? 'Sending…' : 'Send Text 💬'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full-screen QuoteBuilder overlay */}
      {showQuoteBuilder && pendingCustomerId && (
        <div className="fixed inset-0 z-50 bg-surface overflow-y-auto">
          <QuoteBuilder
            customerId={pendingCustomerId}
            customerName={lead.full_name}
            customerAddress={fullAddress}
            customerPhone={lead.phone}
            leadId={lead.id}
            onSaved={handleQuoteSaved}
            onCancel={() => setShowQuoteBuilder(false)}
          />
        </div>
      )}

      {/* Site Visit Scheduler modal */}
      {showVisitScheduler && (
        <SiteVisitScheduler
          leadId={lead.id}
          leadName={lead.full_name}
          leadPhone={lead.phone}
          leadAddress={fullAddress}
          onScheduled={handleVisitScheduled}
          onCancel={() => setShowVisitScheduler(false)}
        />
      )}
    </>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-0.5">{label}</div>
      <div className="text-sm text-slate-300">{value}</div>
    </div>
  )
}
