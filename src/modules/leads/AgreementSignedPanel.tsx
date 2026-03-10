import { useState } from 'react'
import type { Lead } from './leads.types'
import { useTechnicians } from '../dispatch/useJobs'
import { SYSTEM_TYPE_LABELS } from '../dispatch/dispatch.types'
import type { SystemType, JobType } from '../dispatch/dispatch.types'
import { supabase } from '../../lib/supabase'
import { moveStage } from '../../services/leadMutations'
import { useAuth } from '../../hooks/useAuth'
import { useQueryClient } from '@tanstack/react-query'
import { JOB_KEYS } from '../dispatch/useJobs'
import { LEAD_KEYS } from './useLeads'

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

// Map water concern → sensible default system type
function defaultSystemType(waterConcern: string | null | undefined): SystemType {
  if (!waterConcern) return 'softener_only'
  if (waterConcern.includes('iron') || waterConcern.includes('rust')) return 'advanced_softener'
  if (waterConcern.includes('ro') || waterConcern.includes('drinking')) return 'ro_install'
  if (waterConcern.includes('combo') || waterConcern.includes('whole')) return 'combo_whole_home_ro'
  return 'softener_only'
}

const ALL_SYSTEM_TYPES: SystemType[] = [
  'softener_only', 'pure_start_softener', 'advanced_softener',
  'dual_tank', 'ro_install', 'combo_whole_home_ro',
]

const JOB_TYPE_LABELS: Record<JobType, string> = {
  standard_install: 'Standard Install',
  service: 'Service',
  warranty: 'Warranty',
  filter_change: 'Filter Change',
  rental_setup: 'Rental Setup',
}

export function AgreementSignedPanel({ lead, onLeadUpdated }: Props) {
  const { user, profile } = useAuth()
  const queryClient = useQueryClient()
  const { data: technicians } = useTechnicians()

  const [showModal, setShowModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [scheduledDate, setScheduledDate] = useState('')
  const [techId, setTechId] = useState('')
  const [systemType, setSystemType] = useState<SystemType>(defaultSystemType(lead.water_concern))
  const [jobType, setJobType] = useState<JobType>('standard_install')
  const [notes, setNotes] = useState('')

  const installPrefLabel: Record<string, string> = {
    asap: 'ASAP', specific_date: 'Specific Date', flexible: 'Flexible',
  }
  const paymentLabel: Record<string, string> = {
    cash: 'Cash', check: 'Check', card: 'Card', financing: 'Financing',
  }

  const jobAlreadyCreated = !!lead.job_created

  async function handleScheduleInstall() {
    if (!user) return
    if (!systemType) { alert('Select a system type'); return }

    setSubmitting(true)
    try {
      const fullAddress = [lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ')

      // 1. Create job in dispatch
      const { data: newJob, error: jobError } = await supabase
        .from('jobs')
        .insert({
          lead_id:                    lead.id,
          status:                     'scheduled',
          job_type:                   jobType,
          system_type:                systemType,
          assigned_technician_id:     techId || null,
          scheduled_date:             scheduledDate || null,
          customer_name_snapshot:     lead.full_name,
          phone_snapshot:             lead.phone,
          email_snapshot:             lead.email || null,
          service_address_snapshot:   fullAddress,
          quote_total_snapshot:       lead.quote_total || null,
          payment_method_snapshot:    lead.payment_method || null,
          notes:                      notes || null,
          handover_signed:            false,
          requires_new_faucet_hole:   false,
          ready_for_customer_conversion: false,
          created_by:                 user.id,
        })
        .select('id')
        .single()

      if (jobError) throw jobError

      // 2. Log job_created activity
      await supabase.from('job_activity_log').insert({
        job_id:     newJob.id,
        event_type: 'job_created',
        title:      'Job created from agreement',
        actor_id:   user.id,
        actor_name: profile?.full_name || 'Admin',
        metadata:   { lead_id: lead.id, scheduled_date: scheduledDate || null },
      }).throwOnError()

      // 3. Mark job_created on lead
      await supabase.from('leads').update({ job_created: true }).eq('id', lead.id)

      // 4. Move lead to won
      const actor = { actor_id: user.id, actor_name: profile?.full_name }
      const updatedLead = await moveStage(lead.id, lead.stage, 'won', actor)

      // 5. Refresh boards
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
          {/* Schedule Install button */}
          {!jobAlreadyCreated ? (
            <button
              onClick={() => setShowModal(true)}
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
              Creates a job on the Dispatch board and moves this lead to Won.
            </p>

            <div className="space-y-4">

              {/* System type */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                  System Type <span className="text-red-400">*</span>
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

              {/* Job type */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                  Job Type
                </label>
                <select
                  value={jobType}
                  onChange={e => setJobType(e.target.value as JobType)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-accent"
                >
                  {(Object.keys(JOB_TYPE_LABELS) as JobType[]).map(t => (
                    <option key={t} value={t}>{JOB_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>

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
                  {technicians?.map(t => (
                    <option key={t.id} value={t.id}>{t.full_name}</option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Any install notes for the tech…"
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
