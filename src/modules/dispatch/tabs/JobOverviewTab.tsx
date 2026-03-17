import { useState, useEffect, useMemo } from 'react'
import type { Job } from '../dispatch.types'
import { JOB_STATUS_LABELS, SYSTEM_TYPE_LABELS } from '../dispatch.types'
import { useTechnicians, useAssignTechnician, useUpdateJobStatus } from '../useJobs'
import type { JobStatus } from '../dispatch.types'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getCompletionStatus } from '../../../services/jobService'
import { checkJobReadiness } from '../../../services/inventoryService'
import { supabase } from '../../../lib/supabase'

const CATEGORY_LABELS: Record<string, string> = {
  ro: 'Reverse Osmosis', softener: 'Water Softener', whole_home_filter: 'Whole Home Filter',
  replacement_filter: 'Replacement Filter', accessory: 'Accessory', service: 'Service',
}

const INVENTORY_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
  reserved:      { label: 'Stock Reserved',    color: '#4ade80', bg: 'rgba(74,222,128,0.1)',  border: 'rgba(74,222,128,0.25)', icon: '✅' },
  short:         { label: 'Stock Shortage',    color: '#f87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.25)', icon: '⚠️' },
  pending_check: { label: 'Checking Stock',    color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.25)', icon: '⏳' },
  not_required:  { label: 'No Stock Needed',   color: '#64748b', bg: 'rgba(100,116,139,0.1)', border: 'rgba(100,116,139,0.2)', icon: '—' },
  ready:         { label: 'Stock Ready',       color: '#4ade80', bg: 'rgba(74,222,128,0.1)',  border: 'rgba(74,222,128,0.25)', icon: '✅' },
  n_a:           { label: 'N/A',               color: '#64748b', bg: 'rgba(100,116,139,0.1)', border: 'rgba(100,116,139,0.2)', icon: '—' },
}

interface Props {
  job: Job
  onJobUpdated: (job: Job) => void
}

function formatDate(str: string | null) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatCurrency(val: number | null) {
  if (!val) return '—'
  return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
}

