import { useState, useEffect } from 'react'
import type { Lead } from './leads.types'
import { useTechnicians } from '../dispatch/useJobs'
import { SYSTEM_TYPE_LABELS } from '../dispatch/dispatch.types'
import type { SystemType } from '../dispatch/dispatch.types'
import { createInstallJobFromLead } from '../../services/jobService'
import { moveStage } from '../../services/leadMutations'
import { useAuth } from '../../hooks/useAuth'
import { useQueryClient } from '@tanstack/react-query'
import { JOB_KEYS } from '../dispatch/useJobs'
import { LEAD_KEYS } from './useLeads'
import { supabase } from '../../lib/supabase'

interface Props {
  lead: Lead
  onLeadUpdated?: (lead: Lead) => void
}

function formatCurrency(val: number | null | undefined): string {
  if (!val) return '—'
  return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(str: string | null | undefined): string {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function StatusBadge({ active, activeLabel, inactiveLabel }: {
  active: boolean; activeLabel: string; inactiveLabel: string
}) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
      active ? 'bg-green/20 text-green' : 'bg-muted/20 text-muted'
    }`}>
      {active ? activeLabel : inactiveLabel}
    </span>
  )
}

// Map agreement/product type → system type
function systemTypeFromAgreement(agreementType: string | null, lineItems: any[]): SystemType {
  // Try to detect from line items first (most accurate)
  if (lineItems?.length) {
    const desc = lineItems.map((li: any) =>
      (li.description || li.name || '').toLowerCase()
    ).join(' ')
    if (desc.includes('combo') || (desc.includes('ro') && desc.includes('softener'))) return 'combo_whole_home_ro'
    if (desc.includes('dual tank') || desc.includes('dual_tank')) return 'dual_tank'
    if (desc.includes('advanced') && desc.includes('softener')) return 'advanced_softener'
    if (desc.includes('pure start') || desc.includes('pure_start')) return 'pure_start_softener'
    if (desc.includes('ro') || desc.includes('reverse osmosis')) return 'ro_install'
    if (desc.includes('softener')) return 'softener_only'
  }
  // Fall back to agreement type
  if (agreementType) {
    const t = agreementType.toLowerCase()
    if (t.includes('combo')) return 'combo_whole_home_ro'
    if (t.includes('dual')) return 'dual_tank'
    if (t.includes('advanced')) return 'advanced_softener'
    if (t.includes('pure')) return 'pure_start_softener'
    if (t.includes('ro')) return 'ro_install'
  }
  return 'softener_only'
}

const ALL_SYSTEM_TYPES: SystemType[] = [
  'softener_only', 'pure_start_softener', 'advanced_softener',
  'dual_tank', 'ro_install', 'combo_whole_home_ro',
]

export function AgreementSignedPanel({ lead, onLeadUpdated }: Props) {
  const { user, profile } = useAuth()
  const queryClient = useQueryClient()
  const { data: technicians } = useTechnicians()

  const [showModal, setShowModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loadingAgreement, setLoadingAgreement] = useState(false)

  // Form state
  const [scheduledDate, setScheduledDate] = useState(
    lead.install_preferred_date
      ? new Date(lead.install_preferred_date).toISOString().split('T')[0]
      : ''
  )
  const [techId, setTechId] = useState('')
  const [systemType, setSystemType] = useState<SystemType>('softener_only')
  const [needsFaucetHole, setNeedsFaucetHole] = useState(false)
  const [notes, setNotes] = useState('')
  const [agreementFetched, setAgreementFetched] = useState(false)

  const installPrefLabel: Record<string, string> = {
    asap: 'ASAP', specific_date: 'Specific Date', flexible: 'Flexible',
  }
  const paymentLabel: Record<string, string> = {
    cash: 'Cash', check: 'Check', card: 'Card', financing: 'Financing',
  }

  const jobAlreadyCreated = !!lead.job_created

  // Auto-detect system type from agreement when modal opens
  async function loadAgreementSystemType() {
    if (agreementFetched) return
    setLoadingAgreement(true)
    try {
      const { data: agreement } = await supabase
        .from('agreements')
        .select('agreement_type, line_items_snapshot, commercial_type')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (agreement) {
        const lineItems = agreement.line_items_snapshot
          ? (typeof agreement.line_items_snapshot === 'string'
            ? JSON.parse(agreement.line_items_snapshot)
            : agreement.line_items_snapshot)
          : []
        const detected = systemTypeFromAgreement(
          agreement.agreement_type || agreement.commercial_type || null,
          lineItems
        )
        setSystemType(detected)
        // RO types may need faucet hole
        if (detected === 'ro_install' || detected === 'combo_whole_home_ro') {
          setNeedsFaucetHole(true)
        }
      }
      setAgreementFetched(true)
    } catch (e) {
      console.error('Could not fetch agreement for system type detection:', e)
    } finally {
      setLoadingAgreement(false)
    }
  }

  function handleOpenModal() {
    setShowModal(true)
    loadAgreementSystemType()
  }

  async function handleScheduleInstall() {
    if (!user) return
    setSubmitting(true)
    try {
      // Use the full jobService function — handles checklist + forms generation
      const newJob = await createInstallJobFromLead(
        lead,
        systemType,
        scheduledDate || null,
        needsFaucetHole,
        { actor_id: user.id, actor_name: profile?.full_name }
      )

      // Assign tech if selected (separate step)
      if (techId) {
        await supabase
          .from('jobs')
          .update({
            assigned_technician_id: techId,
            assigned_at: new Date().toISOString(),
          })
          .eq('id', newJob.id)
      }

      // Notes if provided
      if (notes) {
        await supabase.from('jobs').update({ notes }).eq('id', newJob.id)
      }

      // Move lead to won
      const actor = { actor_id: user.id, actor_name: profile?.full_name }
      const updatedLead = await moveStage(lead.id, lead.stage, 'won', actor)

      // Refresh boards
      queryClient.invalidateQueries({ queryKey: JOB_KEYS.board() })
      queryClient.invalidateQueries({ queryKey: LEAD_KEYS.kanban() })
      queryClient.invalidateQueries({ queryKey: LEAD_KEYS.counts })

      onLeadUpdated?.(updatedLead)
      setShowModal(false)
    } catch (err: any) {
      alert('Failed to create job: ' + (err.message || err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="bg-green/5 border border-green/20 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-green text-sm">✅</span>
            <h4 className="text-sm font-bold text-green">Agreement Signed</h4>
          </div>
          {!jobAlreadyCreated ? (
            <button
              onClick={handleOpenModal}
              className="text-xs px-3 py-1.5 bg-cyan/20 hover:bg-cyan/30 text-cyan border border-cyan/30 rounded-lg font-semibold transition-colors"
            >
              📅 Schedule Install
            </button>
          ) : (
            <span className="text-xs px-3 py-1.5 bg-green/20 text-green border border-green/30 rounded-lg font-semibold">
              ✓ Job Created
            </span>
          )}
        </div>

        {/* Quote total */}
        <div className="text-center py-2">
          <div className="text-xs text-muted uppercase tracking-wide">Quote Total</div>
          <div className="text-2xl font-bold text-white mt-0.5">
            {formatCurrency(lead.quote_total)}
          </div>
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-muted">Signed By</div>
            <div className="text-sm text-slate-200">{lead.signed_by || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Signed At</div>
            <div className="text-sm text-slate-200">{formatDate(lead.signed_at)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Payment</div>
            <div className="text-sm text-slate-200">
              {lead.payment_method ? paymentLabel[lead.payment_method] || lead.payment_method : '—'}
              {lead.financing_provider && (
                <span className="text-xs text-muted ml-1">({lead.financing_provider})</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">Deposit</div>
            <div className="text-sm text-slate-200">{formatCurrency(lead.deposit_amount)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Install Pref.</div>
            <div className="text-sm text-slate-200">
              {lead.install_preference
                ? installPrefLabel[lead.install_preference] || lead.install_preference
                : '—'}
              {lead.install_preferred_date && (
                <span className="text-xs text-muted ml-1">
                  ({new Date(lead.install_preferred_date).toLocaleDateString()})
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">Agreement File</div>
            <div className="text-sm">
              {lead.agreement_file_url ? (
                <a href={lead.agreement_file_url} target="_blank" rel="noopener noreferrer"
                  className="text-accent hover:underline">View PDF</a>
              ) : (
                <span className="text-muted">No file</span>
              )}
            </div>
          </div>
        </div>

        {/* Status flags */}
        <div className="flex items-center gap-2 pt-2 border-t border-green/10">
          <StatusBadge active={!!lead.job_created} activeLabel="Job Created" inactiveLabel="Job Pending" />
          <StatusBadge active={!!lead.inventory_reserved} activeLabel="Inventory Reserved" inactiveLabel="Not Reserved" />
        </div>
      </div>

      {/* ── Schedule Install Modal ──────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="font-bold text-white text-base mb-1">Schedule Install</h3>
            <p className="text-xs text-muted mb-5">
              Creates a job on the Dispatch board with checklist + forms, then moves lead to Won.
            </p>

            {loadingAgreement && (
              <div className="text-xs text-accent animate-pulse mb-4">Detecting system type from agreement…</div>
            )}

            <div className="space-y-4">

              {/* System type — auto-detected, can override */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                  System Type <span className="text-red-400">*</span>
                  <span className="ml-2 text-accent font-normal normal-case">auto-detected from agreement</span>
                </label>
                <select
                  value={systemType}
                  onChange={e => setSystemType(e.target.value as SystemType)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-accent"
                >
                  {ALL_SYSTEM_TYPES.map(t => (
                    <option key={t} value={t}>{SYSTEM_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>

              {/* RO faucet hole */}
              {(systemType === 'ro_install' || systemType === 'combo_whole_home_ro') && (
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="faucet_hole"
                    checked={needsFaucetHole}
                    onChange={e => setNeedsFaucetHole(e.target.checked)}
                    className="w-4 h-4 accent-cyan"
                  />
                  <label htmlFor="faucet_hole" className="text-sm text-slate-300 cursor-pointer">
                    Requires new faucet hole (adds drilling consent form)
                  </label>
                </div>
              )}

              {/* Install date */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                  Install Date
                  {lead.install_preferred_date && (
                    <span className="ml-2 text-accent font-normal normal-case">
                      Customer requested: {new Date(lead.install_preferred_date).toLocaleDateString()}
                    </span>
                  )}
                </label>
                <input
                  type="date"
                  value={scheduledDate}
                  onChange={e => setScheduledDate(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-accent"
                />
              </div>

              {/* Assign tech */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                  Assign Technician
                </label>
                <select
                  value={techId}
                  onChange={e => setTechId(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-accent"
                >
                  <option value="">— Unassigned —</option>
                  {technicians?.map((t: any) => (
                    <option key={t.id} value={t.id}>{t.full_name}</option>
                  ))}
                </select>
                {!techId && (
                  <div className="text-xs text-amber mt-1">
                    ⚠ Tech required to Start Installation on the dispatch board
                  </div>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                  Notes for Tech
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Any install notes…"
                  rows={2}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent resize-none"
                />
              </div>

              {/* Customer summary */}
              <div className="bg-surface rounded-lg p-3 text-xs text-muted space-y-1">
                <div><span className="text-slate-400 font-semibold">Customer: </span>{lead.full_name}</div>
                <div><span className="text-slate-400 font-semibold">Address: </span>
                  {[lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ') || '—'}
                </div>
                <div><span className="text-slate-400 font-semibold">Phone: </span>{lead.phone}</div>
                {lead.quote_total && (
                  <div><span className="text-slate-400 font-semibold">Quote: </span>{formatCurrency(lead.quote_total)}</div>
                )}
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowModal(false)}
                disabled={submitting}
                className="flex-1 py-2.5 text-sm text-muted hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleScheduleInstall}
                disabled={submitting}
                className="flex-1 py-2.5 bg-cyan hover:bg-cyan/80 disabled:opacity-50 text-white font-bold rounded-lg text-sm transition-colors"
              >
                {submitting ? 'Creating Job…' : '📅 Create Job & Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
