import { useState } from 'react'
import type { Lead } from './leads.types'
import type { LeadStage } from '../../types/domain.types'
import { useAuth } from '../../hooks/useAuth'
import {
  moveStage,
  markLost,
  scheduleFollowUp,
  markDND,
  signAgreement,
  reopenFromLost,
  reopenFromDND,
  reopenFromFollowUp,
} from '../../services/leadMutations'
import type { AgreementData } from '../../services/leadMutations'
import { LostReasonModal } from './modals/LostReasonModal'
import { FollowUpModal } from './modals/FollowUpModal'
import { AgreementModal } from './modals/AgreementModal'
import { InstallJobModal } from './modals/InstallJobModal'
import { ConfirmDialog } from './modals/ConfirmDialog'

// ── Contact Gate Configuration ─────────────────────────────────
const REQUIRED_CONTACT_ATTEMPTS = 5
// Stages where the contact gate applies (Lost/DND locked until 5 attempts)
const CONTACT_GATED_STAGES: LeadStage[] = [
  'new_lead', 'qualifying', 'qualified', 'site_visit_scheduled',
  'proposal_in_progress', 'quote_sent', 'future_follow_up',
]

interface ActionDef {
  label: string
  action: string
  variant: 'primary' | 'success' | 'danger' | 'warning' | 'secondary'
  modal?: 'lost' | 'followup' | 'agreement' | 'install_job' | 'confirm_dnd' | 'confirm_reopen'
  targetStage?: LeadStage
  disabled?: (lead: Lead) => boolean
  disabledLabel?: string
  /** If true, only admin/frontdesk can see this action — sales reps cannot */
  adminOnly?: boolean
  /** If true, this action is gated by the 5-step contact requirement */
  contactGated?: boolean
}

const STAGE_ACTIONS: Partial<Record<LeadStage, ActionDef[]>> = {
  new_lead: [
    { label: 'Mark Qualifying', action: 'move', variant: 'primary', targetStage: 'qualifying', adminOnly: true },
    { label: 'Lost', action: 'lost', variant: 'danger', modal: 'lost', adminOnly: true, contactGated: true },
    { label: 'DND', action: 'dnd', variant: 'warning', modal: 'confirm_dnd', adminOnly: true, contactGated: true },
  ],
  qualifying: [
    { label: 'Mark Qualified', action: 'move', variant: 'primary', targetStage: 'qualified', adminOnly: true },
    { label: 'Lost', action: 'lost', variant: 'danger', modal: 'lost', adminOnly: true, contactGated: true },
    { label: 'Follow-Up', action: 'followup', variant: 'secondary', modal: 'followup' },
    { label: 'DND', action: 'dnd', variant: 'warning', modal: 'confirm_dnd', adminOnly: true, contactGated: true },
  ],
  qualified: [
    { label: '📅 Schedule Visit', action: 'schedule_visit', variant: 'primary', adminOnly: true },
    { label: 'Lost', action: 'lost', variant: 'danger', modal: 'lost', adminOnly: true, contactGated: true },
    { label: 'Follow-Up', action: 'followup', variant: 'secondary', modal: 'followup' },
    { label: 'DND', action: 'dnd', variant: 'warning', modal: 'confirm_dnd', adminOnly: true, contactGated: true },
  ],
  site_visit_scheduled: [
    { label: '📄 Build Quote', action: 'create_quote', variant: 'primary' },
    { label: 'Lost', action: 'lost', variant: 'danger', modal: 'lost', adminOnly: true, contactGated: true },
    { label: 'Follow-Up', action: 'followup', variant: 'secondary', modal: 'followup' },
    { label: 'DND', action: 'dnd', variant: 'warning', modal: 'confirm_dnd', adminOnly: true, contactGated: true },
  ],
  proposal_in_progress: [
    { label: '📄 Build & Send Quote', action: 'create_quote', variant: 'success' },
    { label: 'Lost', action: 'lost', variant: 'danger', modal: 'lost', adminOnly: true, contactGated: true },
    { label: 'Follow-Up', action: 'followup', variant: 'secondary', modal: 'followup' },
  ],
  quote_sent: [
    { label: 'Mark Signed (Manual)', action: 'agreement', variant: 'success', modal: 'agreement', adminOnly: true },
    { label: 'Lost', action: 'lost', variant: 'danger', modal: 'lost', adminOnly: true, contactGated: true },
    { label: 'Follow-Up', action: 'followup', variant: 'secondary', modal: 'followup' },
  ],
  agreement_signed: [
    { label: 'Lost', action: 'lost', variant: 'danger', modal: 'lost', adminOnly: true },
  ],
  lost: [
    { label: 'Reopen as New Lead', action: 'reopen_lost', variant: 'secondary', modal: 'confirm_reopen', adminOnly: true },
  ],
  dnd: [
    { label: 'Reopen as New Lead', action: 'reopen_dnd', variant: 'secondary', modal: 'confirm_reopen', adminOnly: true },
  ],
  future_follow_up: [
    { label: 'Reopen as Qualifying', action: 'reopen_followup', variant: 'primary', modal: 'confirm_reopen', adminOnly: true },
    { label: 'Lost', action: 'lost', variant: 'danger', modal: 'lost', adminOnly: true, contactGated: true },
    { label: 'Follow-Up', action: 'followup', variant: 'secondary', modal: 'followup' },
    { label: 'DND', action: 'dnd', variant: 'warning', modal: 'confirm_dnd', adminOnly: true, contactGated: true },
  ],
}

