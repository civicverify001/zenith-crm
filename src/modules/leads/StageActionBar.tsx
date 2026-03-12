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

interface ActionDef {
  label: string
  action: string
  variant: 'primary' | 'success' | 'danger' | 'warning' | 'secondary'
  modal?: 'lost' | 'followup' | 'agreement' | 'install_job' | 'confirm_dnd' | 'confirm_reopen'
  targetStage?: LeadStage
  disabled?: (lead: Lead) => boolean
  disabledLabel?: string
}

const STAGE_ACTIONS: Partial<Record<LeadStage, ActionDef[]>> = {
  new_lead: [
    { label: 'Mark Qualifying', action: 'move', variant: 'primary', targetStage: 'qualifying' },
    { label: 'Lost', action: 'lost', variant: 'danger', modal: 'lost' },
    { label: 'DND', action: 'dnd', variant: 'warning', modal: 'confirm_dnd' },
  ],
  qualifying: [
    { label: 'Mark Qualified', action: 'move', variant: 'primary', targetStage: 'qualified' },
    { label: 'Lost', action: 'lost', variant: 'danger', modal: 'lost' },
    { label: 'Follow-Up', action: 'followup', variant: 'secondary', modal: 'followup' },
    { label: 'DND', action: 'dnd', variant: 'warning', modal: 'confirm_dnd' },
  ],
  qualified: [
    { label: 'Schedule Visit', action: 'move', variant: 'primary', targetStage: 'site_visit_scheduled' },
    { label: 'Lost', action: 'lost', variant: 'danger', modal: 'lost' },
    { label: 'Follow-Up', action: 'followup', variant: 'secondary', modal: 'followup' },
    { label: 'DND', action: 'dnd', variant: 'warning', modal: 'confirm_dnd' },
  ],
  site_visit_scheduled: [
    // ← Opens QuoteBuilder (no stage move — stage moves when quote is actually sent)
    { label: '📄 Build Quote', action: 'create_quote', variant: 'primary' },
    { label: 'Lost', action: 'lost', variant: 'danger', modal: 'lost' },
    { label: 'Follow-Up', action: 'followup', variant: 'secondary', modal: 'followup' },
    { label: 'DND', action: 'dnd', variant: 'warning', modal: 'confirm_dnd' },
  ],
  proposal_in_progress: [
    // ← Also opens QuoteBuilder so rep can continue building/send
    { label: '📄 Build & Send Quote', action: 'create_quote', variant: 'success' },
    { label: 'Lost', action: 'lost', variant: 'danger', modal: 'lost' },
    { label: 'Follow-Up', action: 'followup', variant: 'secondary', modal: 'followup' },
  ],
  quote_sent: [
    // ← Only fallback if customer signed on paper; normal flow is via /q/:token
    { label: 'Mark Signed (Manual)', action: 'agreement', variant: 'success', modal: 'agreement' },
    { label: 'Lost', action: 'lost', variant: 'danger', modal: 'lost' },
    { label: 'Follow-Up', action: 'followup', variant: 'secondary', modal: 'followup' },
  ],
  // REPLACE WITH:
agreement_signed: [
    { label: 'Lost', action: 'lost', variant: 'danger', modal: 'lost' },
  ],
  lost: [
    { label: 'Reopen as New Lead', action: 'reopen_lost', variant: 'secondary', modal: 'confirm_reopen' },
  ],
  dnd: [
    { label: 'Reopen as New Lead', action: 'reopen_dnd', variant: 'secondary', modal: 'confirm_reopen' },
  ],
  future_follow_up: [
    { label: 'Reopen as Qualifying', action: 'reopen_followup', variant: 'primary', modal: 'confirm_reopen' },
    { label: 'Lost', action: 'lost', variant: 'danger', modal: 'lost' },
    { label: 'DND', action: 'dnd', variant: 'warning', modal: 'confirm_dnd' },
  ],
}

const VARIANT_CLASSES: Record<string, string> = {
  primary:   'bg-accent/15 text-accent border-accent/30 hover:bg-accent/25',
  success:   'bg-green/15 text-green border-green/30 hover:bg-green/25',
  danger:    'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25',
  warning:   'bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/25',
  secondary: 'bg-border text-slate-300 border-border hover:bg-muted/30',
}

interface Props {
  lead: Lead
  onLeadUpdated: (lead: Lead) => void
  /** Called when rep clicks "Build Quote" — parent handles opening QuoteBuilder */
  onCreateQuote?: () => void
  /** Whether all required qualifying questions are answered */
  qualifyingComplete?: boolean
}

export function StageActionBar({ lead, onLeadUpdated, onCreateQuote, qualifyingComplete }: Props) {
  const { user, profile } = useAuth()
  const [activeModal, setActiveModal] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [error, setError] = useState('')

  const actions = STAGE_ACTIONS[lead.stage] || []
  if (actions.length === 0) return null
  if (!user) return null

  const actor = { actor_id: user.id, actor_name: profile?.full_name }

  async function handleAction(actionDef: ActionDef) {
    setError('')

    // Hand off to parent for quote creation
    if (actionDef.action === 'create_quote') {
      onCreateQuote?.()
      return
    }

    // Open a modal
    if (actionDef.modal) {
      setActiveModal(actionDef.modal)
      return
    }

    // Direct stage move (no modal)
    if (actionDef.action === 'move' && actionDef.targetStage) {
      // Gate: qualifying → qualified requires all required checklist questions answered
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
      if (lead.stage === 'lost')             updated = await reopenFromLost(lead.id, lead, actor)
      else if (lead.stage === 'dnd')         updated = await reopenFromDND(lead.id, actor)
      else                                   updated = await reopenFromFollowUp(lead.id, lead, actor)
      onLeadUpdated(updated); setActiveModal(null)
    } catch (e: any) { setError(e.message) }
    finally { setPendingAction(null) }
  }

  return (
    <>
      {/* Persistent warning when qualifying checklist is incomplete */}
      {lead.stage === 'qualifying' && !qualifyingComplete && (
        <div className="flex items-start gap-2 bg-yellow-500/20 border-2 border-yellow-500/60 rounded-xl px-4 py-3">
          <span className="text-lg leading-none">⚠️</span>
          <div>
            <div className="text-sm font-bold text-yellow-300">Checklist Incomplete</div>
            <div className="text-xs text-yellow-200 mt-0.5">Answer all required questions below before moving to Qualified.</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {actions.map((actionDef) => {
          const isDisabled = actionDef.disabled?.(lead)
          return (
            <button
              key={actionDef.action + (actionDef.targetStage || '')}
              onClick={() => !isDisabled && handleAction(actionDef)}
              disabled={!!pendingAction || isDisabled}
              className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${
                isDisabled
                  ? 'bg-green/10 text-green/60 border-green/20 cursor-default'
                  : VARIANT_CLASSES[actionDef.variant]
              } ${pendingAction ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isDisabled ? actionDef.disabledLabel : actionDef.label}
            </button>
          )
        })}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-600 border-2 border-red-400 rounded-xl px-4 py-3 mt-2">
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

