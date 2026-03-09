import { useState, useCallback } from 'react'
import type { Lead } from './leads.types'
import { useAssignRep, useLogCallAttempt, useCallAttempts, useReps, useNewLeadActivity } from './useLeads'
import { useAuth } from '../../hooks/useAuth'
import { usePermission } from '../../hooks/usePermission'
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
import { LEAD_KEYS } from './useLeads'

interface Props {
  lead: Lead
  onClose: () => void
  onLeadUpdated?: (lead: Lead) => void
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

export function LeadDetailPanel({ lead: initialLead, onClose, onLeadUpdated }: Props) {
  const { role } = useAuth()
  const { can } = usePermission(role)
  const queryClient = useQueryClient()

  const [lead, setLead] = useState<Lead>(initialLead)
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [showCallModal, setShowCallModal] = useState(false)
  const [callOutcome, setCallOutcome] = useState('answered')
  const [callNotes, setCallNotes] = useState('')

  const { mutateAsync: assignRep } = useAssignRep()
  const { mutateAsync: logCall, isPending: callPending } = useLogCallAttempt()
  const { data: activity, isLoading: activityLoading } = useNewLeadActivity(lead.id)
  const { data: calls } = useCallAttempts(lead.id)
  const { data: reps } = useReps()

  // ── Handle lead updates from StageActionBar ──────────────
  const handleLeadUpdated = useCallback((updated: Lead) => {
    setLead(updated)
    onLeadUpdated?.(updated)
    // Invalidate queries to refresh pipeline
    queryClient.invalidateQueries({ queryKey: LEAD_KEYS.kanban() })
    queryClient.invalidateQueries({ queryKey: LEAD_KEYS.counts })
    queryClient.invalidateQueries({ queryKey: LEAD_KEYS.activity(updated.id) })
    queryClient.invalidateQueries({ queryKey: ['lead_activity_log', updated.id] })
  }, [onLeadUpdated, queryClient])

  async function handleLogCall() {
    try {
      await logCall({ leadId: lead.id, outcome: callOutcome, notes: callNotes })
      setShowCallModal(false)
      setCallNotes('')
    } catch (e) {
      console.error(e)
    }
  }

  const stageEnteredAt = lead.stage_entered_at || lead.stage_changed_at
  const daysInStage = daysSince(stageEnteredAt)

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
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
          <button onClick={onClose} className="text-muted hover:text-white text-xl leading-none">✕</button>
        </div>

        {/* Stage badge + Action buttons */}
        <div className="px-5 py-3 border-b border-border flex-shrink-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`stage-badge border ${LEAD_STAGE_COLORS[lead.stage]}`}>
              {LEAD_STAGE_LABELS[lead.stage]}
            </div>
            <button
              onClick={() => setShowCallModal(true)}
              className="text-xs px-2.5 py-1 bg-green/10 text-green border border-green/30 rounded-lg hover:bg-green/20 transition-colors"
            >
              📞 Log Call
            </button>
          </div>

          {/* Stage Action Buttons */}
          <StageActionBar lead={lead} onLeadUpdated={handleLeadUpdated} />
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border flex-shrink-0">
          {(['overview', 'activity', 'calls'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                activeTab === tab
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-muted hover:text-slate-300'
              }`}
            >
              {tab}
              {tab === 'calls' && calls && calls.length > 0 && (
                <span className="ml-1 bg-muted/30 rounded-full px-1.5 py-0.5 text-xs">
                  {calls.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {/* Agreement panel when in agreement_signed stage */}
              {lead.stage === 'agreement_signed' && (
                <AgreementSignedPanel lead={lead} />
              )}

              {/* Site Survey */}
              <SiteSurveyCapture
                context="lead"
                opportunityId={lead.id}
                systemTypeContext={{
                  opportunityProductType: lead.water_concern || null,
                }}
                defaultCollapsed={true}
              />

              {/* Lost reason display */}
              {lead.stage === 'lost' && lead.lost_reason && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                  <div className="text-xs text-red-400 font-semibold mb-1">Lost Reason</div>
                  <div className="text-sm text-slate-300">{lead.lost_reason}</div>
                  {lead.lost_at && (
                    <div className="text-xs text-muted mt-1">Lost on {formatDate(lead.lost_at)}</div>
                  )}
                </div>
              )}

              {/* Follow-up display */}
              {lead.stage === 'future_follow_up' && lead.followup_date && (
                <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3">
                  <div className="text-xs text-purple-400 font-semibold mb-1">Scheduled Follow-Up</div>
                  <div className="text-sm text-slate-300">
                    {new Date(lead.followup_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </div>
                  {lead.followup_notes && (
                    <div className="text-xs text-muted mt-1">{lead.followup_notes}</div>
                  )}
                </div>
              )}

              {/* DND display */}
              {lead.stage === 'dnd' && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                  <div className="text-xs text-amber-400 font-semibold mb-1">Do Not Disturb</div>
                  <div className="text-sm text-muted">
                    No further contact.
                    {lead.dnd_at && <span> Since {formatDate(lead.dnd_at)}</span>}
                  </div>
                </div>
              )}

              <InfoRow label="Source" value={LEAD_SOURCE_LABELS[lead.source]} />
              {lead.water_concern && (
                <InfoRow label="Water Concern" value={WATER_CONCERN_LABELS[lead.water_concern]} />
              )}
              {lead.zip_code && <InfoRow label="ZIP Code" value={lead.zip_code} />}
              {lead.address && (
                <InfoRow
                  label="Address"
                  value={[lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ')}
                />
              )}
              <InfoRow label="Days in Stage" value={`${daysInStage} day${daysInStage !== 1 ? 's' : ''}`} />
              <InfoRow label="Created" value={formatDate(lead.created_at)} />

              {/* Assigned rep */}
              <div>
                <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Assigned Rep</div>
                {can('leads', 'assign_rep') && reps ? (
                  <select
                    value={lead.assigned_rep_id || ''}
                    onChange={e => assignRep({ leadId: lead.id, repId: e.target.value || null })}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-accent"
                  >
                    <option value="">— Unassigned —</option>
                    {reps.map(r => (
                      <option key={r.id} value={r.id}>{r.full_name}</option>
                    ))}
                  </select>
                ) : (
                  <div className="text-sm text-slate-300">
                    {lead.assigned_rep?.full_name || '— Unassigned —'}
                  </div>
                )}
              </div>

              {lead.notes && (
                <div>
                  <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Notes</div>
                  <div className="text-sm text-slate-300 bg-card border border-border rounded-lg p-3 whitespace-pre-wrap">
                    {lead.notes}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ACTIVITY (new structured feed) */}
          {activeTab === 'activity' && (
            <ActivityFeed
              activity={activity || []}
              isLoading={activityLoading}
            />
          )}

          {/* CALLS */}
          {activeTab === 'calls' && (
            <div className="space-y-2">
              {!calls?.length && (
                <p className="text-sm text-muted text-center py-8">No call attempts logged.</p>
              )}
              {calls?.map((c: any) => (
                <div key={c.id} className="bg-card border border-border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-slate-300 capitalize">
                      {c.outcome?.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs text-muted">{formatDate(c.attempted_at)}</span>
                  </div>
                  {c.notes && <p className="text-xs text-muted">{c.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Log Call Modal */}
        {showCallModal && (
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
      </div>
    </div>
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