const VARIANT_STYLES: Record<string, { bg: string; color: string; border: string; hoverBg: string }> = {
  primary:   { bg: 'rgba(96,165,250,0.15)',  color: '#60a5fa', border: 'rgba(96,165,250,0.3)',  hoverBg: 'rgba(96,165,250,0.25)'  },
  success:   { bg: 'rgba(74,222,128,0.15)',  color: '#4ade80', border: 'rgba(74,222,128,0.3)',  hoverBg: 'rgba(74,222,128,0.25)'  },
  danger:    { bg: 'rgba(239,68,68,0.15)',   color: '#f87171', border: 'rgba(239,68,68,0.3)',   hoverBg: 'rgba(239,68,68,0.25)'   },
  warning:   { bg: 'rgba(245,158,11,0.15)',  color: '#fbbf24', border: 'rgba(245,158,11,0.3)',  hoverBg: 'rgba(245,158,11,0.25)'  },
  secondary: { bg: 'rgba(100,116,139,0.15)', color: '#cbd5e1', border: 'rgba(100,116,139,0.3)', hoverBg: 'rgba(100,116,139,0.25)' },
}

interface Props {
  lead: Lead
  onLeadUpdated: (lead: Lead) => void
  onCreateQuote?: () => void
  qualifyingComplete?: boolean
  onScheduleVisit?: () => void
  siteVisitComplete?: boolean
  /** Number of call attempts logged for this lead — gates Lost/DND buttons */
  callAttemptCount?: number
}

