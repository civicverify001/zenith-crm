import { useState, useMemo } from 'react'
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

interface DetectedProduct {
  name: string
  category: string
  quantity: number
}

interface JobSlot {
  date: string   // YYYY-MM-DD
  count: number
  customerNames: string[]
}

function formatCurrency(val: number | null | undefined): string {
  if (!val) return '—'
  return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function formatDate(str: string | null | undefined): string {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function StatusBadge({ active, activeLabel, inactiveLabel }: { active: boolean; activeLabel: string; inactiveLabel: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${active ? 'bg-green/20 text-green' : 'bg-muted/20 text-muted'}`}>
      {active ? activeLabel : inactiveLabel}
    </span>
  )
}

function systemTypeFromCategories(categories: string[]): SystemType {
  const has = (c: string) => categories.includes(c)
  if ((has('ro') && has('softener')) || (has('ro') && has('whole_home_filter'))) return 'combo_whole_home_ro'
  if (has('ro')) return 'ro_install'
  if (has('softener')) return 'softener_only'
  if (has('whole_home_filter')) return 'ro_install'
  return 'softener_only'
}
function systemTypeFromText(agreementType: string | null, lineItems: any[]): SystemType {
  if (lineItems?.length) {
    const desc = lineItems.map((li: any) => (li.description || li.name || '').toLowerCase()).join(' ')
    if (desc.includes('combo') || ((desc.includes('ro') || desc.includes('reverse osmosis')) && desc.includes('softener'))) return 'combo_whole_home_ro'
    if (desc.includes('dual tank')) return 'dual_tank'
    if (desc.includes('advanced') && desc.includes('softener')) return 'advanced_softener'
    if (desc.includes('pure start')) return 'pure_start_softener'
    if (desc.includes('ro') || desc.includes('reverse osmosis')) return 'ro_install'
    if (desc.includes('softener')) return 'softener_only'
  }
  if (agreementType) {
    const t = agreementType.toLowerCase()
    if (t.includes('combo')) return 'combo_whole_home_ro'
    if (t.includes('dual')) return 'dual_tank'
    if (t.includes('advanced')) return 'advanced_softener'
    if (t.includes('pure')) return 'pure_start_softener'
    if (t.includes('ro')) return 'ro_install'
    if (t.includes('softener')) return 'softener_only'
  }
  return 'softener_only'
}

const ALL_SYSTEM_TYPES: SystemType[] = ['softener_only','pure_start_softener','advanced_softener','dual_tank','ro_install','combo_whole_home_ro']
const CATEGORY_LABELS: Record<string, string> = {
  ro: 'Reverse Osmosis', softener: 'Water Softener', whole_home_filter: 'Whole Home Filter',
  replacement_filter: 'Replacement Filter', accessory: 'Accessory', service: 'Service',
}
const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

// ── Mini Install Calendar ──────────────────────────────────────
function MiniCalendar({
  selectedDate,
  onSelect,
  jobSlots,
}: {
  selectedDate: string
  onSelect: (d: string) => void
  jobSlots: JobSlot[]
}) {
  const today = new Date()
  const [viewDate, setViewDate] = useState(() => {
    if (selectedDate) {
      const d = new Date(selectedDate + 'T12:00:00')
      return new Date(d.getFullYear(), d.getMonth(), 1)
    }
    return new Date(today.getFullYear(), today.getMonth(), 1)
  })

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()

  const slotMap = useMemo(() => {
    const m = new Map<string, JobSlot>()
    jobSlots.forEach(s => m.set(s.date, s))
    return m
  }, [jobSlots])

  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrev = new Date(year, month, 0).getDate()

  const cells: { date: Date; current: boolean }[] = []
  for (let i = firstDay - 1; i >= 0; i--)
    cells.push({ date: new Date(year, month - 1, daysInPrev - i), current: false })
  for (let d = 1; d <= daysInMonth; d++)
    cells.push({ date: new Date(year, month, d), current: true })
  while (cells.length < 42)
    cells.push({ date: new Date(year, month + 1, cells.length - firstDay - daysInMonth + 1), current: false })

  function dk(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }
  function isToday(d: Date) {
    return d.getFullYear()===today.getFullYear() && d.getMonth()===today.getMonth() && d.getDate()===today.getDate()
  }
  function isPast(d: Date) {
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    return d < t
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-3">
      {/* Nav */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setViewDate(new Date(year, month-1, 1))} className="text-muted hover:text-white w-6 h-6 flex items-center justify-center rounded transition-colors">‹</button>
        <span className="text-xs font-bold text-white">{MONTHS[month]} {year}</span>
        <button onClick={() => setViewDate(new Date(year, month+1, 1))} className="text-muted hover:text-white w-6 h-6 flex items-center justify-center rounded transition-colors">›</button>
      </div>
      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => <div key={d} className="text-center text-xs text-muted font-semibold py-0.5">{d}</div>)}
      </div>
      {/* Grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((cell, i) => {
          const key = dk(cell.date)
          const slot = slotMap.get(key)
          const isSelected = selectedDate === key
          const past = isPast(cell.date)
          const count = slot?.count || 0

          // Color coding: 0=open(green), 1=light(yellow), 2=moderate(orange), 3+=busy(red)
          const busyColor = count === 0
            ? 'text-green/60'
            : count === 1
            ? 'text-yellow-400'
            : count === 2
            ? 'text-orange-400'
            : 'text-red-400'

          return (
            <button
              key={i}
              onClick={() => { if (cell.current && !past) onSelect(key) }}
              disabled={!cell.current || past}
              title={slot ? `${count} job${count!==1?'s':''}: ${slot.customerNames.join(', ')}` : 'Open'}
              className={`
                relative flex flex-col items-center justify-center rounded-lg py-1.5 transition-all
                ${!cell.current || past ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer hover:bg-card'}
                ${isSelected ? 'bg-cyan ring-2 ring-cyan text-white' : ''}
                ${isToday(cell.date) && !isSelected ? 'ring-1 ring-accent' : ''}
              `}
            >
              <span className={`text-xs font-semibold leading-none ${isSelected ? 'text-white' : cell.current ? 'text-slate-300' : 'text-muted'}`}>
                {cell.date.getDate()}
              </span>
              {/* Job count dot */}
              {cell.current && !past && (
                <span className={`text-[9px] font-bold mt-0.5 leading-none ${isSelected ? 'text-white/80' : busyColor}`}>
                  {count === 0 ? '●' : `${count}j`}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {/* Legend */}
      <div className="flex items-center gap-3 mt-3 pt-2 border-t border-border/50">
        <span className="text-[10px] text-green/70 font-semibold">● open</span>
        <span className="text-[10px] text-yellow-400 font-semibold">1j light</span>
        <span className="text-[10px] text-orange-400 font-semibold">2j mod</span>
        <span className="text-[10px] text-red-400 font-semibold">3j+ busy</span>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────
export function AgreementSignedPanel({ lead, onLeadUpdated }: Props) {
  const { user, profile } = useAuth()
  const queryClient = useQueryClient()
  const { data: technicians } = useTechnicians()

  const [showModal, setShowModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loadingAgreement, setLoadingAgreement] = useState(false)
  const [loadingSlots, setLoadingSlots] = useState(false)

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
  const [detectedProducts, setDetectedProducts] = useState<DetectedProduct[]>([])
  const [detectionSource, setDetectionSource] = useState<'invoice'|'quote'|'fallback'|null>(null)
  const [jobSlots, setJobSlots] = useState<JobSlot[]>([])

  const installPrefLabel: Record<string, string> = { asap: 'ASAP', specific_date: 'Specific Date', flexible: 'Flexible' }
  const paymentLabel: Record<string, string> = { cash: 'Cash', check: 'Check', card: 'Card', financing: 'Financing' }
  const jobAlreadyCreated = !!lead.job_created

  function applySystemType(detected: SystemType) {
    setSystemType(detected)
    if (detected === 'ro_install' || detected === 'combo_whole_home_ro') setNeedsFaucetHole(true)
  }

  async function resolveLineItemProducts(lineItems: any[]): Promise<DetectedProduct[]> {
    const ids = lineItems.map((li: any) => li.product_id).filter(Boolean)
    if (!ids.length) return []
    const { data } = await supabase.from('products').select('id, name, category').in('id', ids)
    const map = new Map((data || []).map((p: any) => [p.id, p]))
    return lineItems
      .filter((li: any) => li.product_id && map.has(li.product_id))
      .map((li: any) => ({ name: map.get(li.product_id).name, category: map.get(li.product_id).category, quantity: li.quantity || 1 }))
  }

  async function loadJobSlots() {
    setLoadingSlots(true)
    try {
      const { data } = await supabase
        .from('jobs')
        .select('scheduled_date, customer_name_snapshot, status')
        .not('scheduled_date', 'is', null)
        .in('status', ['scheduled', 'in_progress', 'waiting_for_stock'])
      const map = new Map<string, JobSlot>()
      ;(data || []).forEach((j: any) => {
        const key = j.scheduled_date.split('T')[0]
        if (!map.has(key)) map.set(key, { date: key, count: 0, customerNames: [] })
        const s = map.get(key)!
        s.count++
        s.customerNames.push(j.customer_name_snapshot)
      })
      setJobSlots(Array.from(map.values()))
    } catch(e) {
      console.error('Failed to load job slots', e)
    } finally {
      setLoadingSlots(false)
    }
  }

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

      if (agreement?.line_items_snapshot) {
        const lineItems = typeof agreement.line_items_snapshot === 'string'
          ? JSON.parse(agreement.line_items_snapshot) : agreement.line_items_snapshot
        const products = await resolveLineItemProducts(lineItems)
        if (products.length > 0) {
          setDetectedProducts(products); setDetectionSource('invoice')
          applySystemType(systemTypeFromCategories(products.map(p => p.category)))
          setAgreementFetched(true); return
        }
        const textDetected = systemTypeFromText(agreement.agreement_type || agreement.commercial_type || null, lineItems)
        const fallback: DetectedProduct[] = lineItems.filter((li: any) => li.description || li.name)
          .map((li: any) => ({ name: li.description || li.name, category: '', quantity: li.quantity || 1 }))
        setDetectedProducts(fallback); setDetectionSource('invoice')
        applySystemType(textDetected); setAgreementFetched(true); return
      }

      const { data: quote } = await supabase
        .from('quotes')
        .select('line_items_snapshot, commercial_type, quote_type')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (quote?.line_items_snapshot) {
        const lineItems = typeof quote.line_items_snapshot === 'string'
          ? JSON.parse(quote.line_items_snapshot) : quote.line_items_snapshot
        const products = await resolveLineItemProducts(lineItems)
        if (products.length > 0) {
          setDetectedProducts(products); setDetectionSource('quote')
          applySystemType(systemTypeFromCategories(products.map(p => p.category)))
          setAgreementFetched(true); return
        }
        const textDetected = systemTypeFromText(quote.commercial_type || quote.quote_type || null, lineItems)
        const fallback: DetectedProduct[] = lineItems.filter((li: any) => li.description || li.name)
          .map((li: any) => ({ name: li.description || li.name, category: '', quantity: li.quantity || 1 }))
        setDetectedProducts(fallback); setDetectionSource('quote')
        applySystemType(textDetected); setAgreementFetched(true); return
      }

      setDetectionSource('fallback')
      if (lead.water_concern) {
        const wc = lead.water_concern.toLowerCase()
        if (wc.includes('ro') || wc.includes('reverse')) applySystemType('ro_install')
        else if (wc.includes('combo')) applySystemType('combo_whole_home_ro')
      }
      setAgreementFetched(true)
    } catch (e) {
      console.error('Could not detect system type:', e)
    } finally {
      setLoadingAgreement(false)
    }
  }

  function handleOpenModal() {
    setShowModal(true)
    loadAgreementSystemType()
    loadJobSlots()
  }

  async function handleScheduleInstall() {
    if (!user) return
    setSubmitting(true)
    try {
      const newJob = await createInstallJobFromLead(lead, systemType, scheduledDate || null, needsFaucetHole, { actor_id: user.id, actor_name: profile?.full_name })
      if (techId) await supabase.from('jobs').update({ assigned_technician_id: techId, assigned_at: new Date().toISOString() }).eq('id', newJob.id)
      if (notes) await supabase.from('jobs').update({ notes }).eq('id', newJob.id)
      const actor = { actor_id: user.id, actor_name: profile?.full_name }
      const updatedLead = await moveStage(lead.id, lead.stage, 'won', actor)
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

  // Selected date display
  const selectedDateLabel = scheduledDate
    ? new Date(scheduledDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : null

  const selectedDaySlot = scheduledDate ? jobSlots.find(s => s.date === scheduledDate) : null

  return (
    <>
      <div className="bg-green/5 border border-green/20 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-green text-sm">✅</span>
            <h4 className="text-sm font-bold text-green">Agreement Signed</h4>
          </div>
          {!jobAlreadyCreated ? (
            <button onClick={handleOpenModal} className="text-xs px-3 py-1.5 bg-cyan/20 hover:bg-cyan/30 text-cyan border border-cyan/30 rounded-lg font-semibold transition-colors">
              📅 Schedule Install
            </button>
          ) : (
            <span className="text-xs px-3 py-1.5 bg-green/20 text-green border border-green/30 rounded-lg font-semibold">✓ Job Created</span>
          )}
        </div>
        <div className="text-center py-2">
          <div className="text-xs text-muted uppercase tracking-wide">Quote Total</div>
          <div className="text-2xl font-bold text-white mt-0.5">{formatCurrency(lead.quote_total)}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><div className="text-xs text-muted">Signed By</div><div className="text-sm text-slate-200">{lead.signed_by || '—'}</div></div>
          <div><div className="text-xs text-muted">Signed At</div><div className="text-sm text-slate-200">{formatDate(lead.signed_at)}</div></div>
          <div>
            <div className="text-xs text-muted">Payment</div>
            <div className="text-sm text-slate-200">
              {lead.payment_method ? paymentLabel[lead.payment_method] || lead.payment_method : '—'}
              {lead.financing_provider && <span className="text-xs text-muted ml-1">({lead.financing_provider})</span>}
            </div>
          </div>
          <div><div className="text-xs text-muted">Deposit</div><div className="text-sm text-slate-200">{formatCurrency(lead.deposit_amount)}</div></div>
          <div>
            <div className="text-xs text-muted">Install Pref.</div>
            <div className="text-sm text-slate-200">
              {lead.install_preference ? installPrefLabel[lead.install_preference] || lead.install_preference : '—'}
              {lead.install_preferred_date && <span className="text-xs text-muted ml-1">({new Date(lead.install_preferred_date).toLocaleDateString()})</span>}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">Agreement File</div>
            <div className="text-sm">
              {lead.agreement_file_url
                ? <a href={lead.agreement_file_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">View PDF</a>
                : <span className="text-muted">No file</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-2 border-t border-green/10">
          <StatusBadge active={!!lead.job_created} activeLabel="Job Created" inactiveLabel="Job Pending" />
          <StatusBadge active={!!lead.inventory_reserved} activeLabel="Inventory Reserved" inactiveLabel="Not Reserved" />
        </div>
      </div>

      {/* ── Schedule Install Modal ───────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-start justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg p-6 shadow-2xl my-4">
            <h3 className="font-bold text-white text-base mb-1">Schedule Install</h3>
            <p className="text-xs text-muted mb-5">Creates a job on the Dispatch board, then moves lead to Won.</p>

            <div className="space-y-4">

              {/* Products */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                  {loadingAgreement ? <span className="text-accent animate-pulse">Loading products…</span>
                    : detectedProducts.length > 0
                    ? <>Products Being Installed <span className="ml-1 font-normal normal-case text-green">✓ from {detectionSource === 'invoice' ? 'signed agreement' : 'quote'}</span></>
                    : 'Products Being Installed'}
                </label>
                {loadingAgreement ? (
                  <div className="bg-surface border border-border rounded-lg p-3 space-y-2">
                    <div className="h-4 bg-muted/20 rounded animate-pulse w-3/4" />
                    <div className="h-4 bg-muted/20 rounded animate-pulse w-1/2" />
                  </div>
                ) : detectedProducts.length > 0 ? (
                  <div className="bg-surface border border-border rounded-lg divide-y divide-border">
                    {detectedProducts.map((p, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2.5">
                        <div>
                          <div className="text-sm font-medium text-slate-200">{p.name}</div>
                          {p.category && <div className="text-xs text-muted mt-0.5">{CATEGORY_LABELS[p.category] || p.category}</div>}
                        </div>
                        <span className="text-xs text-slate-400 font-semibold ml-3">× {p.quantity}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-surface border border-border rounded-lg px-3 py-3 text-xs text-muted">
                    No products found — select system type manually below.
                  </div>
                )}
              </div>

              {/* Install Type */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                  Install Type <span className="text-red-400">*</span>
                  {detectedProducts.length > 0 && !loadingAgreement && <span className="ml-2 text-accent font-normal normal-case">auto-detected</span>}
                </label>
                <select value={systemType} onChange={e => setSystemType(e.target.value as SystemType)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-accent">
                  {ALL_SYSTEM_TYPES.map(t => <option key={t} value={t}>{SYSTEM_TYPE_LABELS[t]}</option>)}
                </select>
                <div className="text-xs text-muted mt-1">Override if needed — controls the install checklist.</div>
              </div>

              {(systemType === 'ro_install' || systemType === 'combo_whole_home_ro') && (
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="faucet_hole" checked={needsFaucetHole} onChange={e => setNeedsFaucetHole(e.target.checked)} className="w-4 h-4 accent-cyan" />
                  <label htmlFor="faucet_hole" className="text-sm text-slate-300 cursor-pointer">Requires new faucet hole (adds drilling consent form)</label>
                </div>
              )}

              {/* ── Install Date — mini calendar ── */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                  Install Date <span className="text-red-400">*</span>
                  {lead.install_preferred_date && (
                    <span className="ml-2 text-accent font-normal normal-case">
                      Customer requested: {new Date(lead.install_preferred_date).toLocaleDateString()}
                    </span>
                  )}
                </label>

                {loadingSlots ? (
                  <div className="bg-surface border border-border rounded-xl p-4 text-xs text-accent animate-pulse text-center">
                    Loading availability…
                  </div>
                ) : (
                  <MiniCalendar
                    selectedDate={scheduledDate}
                    onSelect={setScheduledDate}
                    jobSlots={jobSlots}
                  />
                )}

                {/* Selected date confirmation */}
                {scheduledDate && (
                  <div className="mt-2 flex items-center justify-between bg-cyan/10 border border-cyan/30 rounded-lg px-3 py-2">
                    <div>
                      <div className="text-xs font-semibold text-cyan">Selected Date</div>
                      <div className="text-sm text-white font-medium">{selectedDateLabel}</div>
                    </div>
                    {selectedDaySlot ? (
                      <div className="text-right">
                        <div className={`text-xs font-bold ${selectedDaySlot.count >= 3 ? 'text-red-400' : selectedDaySlot.count === 2 ? 'text-orange-400' : 'text-yellow-400'}`}>
                          {selectedDaySlot.count} other job{selectedDaySlot.count !== 1 ? 's' : ''} this day
                        </div>
                        <div className="text-xs text-muted mt-0.5 max-w-[140px] truncate">{selectedDaySlot.customerNames.join(', ')}</div>
                      </div>
                    ) : (
                      <div className="text-xs font-bold text-green">✓ Open slot</div>
                    )}
                  </div>
                )}

                {!scheduledDate && (
                  <div className="mt-2 text-xs text-amber text-center">⚠ Select a date from the calendar above</div>
                )}
              </div>

              {/* Technician */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Assign Technician</label>
                <select value={techId} onChange={e => setTechId(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-accent">
                  <option value="">— Unassigned —</option>
                  {technicians?.map((t: any) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                </select>
                {!techId && <div className="text-xs text-amber mt-1">⚠ Tech required to Start Installation on the dispatch board</div>}
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Notes for Tech</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any install notes…" rows={2}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent resize-none" />
              </div>

              {/* Customer summary */}
              <div className="bg-surface rounded-lg p-3 text-xs text-muted space-y-1">
                <div><span className="text-slate-400 font-semibold">Customer: </span>{lead.full_name}</div>
                <div><span className="text-slate-400 font-semibold">Address: </span>{[lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ') || '—'}</div>
                <div><span className="text-slate-400 font-semibold">Phone: </span>{lead.phone}</div>
                {lead.quote_total && <div><span className="text-slate-400 font-semibold">Quote Total: </span>{formatCurrency(lead.quote_total)}</div>}
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowModal(false)} disabled={submitting} className="flex-1 py-2.5 text-sm text-muted hover:text-white transition-colors">Cancel</button>
              <button
                onClick={handleScheduleInstall}
                disabled={submitting || loadingAgreement || !scheduledDate}
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