// Dispatch only owns scheduling/stock transitions. Start Job + Mark Complete belong to Installations.
const DISPATCH_STATUS_ACTIONS: Partial<Record<JobStatus, { label: string; target: JobStatus; variant: string }[]>> = {
  ready_to_schedule: [
    { label: 'Waiting for Stock', target: 'waiting_for_stock', variant: 'bg-amber/15 text-amber border-amber/30' },
  ],
  scheduled: [
    { label: 'Waiting for Stock', target: 'waiting_for_stock', variant: 'bg-amber/15 text-amber border-amber/30' },
    { label: 'Back to Ready', target: 'ready_to_schedule', variant: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  ],
  waiting_for_stock: [
    { label: 'Back to Ready', target: 'ready_to_schedule', variant: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
    { label: 'Back to Scheduled', target: 'scheduled', variant: 'bg-border text-slate-300 border-border' },
  ],
}

// ── Install Scheduler Calendar ────────────────────────────────
// Week-view calendar for scheduling install jobs. Techs instead of reps,
// jobs table for busy slots instead of site_visits.

const SCHED_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]
const HOUR_LABELS: Record<number, string> = {
  8: '8:00 AM', 9: '9:00 AM', 10: '10:00 AM', 11: '11:00 AM',
  12: '12:00 PM', 13: '1:00 PM', 14: '2:00 PM', 15: '3:00 PM',
  16: '4:00 PM', 17: '5:00 PM',
}

function getWeekDates(offset: number): Date[] {
  const today = new Date()
  const start = new Date(today)
  start.setDate(today.getDate() + offset * 7 - today.getDay() + 1) // Monday
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isPastSlot(d: Date, hour: number) {
  const slot = new Date(d)
  slot.setHours(hour, 0, 0, 0)
  return slot < new Date()
}

function isWeekend(d: Date) {
  return d.getDay() === 0 || d.getDay() === 6
}

interface BusySlot {
  assigned_technician_id: string
  scheduled_date: string
  scheduled_hour: number
  customer_name_snapshot: string
}

interface SchedulerProps {
  currentJobId: string
  techs: { id: string; full_name: string }[]
  preselectedTechId: string | null
  onConfirm: (date: string, hour: number, techId: string, notes: string) => Promise<void>
}

function InstallSchedulerCalendar({ currentJobId, techs, preselectedTechId, onConfirm }: SchedulerProps) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [activeTechId, setActiveTechId] = useState<string>(preselectedTechId || (techs[0]?.id ?? ''))
  const [busySlots, setBusySlots] = useState<BusySlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedHour, setSelectedHour] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [confirming, setConfirming] = useState(false)

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset])
  const weekStart = toDateKey(weekDates[0])
  const weekEnd = toDateKey(weekDates[6])

  // Load busy slots for all techs this week
  useEffect(() => {
    if (!techs.length) return
    setLoadingSlots(true)
    const techIds = techs.map(t => t.id)
    supabase
      .from('jobs')
      .select('assigned_technician_id, scheduled_date, customer_name_snapshot')
      .in('assigned_technician_id', techIds)
      .gte('scheduled_date', weekStart + 'T00:00:00')
      .lte('scheduled_date', weekEnd + 'T23:59:59')
      .not('status', 'in', '("complete","cancelled")')
      .neq('id', currentJobId)
      .then(({ data }) => {
        if (data) {
          // Parse hour from scheduled_date timestamp
          const slots: BusySlot[] = data.map(row => {
            const dt = new Date(row.scheduled_date)
            return {
              assigned_technician_id: row.assigned_technician_id,
              scheduled_date: toDateKey(dt),
              scheduled_hour: dt.getHours(),
              customer_name_snapshot: row.customer_name_snapshot,
            }
          })
          setBusySlots(slots)
        }
        setLoadingSlots(false)
      })
  }, [weekStart, weekEnd, techs, currentJobId])

  // Busy map: "techId-date-hour" → customer name
  const busyMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const s of busySlots) {
      map[`${s.assigned_technician_id}-${s.scheduled_date}-${s.scheduled_hour}`] = s.customer_name_snapshot || 'Booked'
    }
    return map
  }, [busySlots])

  function isBusy(techId: string, date: string, hour: number) {
    return busyMap[`${techId}-${date}-${hour}`] || null
  }

  function handleSlotClick(date: string, hour: number) {
    if (!activeTechId) return
    if (isBusy(activeTechId, date, hour)) return
    const d = new Date(date + 'T12:00:00')
    if (isPastSlot(d, hour)) return
    setSelectedDate(date)
    setSelectedHour(hour)
  }

  async function handleConfirm() {
    if (!selectedDate || selectedHour === null || !activeTechId) return
    setConfirming(true)
    try {
      await onConfirm(selectedDate, selectedHour, activeTechId, notes)
    } finally {
      setConfirming(false)
    }
  }

  const selectedTechName = techs.find(t => t.id === activeTechId)?.full_name || ''
  const canConfirm = !!selectedDate && selectedHour !== null && !!activeTechId && !confirming

  return (
    <div style={{
      background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.25)',
      borderRadius: 14, overflow: 'hidden',
    }}>
      {/* Section header */}
      <div style={{
        padding: '12px 14px', borderBottom: '1px solid rgba(168,85,247,0.2)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>📞</span>
        <div>
          <div style={{ color: '#c084fc', fontWeight: 700, fontSize: 14 }}>Ready to Schedule</div>
          <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 1 }}>
            Pick a date and tech below, then confirm
          </div>
        </div>
      </div>

      {/* Tech tabs */}
      {techs.length > 0 && (
        <div style={{
          display: 'flex', gap: 6, padding: '10px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          overflowX: 'auto',
        }}>
          {techs.map(tech => {
            const isActive = activeTechId === tech.id
            const initials = tech.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
            return (
              <button
                key={tech.id}
                onClick={() => { setActiveTechId(tech.id); setSelectedDate(null); setSelectedHour(null) }}
                style={{
                  flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                  background: isActive ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isActive ? 'rgba(168,85,247,0.5)' : '#1e3a4f'}`,
                  color: isActive ? '#c084fc' : '#64748b',
                  boxShadow: isActive ? '0 0 10px rgba(168,85,247,0.15)' : 'none',
                }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800,
                  background: isActive ? 'rgba(168,85,247,0.4)' : '#1e3a4f',
                  color: isActive ? '#e9d5ff' : '#64748b',
                }}>
                  {initials}
                </div>
                {tech.full_name.split(' ')[0]}
              </button>
            )
          })}
        </div>
      )}

      {/* Week nav */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}>
        <button
          onClick={() => { setWeekOffset(o => o - 1); setSelectedDate(null); setSelectedHour(null) }}
          style={{
            padding: '4px 10px', borderRadius: 6, border: '1px solid #1e3a4f',
            background: 'rgba(255,255,255,0.03)', color: '#94a3b8', cursor: 'pointer', fontSize: 11,
          }}
        >← Prev</button>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0' }}>
          {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} —{' '}
          {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
        <button
          onClick={() => { setWeekOffset(o => o + 1); setSelectedDate(null); setSelectedHour(null) }}
          style={{
            padding: '4px 10px', borderRadius: 6, border: '1px solid #1e3a4f',
            background: 'rgba(255,255,255,0.03)', color: '#94a3b8', cursor: 'pointer', fontSize: 11,
          }}
        >Next →</button>
      </div>

      {/* Calendar grid — 7 columns, compact for drawer width */}
      <div style={{ padding: '10px 10px 6px', overflowX: 'auto' }}>
        {loadingSlots ? (
          <div style={{ textAlign: 'center', padding: '20px 0', color: '#64748b', fontSize: 12 }}>
            Loading schedule...
          </div>
        ) : (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(7, minmax(56px, 1fr))',
            gap: 4, minWidth: 420,
          }}>
            {weekDates.map(date => {
              const dateKey = toDateKey(date)
              const weekend = isWeekend(date)
              const isToday = toDateKey(new Date()) === dateKey
              return (
                <div key={dateKey} style={{
                  borderRadius: 8, overflow: 'hidden',
                  border: isToday ? '1px solid #a855f7' : '1px solid #1e3a4f',
                  background: '#0f1923',
                }}>
                  {/* Day header */}
                  <div style={{
                    padding: '4px 2px', textAlign: 'center',
                    background: weekend ? '#1c1407' : '#162232',
                    borderBottom: '1px solid #1e3a4f',
                  }}>
                    <div style={{
                      fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                      color: isToday ? '#c084fc' : weekend ? '#f59e0b' : '#64748b',
                    }}>
                      {date.toLocaleDateString('en-US', { weekday: 'short' })}
                    </div>
                    <div style={{
                      fontSize: 12, fontWeight: 800,
                      color: isToday ? '#e9d5ff' : weekend ? '#fbbf24' : '#cbd5e1',
                    }}>
                      {date.getDate()}
                    </div>
                  </div>

                  {/* Time slots */}
                  <div style={{ padding: '3px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {SCHED_HOURS.map(hour => {
                      const busy = activeTechId ? isBusy(activeTechId, dateKey, hour) : null
                      const past = isPastSlot(date, hour)
                      const selected = selectedDate === dateKey && selectedHour === hour

                      if (past) {
                        return (
                          <div key={hour} style={{
                            padding: '2px 3px', borderRadius: 4, textAlign: 'center',
                            background: 'rgba(255,255,255,0.02)',
                          }}>
                            <div style={{ fontSize: 8, color: '#334155' }}>{HOUR_LABELS[hour]}</div>
                          </div>
                        )
                      }

                      if (busy) {
                        return (
                          <div key={hour} title={busy} style={{
                            padding: '2px 3px', borderRadius: 4, textAlign: 'center',
                            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                          }}>
                            <div style={{ fontSize: 8, color: '#f87171', fontWeight: 600 }}>{HOUR_LABELS[hour]}</div>
                            <div style={{ fontSize: 7, color: '#ef4444', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {busy.split(' ')[0]}
                            </div>
                          </div>
                        )
                      }

                      return (
                        <button
                          key={hour}
                          onClick={() => handleSlotClick(dateKey, hour)}
                          style={{
                            padding: '3px', borderRadius: 4, textAlign: 'center', cursor: 'pointer',
                            background: selected ? '#166534' : 'rgba(74,222,128,0.05)',
                            border: `1px solid ${selected ? '#22c55e' : 'rgba(74,222,128,0.15)'}`,
                            boxShadow: selected ? '0 0 8px rgba(34,197,94,0.2)' : 'none',
                          }}
                        >
                          <div style={{ fontSize: 8, color: selected ? '#4ade80' : '#86efac', fontWeight: selected ? 700 : 500 }}>
                            {HOUR_LABELS[hour]}
                          </div>
                          {selected && <div style={{ fontSize: 7, color: '#4ade80' }}>✓</div>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Notes */}
      <div style={{ padding: '8px 12px 0' }}>
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Notes for tech (optional)"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.03)', border: '1px solid #1e3a4f',
            borderRadius: 8, padding: '8px 12px', color: '#e2e8f0', fontSize: 12, outline: 'none',
          }}
        />
      </div>

      {/* Confirm footer */}
      <div style={{ padding: '10px 12px 12px' }}>
        {selectedDate && selectedHour !== null ? (
          <div style={{ marginBottom: 8, fontSize: 11, color: '#94a3b8' }}>
            <span style={{ color: '#4ade80', fontWeight: 700 }}>✓ </span>
            {selectedTechName} · {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {HOUR_LABELS[selectedHour]}
            {isWeekend(new Date(selectedDate + 'T12:00:00')) && (
              <span style={{ marginLeft: 6, color: '#f59e0b', fontWeight: 600 }}>⚡ Weekend</span>
            )}
          </div>
        ) : (
          <div style={{ marginBottom: 8, fontSize: 11, color: '#475569' }}>
            {activeTechId ? 'Tap an open (green) slot to select' : 'Select a tech first'}
          </div>
        )}
        <button
          onClick={handleConfirm}
          disabled={!canConfirm}
          style={{
            width: '100%', padding: '11px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700,
            cursor: canConfirm ? 'pointer' : 'not-allowed',
            opacity: canConfirm ? 1 : 0.4,
            background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
            color: '#fff', border: 'none',
            boxShadow: canConfirm ? '0 4px 20px rgba(168,85,247,0.3)' : 'none',
          }}
        >
          {confirming ? 'Scheduling...' : selectedDate && selectedHour !== null
            ? `📅 Confirm — ${new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${HOUR_LABELS[selectedHour]}`
            : '📅 Confirm Schedule'}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────

export function JobOverviewTab({ job, onJobUpdated }: Props) {
  const navigate = useNavigate()
  const { data: techs } = useTechnicians()
  const { mutateAsync: assignTech } = useAssignTechnician()
  const { mutateAsync: updateStatus, isPending: statusPending } = useUpdateJobStatus()

  // Read-only completion readiness
  const { data: completionStatus } = useQuery({
    queryKey: ['job_completion', job.id],
    queryFn: () => getCompletionStatus(job.id),
    enabled: !!job.id,
    staleTime: 15_000,
  })

  // ── Products from quote line items ──
  const { data: jobProducts } = useQuery({
    queryKey: ['job_products', job.id],
    queryFn: async () => {
      let quoteId = (job as any).source_quote_id || null

      if (!quoteId && job.lead_id) {
        const { data: quote } = await supabase
          .from('quotes')
          .select('id')
          .eq('lead_id', job.lead_id)
          .in('status', ['accepted', 'signed'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        quoteId = quote?.id || null
      }

      if (!quoteId) return []

      const { data: lineItems } = await supabase
        .from('document_line_items')
        .select('product_id, description, quantity')
        .eq('document_id', quoteId)
        .order('sort_order', { ascending: true })

      if (!lineItems?.length) return []

      const productIds = lineItems.map(li => li.product_id).filter(Boolean)
      let productMap = new Map<string, any>()
      if (productIds.length > 0) {
        const { data: products } = await supabase
          .from('products')
          .select('id, name, category, sku')
          .in('id', productIds)
        productMap = new Map((products || []).map(p => [p.id, p]))
      }

      return lineItems
        .filter(li => li.product_id && productMap.has(li.product_id))
        .map(li => {
          const prod = productMap.get(li.product_id)
          return { name: prod.name, category: prod.category, sku: prod.sku, quantity: li.quantity || 1 }
        })
    },
    enabled: !!job.id,
    staleTime: 60_000,
  })

  // ── Inventory readiness detail ──
  const invStatus = (job as any).inventory_status as string | null
  const { data: inventoryDetail } = useQuery({
    queryKey: ['job_inventory_readiness', job.id],
    queryFn: () => checkJobReadiness(job.id),
    enabled: !!job.id && (invStatus === 'short' || invStatus === 'pending_check' || invStatus === 'reserved'),
    staleTime: 15_000,
  })

  const actions = DISPATCH_STATUS_ACTIONS[job.status] || []

  async function handleStatusChange(target: JobStatus) {
    try {
      const updated = await updateStatus({ jobId: job.id, newStatus: target, currentJob: job })
      onJobUpdated(updated)
    } catch (e: any) {
      alert(e.message)
    }
  }

  async function handleAssignTech(techId: string) {
    try {
      const updated = await assignTech({ jobId: job.id, techId })
      onJobUpdated(updated)
    } catch (e) {
      console.error(e)
    }
  }

  // ── Calendar confirm handler ──
  async function handleCalendarConfirm(date: string, hour: number, techId: string, notes: string) {
    const datetime = `${date}T${String(hour).padStart(2, '0')}:00:00`
    await supabase.from('jobs').update({
      scheduled_date: datetime,
      assigned_technician_id: techId,
      notes: notes || null,
    }).eq('id', job.id)

    const updated = await updateStatus({
      jobId: job.id,
      newStatus: 'scheduled' as JobStatus,
      currentJob: { ...job, scheduled_date: datetime, assigned_technician_id: techId },
    })
    onJobUpdated(updated)
  }

  const invConfig = invStatus ? INVENTORY_STATUS_CONFIG[invStatus] : null

  return (
    <div className="space-y-4">
      {/* Open in Installations link */}
      <button
        onClick={() => navigate(`/installations/${job.id}`)}
        className="w-full text-left px-3 py-2.5 bg-accent/10 border border-accent/30 rounded-xl text-sm text-accent font-medium hover:bg-accent/20 transition-colors"
      >
        🔧 Open in Installations →
        <span className="block text-xs text-muted mt-0.5">View checklist, photos, handover forms, and completion status</span>
      </button>

      {/* Dispatch-owned status actions */}
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {actions.map(a => (
            <button
              key={a.target}
              onClick={() => handleStatusChange(a.target)}
              disabled={statusPending}
              className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${a.variant} ${statusPending ? 'opacity-50' : ''}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Calendar Scheduler (replaces date/time/tech form for ready_to_schedule) ── */}
      {job.status === 'ready_to_schedule' && techs && techs.length > 0 && (
        <InstallSchedulerCalendar
          currentJobId={job.id}
          techs={techs}
          preselectedTechId={job.assigned_technician_id || null}
          onConfirm={handleCalendarConfirm}
        />
      )}

      {/* Loading techs state */}
      {job.status === 'ready_to_schedule' && !techs && (
        <div style={{
          background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.25)',
          borderRadius: 14, padding: '20px', textAlign: 'center', color: '#64748b', fontSize: 13,
        }}>
          Loading calendar...
        </div>
      )}

      {/* ── Products Being Installed (Gap 6) ── */}
      {jobProducts && jobProducts.length > 0 && (
        <div style={{
          background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 14px', borderBottom: '1px solid #1e3a4f',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 14 }}>📦</span>
            <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13 }}>
              Products Being Installed
            </span>
            <span style={{ color: '#4ade80', fontSize: 11, fontWeight: 600 }}>
              {jobProducts.length} item{jobProducts.length !== 1 ? 's' : ''}
            </span>
          </div>
          {jobProducts.map((p: any, i: number) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 14px',
              borderBottom: i < jobProducts.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
            }}>
              <div>
                <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                  {p.category && (
                    <span style={{ color: '#64748b', fontSize: 11 }}>
                      {CATEGORY_LABELS[p.category] || p.category}
                    </span>
                  )}
                  {p.sku && (
                    <span style={{ color: '#475569', fontSize: 11, fontFamily: 'monospace' }}>
                      {p.sku}
                    </span>
                  )}
                </div>
              </div>
              <span style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>× {p.quantity}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Inventory Status (Gap 4) ── */}
      {invConfig && invStatus !== 'not_required' && invStatus !== 'n_a' && (
        <div style={{
          background: invConfig.bg, border: `1px solid ${invConfig.border}`,
          borderRadius: 14, overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14 }}>{invConfig.icon}</span>
              <div>
                <div style={{ color: invConfig.color, fontWeight: 700, fontSize: 13 }}>
                  {invConfig.label}
                </div>
                {invStatus === 'short' && (
                  <div style={{ color: '#f87171', fontSize: 11, marginTop: 2 }}>
                    Cannot start installation until stock arrives
                  </div>
                )}
                {invStatus === 'pending_check' && (
                  <div style={{ color: '#fbbf24', fontSize: 11, marginTop: 2 }}>
                    Inventory check in progress
                  </div>
                )}
                {invStatus === 'reserved' && (
                  <div style={{ color: '#4ade80', fontSize: 11, marginTop: 2 }}>
                    All materials reserved — ready to install
                  </div>
                )}
              </div>
            </div>
          </div>

          {inventoryDetail && inventoryDetail.items.length > 0 && invStatus === 'short' && (
            <div style={{ borderTop: `1px solid ${invConfig.border}`, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Material Status
              </div>
              {inventoryDetail.items.map((item: any, i: number) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 0',
                  borderBottom: i < inventoryDetail.items.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                }}>
                  <div style={{ color: '#e2e8f0', fontSize: 12 }}>{item.product_name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {item.reserved ? (
                      <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 600 }}>✅ Reserved</span>
                    ) : (
                      <span style={{ fontSize: 11, color: '#f87171', fontWeight: 600 }}>
                        Short {item.shortage_amount > 0 ? `(need ${item.shortage_amount})` : ''}
                      </span>
                    )}
                    {item.reorder_request_id && (
                      <span style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 8,
                        background: 'rgba(251,191,36,0.1)', color: '#fbbf24',
                        border: '1px solid rgba(251,191,36,0.2)',
                      }}>
                        On Order
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {inventoryDetail && inventoryDetail.items.length > 0 && invStatus === 'reserved' && (
            <div style={{ borderTop: `1px solid ${invConfig.border}`, padding: '10px 14px' }}>
              {inventoryDetail.items.map((item: any, i: number) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '4px 0',
                }}>
                  <span style={{ color: '#cbd5e1', fontSize: 12 }}>{item.product_name}</span>
                  <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 600 }}>✅ × {item.quantity_needed}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Read-only completion readiness summary */}
      {completionStatus && job.status !== 'complete' && (
        <div className="border border-border rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">Execution Status</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
              completionStatus.ready ? 'bg-green/20 text-green' : 'bg-amber/20 text-amber'
            }`}>
              {completionStatus.ready ? 'Ready' : 'Not Ready'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="text-muted">Checklist: <span className="text-slate-300">{completionStatus.checklistCompleted}/{completionStatus.checklistTotal}</span></div>
            <div className="text-muted">Photos: <span className="text-slate-300">{completionStatus.photosProvided}/{completionStatus.photosRequired}</span></div>
            <div className="text-muted">Verification: <span className="text-slate-300">{completionStatus.verificationCompleted}/{completionStatus.verificationRequired}</span></div>
            <div className="text-muted">Forms: <span className="text-slate-300">{completionStatus.formsCompleted}/{completionStatus.formsRequired}</span></div>
          </div>
          {completionStatus.issues.length > 0 && (
            <div className="text-xs text-amber">{completionStatus.issues.length} blocking issue{completionStatus.issues.length !== 1 ? 's' : ''}</div>
          )}
        </div>
      )}

      {/* Complete badge */}
      {job.status === 'complete' && (
        <div className="bg-green/10 border border-green/20 rounded-xl p-3 text-center">
          <div className="text-green font-bold text-sm">✅ Job Complete</div>
          <div className="text-xs text-muted mt-1">Completed {formatDate(job.completed_at)}</div>
          {job.ready_for_customer_conversion && (
            <div className="text-xs text-accent mt-1">Ready for customer conversion</div>
          )}
        </div>
      )}

      {/* Snapshot info */}
      <InfoRow label="Customer" value={job.customer_name_snapshot} />
      <InfoRow label="Phone" value={job.phone_snapshot} />
      {job.email_snapshot && <InfoRow label="Email" value={job.email_snapshot} />}
      <InfoRow label="Service Address" value={job.service_address_snapshot} />
      <InfoRow label="System Type" value={SYSTEM_TYPE_LABELS[job.system_type]} />
      {job.equipment_summary && <InfoRow label="Equipment" value={job.equipment_summary} />}
      {job.quote_total_snapshot && <InfoRow label="Quote Total" value={formatCurrency(job.quote_total_snapshot)} />}
      {job.payment_method_snapshot && <InfoRow label="Payment" value={job.payment_method_snapshot} />}
      <InfoRow label="Scheduled" value={job.scheduled_date || 'Not set'} />
      {job.started_at && <InfoRow label="Started" value={formatDate(job.started_at)} />}
      {job.serial_number && <InfoRow label="Serial Number" value={job.serial_number} />}

      {/* Technician assignment (read/reassign after scheduling) */}
      <div>
        <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Assigned Technician</div>
        {techs ? (
          <select
            value={job.assigned_technician_id || ''}
            onChange={e => e.target.value && handleAssignTech(e.target.value)}
            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-accent"
          >
            <option value="">— Unassigned —</option>
            {techs.map((t: any) => (
              <option key={t.id} value={t.id}>{t.full_name}</option>
            ))}
          </select>
        ) : (
          <div className="text-sm text-slate-300">{job.assigned_technician?.full_name || 'Unassigned'}</div>
        )}
        {job.assigned_at && (
          <div className="text-xs text-muted mt-1">Assigned {formatDate(job.assigned_at)}</div>
        )}
      </div>

      {/* Notes */}
      {job.notes && (
        <div>
          <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Notes</div>
          <div className="text-sm text-slate-300 bg-card border border-border rounded-lg p-3 whitespace-pre-wrap">{job.notes}</div>
        </div>
      )}
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