export function StageActionBar({ lead, onLeadUpdated, onCreateQuote, qualifyingComplete, onScheduleVisit, siteVisitComplete, callAttemptCount = 0 }: Props) {
  const { user, profile, role } = useAuth()
  const [activeModal, setActiveModal] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [error, setError] = useState('')

  const isSalesRep = role === 'salesrep'

  const allActions = STAGE_ACTIONS[lead.stage] || []

  // Sales reps only see actions that are NOT adminOnly
  const actions = isSalesRep
    ? allActions.filter(a => !a.adminOnly)
    : allActions

  // Contact gate: is this stage gated, and are we below the threshold?
  const isGatedStage = CONTACT_GATED_STAGES.includes(lead.stage)
  const attemptsRemaining = Math.max(0, REQUIRED_CONTACT_ATTEMPTS - callAttemptCount)
  const contactGateActive = isGatedStage && attemptsRemaining > 0

  if (!user) return null

  // If sales rep has no actions for this stage, show read-only notice
  if (isSalesRep && actions.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.2)' }}>
        <span className="text-xs" style={{ color: '#94a3b8' }}>👁 View only — stage actions managed by admin</span>
      </div>
    )
  }

  const actor = { actor_id: user.id, actor_name: profile?.full_name }

  async function handleAction(actionDef: ActionDef) {
    setError('')

    // Block contact-gated actions when gate is active
    if (actionDef.contactGated && contactGateActive) {
      setError(`Log ${attemptsRemaining} more call attempt${attemptsRemaining !== 1 ? 's' : ''} before marking this lead as ${actionDef.action === 'lost' ? 'Lost' : 'DND'}.`)
      return
    }

    if (actionDef.action === 'create_quote') {
      if (lead.stage === 'site_visit_scheduled' && !siteVisitComplete) {
        setError('Complete all required site visit checklist items before building a quote.')
        return
      }
      onCreateQuote?.()
      return
    }

    if (actionDef.action === 'schedule_visit') {
      onScheduleVisit?.()
      return
    }

    if (actionDef.modal) {
      setActiveModal(actionDef.modal)
      return
    }

    if (actionDef.action === 'move' && actionDef.targetStage) {
      if (lead.stage === 'qualifying' && actionDef.targetStage === 'qualified' && !qualifyingComplete) {
        setError('Complete all required qualifying questions before moving to Qualified.')
        return
      }
      setPendingAction(actionDef.action)
      try {
        const updated = await moveStage(lead.id, lead.stage, actionDef.targetStage, actor)
        onLeadUpdated(updated)
      } catch (e: any) {
        setError(e.message)
      } finally {
        setPendingAction(null)
      }
    }
  }

  async function handleLost(reason: string) {
    setPendingAction('lost')
    try {
      const updated = await markLost(lead.id, lead.stage, actor, reason)
      onLeadUpdated(updated); setActiveModal(null)
    } catch (e: any) { setError(e.message) }
    finally { setPendingAction(null) }
  }

  async function handleFollowUp(date: string, notes?: string) {
    setPendingAction('followup')
    try {
      const updated = await scheduleFollowUp(lead.id, lead.stage, actor, date, notes)
      onLeadUpdated(updated); setActiveModal(null)
    } catch (e: any) { setError(e.message) }
    finally { setPendingAction(null) }
  }

  async function handleDND() {
    setPendingAction('dnd')
    try {
      const updated = await markDND(lead.id, lead.stage, actor)
      onLeadUpdated(updated); setActiveModal(null)
    } catch (e: any) { setError(e.message) }
    finally { setPendingAction(null) }
  }

  async function handleAgreement(data: AgreementData) {
    setPendingAction('agreement')
    try {
      const updated = await signAgreement(lead.id, lead.stage, actor, data)
      onLeadUpdated(updated); setActiveModal(null)
    } catch (e: any) { setError(e.message) }
    finally { setPendingAction(null) }
  }

  async function handleReopen() {
    setPendingAction('reopen')
    try {
      let updated: Lead
      if (lead.stage === 'lost')       updated = await reopenFromLost(lead.id, lead, actor)
      else if (lead.stage === 'dnd')   updated = await reopenFromDND(lead.id, actor)
      else                             updated = await reopenFromFollowUp(lead.id, lead, actor)
      onLeadUpdated(updated); setActiveModal(null)
    } catch (e: any) { setError(e.message) }
    finally { setPendingAction(null) }
  }

  return (
    <>
      {/* Qualifying checklist warning */}
      {lead.stage === 'qualifying' && !qualifyingComplete && !isSalesRep && (
        <div className="flex items-start gap-2 rounded-xl px-4 py-3" style={{ backgroundColor: '#854d0e', border: '2px solid #eab308' }}>
          <span className="text-lg leading-none">⚠️</span>
          <div>
            <div className="text-sm font-bold" style={{ color: '#fde047' }}>Checklist Incomplete</div>
            <div className="text-xs mt-0.5" style={{ color: '#fef08a' }}>Answer all required questions below before moving to Qualified.</div>
          </div>
        </div>
      )}

      {/* Site visit checklist warning */}
      {lead.stage === 'site_visit_scheduled' && !siteVisitComplete && (
        <div className="flex items-start gap-2 rounded-xl px-4 py-3" style={{ backgroundColor: '#581c87', border: '2px solid #a855f7' }}>
          <span className="text-lg leading-none">📋</span>
          <div>
            <div className="text-sm font-bold" style={{ color: '#d8b4fe' }}>Site Visit Checklist Incomplete</div>
            <div className="text-xs mt-0.5" style={{ color: '#e9d5ff' }}>Complete all required items below before building a quote.</div>
          </div>
        </div>
      )}

      {/* ── Contact Gate Step Counter ────────────────────────────── */}
      {contactGateActive && !isSalesRep && (
        <div className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ backgroundColor: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.25)' }}>
          <div className="flex items-center gap-1.5">
            {Array.from({ length: REQUIRED_CONTACT_ATTEMPTS }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  backgroundColor: i < callAttemptCount ? '#22d3ee' : 'rgba(100,116,139,0.3)',
                  transition: 'background-color 0.2s',
                }}
              />
            ))}
          </div>
          <div>
            <span className="text-xs font-bold" style={{ color: '#22d3ee' }}>
              📞 STEP {Math.min(callAttemptCount + 1, REQUIRED_CONTACT_ATTEMPTS)} OF {REQUIRED_CONTACT_ATTEMPTS}
            </span>
            <span className="text-xs ml-2" style={{ color: '#94a3b8' }}>
              {attemptsRemaining} more call{attemptsRemaining !== 1 ? 's' : ''} before Lost/DND unlocks
            </span>
          </div>
        </div>
      )}

      {/* Gate complete indicator */}
      {isGatedStage && !contactGateActive && callAttemptCount > 0 && !isSalesRep && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ backgroundColor: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)' }}>
          <span className="text-xs font-semibold" style={{ color: '#4ade80' }}>
            ✓ {callAttemptCount} call{callAttemptCount !== 1 ? 's' : ''} logged — all actions unlocked
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {actions.map((actionDef) => {
          const isDisabled = actionDef.disabled?.(lead)
          const isContactLocked = actionDef.contactGated && contactGateActive
          const vs = VARIANT_STYLES[actionDef.variant] || VARIANT_STYLES.secondary
          return (
            <button
              key={actionDef.action + (actionDef.targetStage || '')}
              onClick={() => !isDisabled && !isContactLocked && handleAction(actionDef)}
              disabled={!!pendingAction || isDisabled || isContactLocked}
              title={isContactLocked ? `Log ${attemptsRemaining} more call attempt${attemptsRemaining !== 1 ? 's' : ''} to unlock` : undefined}
              style={{
                backgroundColor: isDisabled ? 'rgba(74,222,128,0.1)' : isContactLocked ? 'rgba(100,116,139,0.08)' : vs.bg,
                color: isDisabled ? 'rgba(74,222,128,0.6)' : isContactLocked ? 'rgba(100,116,139,0.5)' : vs.color,
                border: `1px solid ${isDisabled ? 'rgba(74,222,128,0.2)' : isContactLocked ? 'rgba(100,116,139,0.2)' : vs.border}`,
              }}
              className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors ${pendingAction || isContactLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isContactLocked ? `🔒 ${actionDef.label}` : isDisabled ? actionDef.disabledLabel : actionDef.label}
            </button>
          )
        })}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl px-4 py-3 mt-2" style={{ backgroundColor: '#dc2626', border: '2px solid #f87171' }}>
          <span className="text-lg leading-none">🚫</span>
          <div className="text-sm font-bold text-white">{error}</div>
        </div>
      )}

      {activeModal === 'lost' && (
        <LostReasonModal onSubmit={handleLost} onCancel={() => setActiveModal(null)} isPending={pendingAction === 'lost'} />
      )}
      {activeModal === 'followup' && (
        <FollowUpModal onSubmit={handleFollowUp} onCancel={() => setActiveModal(null)} isPending={pendingAction === 'followup'} />
      )}
      {activeModal === 'agreement' && (
        <AgreementModal onSubmit={handleAgreement} onCancel={() => setActiveModal(null)} isPending={pendingAction === 'agreement'} />
      )}
      {activeModal === 'install_job' && (
        <InstallJobModal
          lead={lead}
          onSubmit={(updatedLead) => { onLeadUpdated(updatedLead); setActiveModal(null) }}
          onCancel={() => setActiveModal(null)}
          actor={actor}
        />
      )}
      {activeModal === 'confirm_dnd' && (
        <ConfirmDialog
          title="Mark as Do Not Disturb"
          message="This lead will be moved to DND. No further contact will be made. Continue?"
          confirmLabel="Mark DND" confirmVariant="warning"
          onConfirm={handleDND} onCancel={() => setActiveModal(null)} isPending={pendingAction === 'dnd'}
        />
      )}
      {activeModal === 'confirm_reopen' && (
        <ConfirmDialog
          title="Reopen Lead"
          message={
            lead.stage === 'lost' ? 'This will reopen the lead as New Lead and clear the lost reason.'
            : lead.stage === 'dnd' ? 'This will reopen the lead as New Lead and remove the DND status.'
            : 'This will reopen the lead as Qualifying and clear the follow-up schedule.'
          }
          confirmLabel="Reopen" confirmVariant="primary"
          onConfirm={handleReopen} onCancel={() => setActiveModal(null)} isPending={pendingAction === 'reopen'}
        />
      )}
    </>
  )
}
