import { useState, useMemo, useEffect } from 'react'
import type { Lead } from './leads.types'
import { useTechnicians } from '../dispatch/useJobs'
import { SYSTEM_TYPE_LABELS } from '../dispatch/dispatch.types'
import type { SystemType } from '../dispatch/dispatch.types'
import { createInstallJobFromLead } from '../../services/jobService'
import { useAuth } from '../../hooks/useAuth'
import { useQueryClient } from '@tanstack/react-query'
import { JOB_KEYS } from '../dispatch/useJobs'
import { LEAD_KEYS } from './useLeads'
import { supabase } from '../../lib/supabase'
import { cloneQuote, updateLeadFinancingStatus, type FinancingStatus } from '../../services/quotesService'
import { syncToCalendar } from '../../services/googleCalService'

// ── REMOVED: moveStage import
// moveStage to 'won' has been moved to complete.js (api/installations/complete.js).
// Lead now stays at 'agreement_signed' until the install is physically completed.
// This file no longer needs moveStage.

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
  date: string        // YYYY-MM-DD
  count: number
  customerNames: string[]
  bookedHours: number[]  // 8, 9, 10, etc.
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
  if (has('whole_home_filter') || has('filtration')) return 'softener_only'
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

// Hours available: 8am–5pm
const HOUR_SLOTS = [8,9,10,11,12,13,14,15,16,17]
function hourLabel(h: number): string {
  if (h === 12) return '12:00 PM'
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`
}

// ── Time Slot Picker ───────────────────────────────────────────
function TimeSlotPicker({
  selectedHour,
  onSelect,
  bookedHours,
}: {
  selectedHour: number | null
  onSelect: (h: number) => void
  bookedHours: number[]
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {HOUR_SLOTS.map(h => {
        const booked = bookedHours.includes(h)
        const selected = selectedHour === h
        return (
          <button
            key={h}
            onClick={() => { if (!booked) onSelect(h) }}
            disabled={booked}
            className={`
              py-2 rounded-lg text-xs font-semibold transition-all border
              ${booked
                ? 'bg-red-500/10 border-red-500/30 text-red-400/60 cursor-not-allowed line-through'
                : selected
                ? 'bg-cyan border-cyan text-white shadow-lg shadow-cyan/20'
                : 'bg-surface border-border text-slate-300 hover:border-accent hover:text-white cursor-pointer'
              }
            `}
          >
            {hourLabel(h)}
            {booked && <div className="text-[9px] mt-0.5 no-underline" style={{textDecoration:'none'}}>Booked</div>}
          </button>
        )
      })}
    </div>
  )
}

// ── Mini Calendar ──────────────────────────────────────────────
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
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setViewDate(new Date(year, month-1, 1))} className="text-muted hover:text-white w-6 h-6 flex items-center justify-center rounded transition-colors">‹</button>
        <span className="text-xs font-bold text-white">{MONTHS[month]} {year}</span>
        <button onClick={() => setViewDate(new Date(year, month+1, 1))} className="text-muted hover:text-white w-6 h-6 flex items-center justify-center rounded transition-colors">›</button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => <div key={d} className="text-center text-xs text-muted font-semibold py-0.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((cell, i) => {
          const key = dk(cell.date)
          const slot = slotMap.get(key)
          const isSelected = selectedDate === key
          const past = isPast(cell.date)
          const count = slot?.count || 0
          const fullyBooked = count >= HOUR_SLOTS.length

          const busyColor = count === 0 ? 'text-green/60'
            : count <= 2 ? 'text-yellow-400'
            : count <= 5 ? 'text-orange-400'
            : 'text-red-400'

          return (
            <button
              key={i}
              onClick={() => { if (cell.current && !past && !fullyBooked) onSelect(key) }}
              disabled={!cell.current || past || fullyBooked}
              title={slot ? `${count} booked: ${slot.customerNames.join(', ')}` : 'Open'}
              className={`
                relative flex flex-col items-center justify-center rounded-lg py-1.5 transition-all
                ${!cell.current || past || fullyBooked ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer hover:bg-card'}
                ${isSelected ? 'bg-cyan ring-2 ring-cyan text-white' : ''}
                ${isToday(cell.date) && !isSelected ? 'ring-1 ring-accent' : ''}
              `}
            >
              <span className={`text-xs font-semibold leading-none ${isSelected ? 'text-white' : cell.current ? 'text-slate-300' : 'text-muted'}`}>
                {cell.date.getDate()}
              </span>
              {cell.current && !past && (
                <span className={`text-[9px] font-bold mt-0.5 leading-none ${isSelected ? 'text-white/80' : busyColor}`}>
                  {count === 0 ? '●' : `${count}/${HOUR_SLOTS.length}`}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-3 mt-3 pt-2 border-t border-border/50">
        <span className="text-[10px] text-green/70 font-semibold">● open</span>
        <span className="text-[10px] text-yellow-400 font-semibold">light</span>
        <span className="text-[10px] text-orange-400 font-semibold">moderate</span>
        <span className="text-[10px] text-red-400 font-semibold">busy</span>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────
export function AgreementSignedPanel({ lead, onLeadUpdated }: Props) {
  const { user, profile } = useAuth()
  const queryClient = useQueryClient()
  const { data: technicians } = useTechnicians()

  const isSalesRep = profile?.role === 'salesrep'

  const [showModal, setShowModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loadingAgreement, setLoadingAgreement] = useState(false)
  const [loadingSlots, setLoadingSlots] = useState(false)

  const [scheduledDate, setScheduledDate] = useState(
    lead.install_preferred_date
      ? new Date(lead.install_preferred_date).toISOString().split('T')[0]
      : ''
  )
  const [scheduledHour, setScheduledHour] = useState<number | null>(null)
  const [techId, setTechId] = useState('')
  const [systemType, setSystemType] = useState<SystemType>('softener_only')
  const [needsFaucetHole, setNeedsFaucetHole] = useState(false)
  const [notes, setNotes] = useState('')
  const [agreementFetched, setAgreementFetched] = useState(false)
  const [detectedProducts, setDetectedProducts] = useState<DetectedProduct[]>([])
  const [detectionSource, setDetectionSource] = useState<'invoice'|'quote'|'fallback'|null>(null)
  const [jobSlots, setJobSlots] = useState<JobSlot[]>([])
  const [financingStatus, setFinancingStatus] = useState<FinancingStatus | null>(null)
  const [financingLoading, setFinancingLoading] = useState(false)
  const [cloneSuccess, setCloneSuccess] = useState<{ quoteId: string; type: 'rental' | 'purchase' } | null>(null)

  // Agreement data loaded from DB
  const [agreementData, setAgreementData] = useState<{
    signed_by: string | null
    signed_at: string | null
    quote_total: number | null
    monthly_amount: number | null
    commercial_type: string | null
  } | null>(null)

  const jobAlreadyCreated = !!lead.job_created

  // ── Load agreement/quote data from DB ─────────────────────────
  // Strategy: try lead_id first, fall back to customer_id if empty.
  // signed_by lives on agreements only (customer types name during signing).
  // quotes table does not have a signed_by column.
  useEffect(() => {
    async function loadAgreementData() {
      const customerId = (lead as any).converted_to_customer_id ?? null

      // 1. Try agreements by lead_id
      let agData: any = null
      const { data: ag1 } = await supabase
        .from('agreements')
        .select('signed_by, signed_at, commercial_type')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      agData = ag1

      // 2. Fall back to customer_id if lead_id returned nothing
      if (!agData && customerId) {
        const { data: ag2 } = await supabase
          .from('agreements')
          .select('signed_by, signed_at, commercial_type')
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        agData = ag2
      }

      // 3. Try quotes by lead_id (accepted or signed)
      let qtData: any = null
      const { data: qt1 } = await supabase
        .from('quotes')
        .select('total, monthly_amount, commercial_type, signed_at')
        .eq('lead_id', lead.id)
        .in('status', ['accepted', 'signed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      qtData = qt1

      // 4. Fall back to customer_id for quotes
      if (!qtData && customerId) {
        const { data: qt2 } = await supabase
          .from('quotes')
          .select('total, monthly_amount, commercial_type, signed_at')
          .eq('customer_id', customerId)
          .in('status', ['accepted', 'signed'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        qtData = qt2
      }

      // 5. Final fallback: any quote for this lead (not just signed ones)
      if (!qtData) {
        const { data: qt3 } = await supabase
          .from('quotes')
          .select('total, monthly_amount, commercial_type, signed_at')
          .eq('lead_id', lead.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        qtData = qt3
      }

      setAgreementData({
        signed_by: agData?.signed_by || (lead as any).signed_by || null,
        signed_at: agData?.signed_at || qtData?.signed_at || (lead as any).signed_at || null,
        quote_total: qtData?.total || (lead as any).quote_total || null,
        monthly_amount: qtData?.monthly_amount || null,
        commercial_type: agData?.commercial_type || qtData?.commercial_type || null,
      })

      // Load financing_status from lead
      const { data: leadData } = await supabase
        .from('leads')
        .select('financing_status')
        .eq('id', lead.id)
        .maybeSingle()
      if (leadData?.financing_status) setFinancingStatus(leadData.financing_status as FinancingStatus)
    }
    loadAgreementData()
  }, [lead.id])

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
        const dt = new Date(j.scheduled_date)
        const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
        const hour = dt.getHours()
        if (!map.has(key)) map.set(key, { date: key, count: 0, customerNames: [], bookedHours: [] })
        const s = map.get(key)!
        s.count++
        s.customerNames.push(j.customer_name_snapshot)
        if (hour >= 8) s.bookedHours.push(hour)
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

  function handleDateSelect(d: string) {
    setScheduledDate(d)
    setScheduledHour(null)
  }

  function buildScheduledDatetime(): string | null {
    if (!scheduledDate || scheduledHour === null) return scheduledDate || null
    return `${scheduledDate}T${String(scheduledHour).padStart(2,'0')}:00:00`
  }

  // ── CHANGED: handleScheduleInstall ────────────────────────────
  // REMOVED: moveStage(lead.id, lead.stage, 'won', actor)
  // REASON:  Lead must stay at 'agreement_signed' until the install is
  //          physically completed by the technician. Moving to 'won' here
  //          was causing the lead to disappear from the pipeline before
  //          the install even happened. The 'won' stage move now lives in
  //          complete.js (api/installations/complete.js) and fires only
  //          after Kendrick marks the job done.
  async function handleScheduleInstall() {
  if (!user) return
  setSubmitting(true)
  try {
    const datetime = buildScheduledDatetime()
    const newJob = await createInstallJobFromLead(lead, systemType, datetime, needsFaucetHole, { actor_id: user.id, actor_name: profile?.full_name })
    if (techId) await supabase.from('jobs').update({ assigned_technician_id: techId, assigned_at: new Date().toISOString() }).eq('id', newJob.id)
    if (notes) await supabase.from('jobs').update({ notes }).eq('id', newJob.id)

    // Push to Google Calendar (fire and forget)
    syncToCalendar('job', newJob.id).catch(e => console.warn('Google Cal sync failed:', e))

    // Move lead to 'won' — removes from pipeline kanban.
    // Dispatch board is now the tracking point until install is complete.
    await supabase.from('leads').update({
      stage: 'won',
      stage_changed_at: new Date().toISOString(),
      stage_entered_at: new Date().toISOString(),
    }).eq('id', lead.id)

    queryClient.invalidateQueries({ queryKey: JOB_KEYS.board() })
    queryClient.invalidateQueries({ queryKey: LEAD_KEYS.kanban() })
    queryClient.invalidateQueries({ queryKey: LEAD_KEYS.counts })

    onLeadUpdated?.({ ...lead, stage: 'won' as any })
    setShowModal(false)
  } catch (err: any) {
    alert('Failed to create job: ' + (err.message || err))
  } finally {
    setSubmitting(false)
  }
}
  const selectedDaySlot = scheduledDate ? jobSlots.find(s => s.date === scheduledDate) : null
  const bookedHoursForDay = selectedDaySlot?.bookedHours || []

  const selectedDateLabel = scheduledDate
    ? new Date(scheduledDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : null

  const canSubmit = !submitting && !loadingAgreement && !!scheduledDate && scheduledHour !== null

  async function handleFinancingStatus(status: FinancingStatus) {
    setFinancingLoading(true)
    try {
      await updateLeadFinancingStatus(lead.id, status)
      setFinancingStatus(status)
    } catch (e: any) {
      alert('Failed to update financing status: ' + e.message)
    } finally {
      setFinancingLoading(false)
    }
  }

  async function handleCloneQuote(newType: 'rental' | 'purchase') {
    setFinancingLoading(true)
    setCloneSuccess(null)
    try {
      const { data: origQuote } = await supabase
        .from('quotes')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('commercial_type', 'financed')
        .in('status', ['signed', 'accepted'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!origQuote) throw new Error('Original financed quote not found')
      const newId = await cloneQuote(origQuote.id, newType, lead.id)
      setCloneSuccess({ quoteId: newId, type: newType })
    } catch (e: any) {
      alert('Failed to clone quote: ' + e.message)
    } finally {
      setFinancingLoading(false)
    }
  }

  const isRental = agreementData?.commercial_type === 'rental'
  const displayTotal = isRental
    ? `${formatCurrency(agreementData?.monthly_amount)}/mo`
    : formatCurrency(agreementData?.quote_total || (lead as any).quote_total)
  const displayLabel = isRental ? 'Monthly Amount' : 'Quote Total'

  return (
    <>
      <div className="bg-green/5 border border-green/20 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-green text-sm">✅</span>
            <h4 className="text-sm font-bold text-green">Agreement Signed</h4>
          </div>
          {jobAlreadyCreated ? (
            <span className="text-xs px-3 py-1.5 bg-green/20 text-green border border-green/30 rounded-lg font-semibold">
              ✓ Job Created
            </span>
          ) : isSalesRep ? (
            <span className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)' }}>
              Pending scheduling
            </span>
          ) : (
            <button
              onClick={handleOpenModal}
              className="text-xs px-3 py-1.5 bg-cyan/20 hover:bg-cyan/30 text-cyan border border-cyan/30 rounded-lg font-semibold transition-colors"
            >
              📅 Schedule Install
            </button>
          )}
        </div>

        <div className="text-center py-2">
          <div className="text-xs text-muted uppercase tracking-wide">{displayLabel}</div>
          <div className="text-2xl font-bold text-white mt-0.5">{displayTotal}</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-muted">Signed By</div>
            <div className="text-sm text-slate-200">{agreementData?.signed_by || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Signed At</div>
            <div className="text-sm text-slate-200">{formatDate(agreementData?.signed_at)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Type</div>
            <div className="text-sm text-slate-200">
              {agreementData?.commercial_type === 'rental' ? '🔄 Rental'
                : agreementData?.commercial_type === 'purchase' ? '💰 Purchase'
                : agreementData?.commercial_type === 'financed' ? '🏦 Financed'
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">Agreement</div>
            <div className="text-sm">
              {(lead as any).agreement_file_url
                ? <a href={(lead as any).agreement_file_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">View PDF</a>
                : <span className="text-green">✓ Digitally Signed</span>}
            </div>
          </div>
        </div>

        {/* ── Financing Status Section (financed quotes only) ── */}
        {agreementData?.commercial_type === 'financed' && !isSalesRep && (
          <div className="border border-pink-500/20 rounded-xl p-3 space-y-3" style={{ background: 'rgba(244,114,182,0.05)' }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold" style={{ color: '#f472b6' }}>🏦 Financing Status</span>
              {financingStatus && (
                <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                  style={{
                    background: financingStatus === 'approved' ? 'rgba(74,222,128,0.15)'
                      : financingStatus === 'declined' ? 'rgba(248,113,113,0.15)'
                      : 'rgba(251,191,36,0.15)',
                    color: financingStatus === 'approved' ? '#4ade80'
                      : financingStatus === 'declined' ? '#f87171'
                      : '#fbbf24',
                  }}>
                  {financingStatus === 'approved' ? '✓ Approved'
                    : financingStatus === 'declined' ? '✗ Declined'
                    : '⏳ Pending'}
                </span>
              )}
            </div>

            {/* Status buttons — only show if not yet set or to change */}
            {financingStatus !== 'approved' && (
              <div className="flex gap-2">
                <button
                  onClick={() => handleFinancingStatus('pending')}
                  disabled={financingLoading || financingStatus === 'pending'}
                  className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all border"
                  style={{
                    background: financingStatus === 'pending' ? 'rgba(251,191,36,0.2)' : 'transparent',
                    borderColor: '#fbbf24', color: '#fbbf24', opacity: financingLoading ? 0.5 : 1,
                  }}
                >
                  ⏳ Pending
                </button>
                <button
                  onClick={() => handleFinancingStatus('approved')}
                  disabled={financingLoading}
                  className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all border"
                  style={{ background: 'rgba(74,222,128,0.1)', borderColor: '#4ade80', color: '#4ade80', opacity: financingLoading ? 0.5 : 1 }}
                >
                  ✓ Approved
                </button>
                <button
                  onClick={() => handleFinancingStatus('declined')}
                  disabled={financingLoading}
                  className="flex-1 py-1.5 rounded-lg text-xs font-semibond transition-all border"
                  style={{ background: 'rgba(248,113,113,0.1)', borderColor: '#f87171', color: '#f87171', opacity: financingLoading ? 0.5 : 1 }}
                >
                  ✗ Declined
                </button>
              </div>
            )}

            {/* Resend buttons — only when declined */}
            {financingStatus === 'declined' && (
              <div>
                <div className="text-xs mb-2" style={{ color: '#94a3b8' }}>
                  Financing declined — resend customer a new quote:
                </div>
                {cloneSuccess ? (
                  <div className="rounded-lg p-3 text-xs text-center" style={{ background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.3)', color: '#22d3ee' }}>
                    ✓ New {cloneSuccess.type} quote created as draft.{' '}
                    <a href="/quotes" className="underline font-bold" style={{ color: '#22d3ee' }}>Go to Quotes →</a>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleCloneQuote('rental')}
                      disabled={financingLoading}
                      className="flex-1 py-2 rounded-lg text-xs font-bold transition-all border"
                      style={{ background: 'rgba(34,211,238,0.1)', borderColor: '#22d3ee', color: '#22d3ee', opacity: financingLoading ? 0.5 : 1 }}
                    >
                      {financingLoading ? '…' : '🔄 Resend as Rental'}
                    </button>
                    <button
                      onClick={() => handleCloneQuote('purchase')}
                      disabled={financingLoading}
                      className="flex-1 py-2 rounded-lg text-xs font-bold transition-all border"
                      style={{ background: 'rgba(74,222,128,0.1)', borderColor: '#4ade80', color: '#4ade80', opacity: financingLoading ? 0.5 : 1 }}
                    >
                      {financingLoading ? '…' : '💰 Resend as Purchase'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2 border-t border-green/10">
          <StatusBadge active={!!lead.job_created} activeLabel="Job Created" inactiveLabel="Job Pending" />
          <StatusBadge active={!!(lead as any).inventory_reserved} activeLabel="Inventory Reserved" inactiveLabel="Not Reserved" />
        </div>
      </div>

      {/* ── Schedule Install Modal (admin/frontdesk only) ──────────── */}
      {showModal && !isSalesRep && (
        <div className="fixed inset-0 bg-black/70 flex items-start justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg p-6 shadow-2xl my-4">
            <h3 className="font-bold text-white text-base mb-1">Schedule Install</h3>
            {/* CHANGED: subtitle updated to reflect correct flow */}
            <p className="text-xs text-muted mb-5">Creates a job on the Dispatch board. Lead moves to Won when Kendrick marks install complete.</p>

            <div className="space-y-4">

              {/* Products */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                  {loadingAgreement
                    ? <span className="text-accent animate-pulse">Loading products…</span>
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

              {/* Install Type — only show when products NOT auto-detected */}
              {detectedProducts.length === 0 && !loadingAgreement && (
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                    Install Type <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={systemType}
                    onChange={e => setSystemType(e.target.value as SystemType)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-accent"
                  >
                    {ALL_SYSTEM_TYPES.map(t => <option key={t} value={t}>{SYSTEM_TYPE_LABELS[t]}</option>)}
                  </select>
                  <div className="text-xs text-muted mt-1">No products detected — select install type manually.</div>
                </div>
              )}

              {(systemType === 'ro_install' || systemType === 'combo_whole_home_ro') && (
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="faucet_hole" checked={needsFaucetHole} onChange={e => setNeedsFaucetHole(e.target.checked)} className="w-4 h-4 accent-cyan" />
                  <label htmlFor="faucet_hole" className="text-sm text-slate-300 cursor-pointer">Requires new faucet hole (adds drilling consent form)</label>
                </div>
              )}

              {/* Step 1: Pick Date */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                  Step 1 — Pick a Date <span className="text-red-400">*</span>
                  {lead.install_preferred_date && (
                    <span className="ml-2 text-accent font-normal normal-case">
                      Customer requested: {new Date(lead.install_preferred_date).toLocaleDateString()}
                    </span>
                  )}
                </label>
                {loadingSlots ? (
                  <div className="bg-surface border border-border rounded-xl p-4 text-xs text-accent animate-pulse text-center">Loading availability…</div>
                ) : (
                  <MiniCalendar selectedDate={scheduledDate} onSelect={handleDateSelect} jobSlots={jobSlots} />
                )}
              </div>

              {/* Step 2: Pick Time */}
              {scheduledDate && !loadingSlots && (
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                    Step 2 — Pick a Time Slot <span className="text-red-400">*</span>
                    <span className="ml-2 font-normal normal-case text-slate-400">{selectedDateLabel}</span>
                  </label>
                  <TimeSlotPicker
                    selectedHour={scheduledHour}
                    onSelect={setScheduledHour}
                    bookedHours={bookedHoursForDay}
                  />
                  {bookedHoursForDay.length > 0 && (
                    <div className="text-xs text-muted mt-2">
                      {bookedHoursForDay.length} slot{bookedHoursForDay.length !== 1 ? 's' : ''} already booked this day
                    </div>
                  )}
                </div>
              )}

              {/* Confirmation bar */}
              {scheduledDate && scheduledHour !== null && (
                <div className="flex items-center justify-between bg-cyan/10 border border-cyan/30 rounded-lg px-3 py-2.5">
                  <div>
                    <div className="text-xs font-semibold text-cyan mb-0.5">Scheduled For</div>
                    <div className="text-sm text-white font-bold">{selectedDateLabel}</div>
                    <div className="text-sm text-cyan">{hourLabel(scheduledHour)}</div>
                  </div>
                  <div className="text-2xl">📅</div>
                </div>
              )}

              {/* Technician */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Assign Technician</label>
                <select
                  value={techId}
                  onChange={e => setTechId(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-accent"
                >
                  <option value="">— Unassigned —</option>
                  {technicians?.map((t: any) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                </select>
                {!techId && <div className="text-xs text-amber mt-1">⚠ Tech required to Start Installation on the dispatch board</div>}
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Notes for Tech</label>
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
                <div><span className="text-slate-400 font-semibold">Address: </span>{[lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ') || '—'}</div>
                <div><span className="text-slate-400 font-semibold">Phone: </span>{lead.phone}</div>
                {agreementData?.quote_total && <div><span className="text-slate-400 font-semibold">Quote Total: </span>{formatCurrency(agreementData.quote_total)}</div>}
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowModal(false)} disabled={submitting} className="flex-1 py-2.5 text-sm text-muted hover:text-white transition-colors">Cancel</button>
              <button
                onClick={handleScheduleInstall}
                disabled={!canSubmit}
                className="flex-1 py-2.5 bg-cyan hover:bg-cyan/80 disabled:opacity-50 text-white font-bold rounded-lg text-sm transition-colors"
                title={!scheduledDate ? 'Select a date first' : scheduledHour === null ? 'Select a time slot' : ''}
              >
                {submitting ? 'Creating Job…' : scheduledHour !== null ? `📅 Schedule for ${hourLabel(scheduledHour)}` : '📅 Create Job & Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
