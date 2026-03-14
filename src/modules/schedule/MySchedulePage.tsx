// src/modules/schedule/MySchedulePage.tsx
// Role-aware schedule page:
// - Sales reps / frontdesk: site visits
// - Technician: install jobs with products
// - Admin: everything

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'

// ─── Types ────────────────────────────────────────────────────────
interface VisitEvent {
  kind: 'visit'
  id: string
  date: string
  hour: number
  leadId: string
  leadName: string
  leadPhone: string
  leadEmail: string
  leadAddress: string
  leadCity: string
  leadState: string
  leadZip: string
  waterConcern: string
  notes: string
  qualifyingAnswers: Record<string, any>
  repId: string
  status: string
}

interface JobEvent {
  kind: 'job'
  id: string
  date: string
  customerName: string
  address: string
  systemType: string
  status: string
  techName: string
  products: string[]
}

type CalEvent = VisitEvent | JobEvent

// ─── Helpers ──────────────────────────────────────────────────────
function formatHour(h: number) {
  if (h === 0) return '12:00 AM'
  if (h < 12) return `${h}:00 AM`
  if (h === 12) return '12:00 PM'
  return `${h - 12}:00 PM`
}

function isoDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDays(d: Date, n: number) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

const STATUS_COLOR: Record<string, string> = {
  scheduled:   '#60a5fa',
  confirmed:   '#60a5fa',
  in_progress: '#22d3ee',
  complete:    '#4ade80',
  cancelled:   '#64748b',
  pending:     '#fbbf24',
}

const SYSTEM_LABELS: Record<string, string> = {
  ro:                 'RO System',
  ro_install:         'RO System',
  softener:           'Water Softener',
  softener_only:      'Water Softener',
  whole_home_filter:  'Whole Home Filter',
  iron_filter:        'Iron Filter',
  dual_tank:          'Dual Tank',
  advanced_softener:  'Advanced Softener',
}

// ─── Main Component ───────────────────────────────────────────────
export function MySchedulePage() {
  const { profile, role } = useAuth()
  const navigate = useNavigate()

  const [view, setView] = useState<'month' | 'week'>('month')
  const [cursor, setCursor] = useState(new Date())
  const [events, setEvents] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<CalEvent | null>(null)
  // For loading full lead detail when a visit is clicked
  const [loadingDetail, setLoadingDetail] = useState(false)

  const isAdmin   = role === 'admin'
  const isTech    = role === 'technician'
  const isSales   = role === 'salesrep' || role === 'frontdesk'
  const showVisits = isAdmin || isSales
  const showJobs   = isAdmin || isTech

  const rangeStart = view === 'month'
    ? isoDate(addDays(startOfMonth(cursor), -6))
    : isoDate(addDays(cursor, -cursor.getDay()))
  const rangeEnd = view === 'month'
    ? isoDate(addDays(endOfMonth(cursor), 6))
    : isoDate(addDays(cursor, 6 - cursor.getDay()))

  useEffect(() => {
    if (!profile?.id) return
    fetchEvents()
  }, [profile?.id, rangeStart, rangeEnd, role])

  async function fetchEvents() {
    setLoading(true)
    const all: CalEvent[] = []

    // ── Site visits ────────────────────────────────────────────
    if (showVisits) {
      let q = supabase
        .from('site_visits')
        .select('id, lead_id, assigned_rep_id, visit_date, visit_hour, status')
        .gte('visit_date', rangeStart)
        .lte('visit_date', rangeEnd)
        .not('status', 'eq', 'cancelled')

      if (!isAdmin) q = q.eq('assigned_rep_id', profile!.id)

      const { data: visits } = await q
      if (visits && visits.length > 0) {
        const leadIds = [...new Set(visits.map((v: any) => v.lead_id).filter(Boolean))]
        const { data: leads } = await supabase
          .from('leads')
          .select('id, full_name, phone, email, address, city, state, zip, water_concern, notes, qualifying_answers')
          .in('id', leadIds)
        const lmap: Record<string, any> = Object.fromEntries((leads || []).map((l: any) => [l.id, l]))

        for (const v of visits) {
          const lead = lmap[v.lead_id]
          if (!lead) continue

          const addrParts = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean)
          all.push({
            kind: 'visit',
            id: v.id,
            date: v.visit_date,
            hour: v.visit_hour,
            leadId: v.lead_id,
            leadName: lead.full_name,
            leadPhone: lead.phone || '',
            leadEmail: lead.email || '',
            leadAddress: lead.address || '',
            leadCity: lead.city || '',
            leadState: lead.state || '',
            leadZip: lead.zip || '',
            waterConcern: lead.water_concern || '',
            notes: lead.notes || '',
            qualifyingAnswers: lead.qualifying_answers || {},
            repId: v.assigned_rep_id,
            status: v.status,
          })
        }
      }
    }

    // ── Jobs ───────────────────────────────────────────────────
    if (showJobs) {
      const { data: jobs } = await supabase
        .from('jobs')
        .select('id, customer_name_snapshot, service_address_snapshot, system_type, status, scheduled_date, assigned_technician_name, source_quote_id')
        .gte('scheduled_date', rangeStart)
        .lte('scheduled_date', rangeEnd)
        .not('status', 'eq', 'cancelled')

      if (jobs && jobs.length > 0) {
        const quoteIds = [...new Set(jobs.map((j: any) => j.source_quote_id).filter(Boolean))]
        let lineMap: Record<string, string[]> = {}

        if (quoteIds.length > 0) {
          const { data: lines } = await supabase
            .from('quote_line_items')
            .select('quote_id, description')
            .in('quote_id', quoteIds)

          if (lines) {
            for (const l of lines) {
              if (!lineMap[l.quote_id]) lineMap[l.quote_id] = []
              lineMap[l.quote_id].push(l.description)
            }
          }
        }

        for (const j of jobs) {
          const products = j.source_quote_id && lineMap[j.source_quote_id]
            ? lineMap[j.source_quote_id]
            : [SYSTEM_LABELS[j.system_type] || j.system_type || 'Install'].filter(Boolean)

          all.push({
            kind: 'job',
            id: j.id,
            date: j.scheduled_date?.split('T')[0] || j.scheduled_date,
            customerName: j.customer_name_snapshot || 'Unknown',
            address: j.service_address_snapshot || '',
            systemType: j.system_type || '',
            status: j.status,
            techName: j.assigned_technician_name || '',
            products,
          })
        }
      }
    }

    setEvents(all)
    setLoading(false)
  }

  // ── Calendar helpers ──────────────────────────────────────────
  function getMonthDays(): string[] {
    const first = startOfMonth(cursor)
    const last  = endOfMonth(cursor)
    const days: string[] = []
    for (let i = 0; i < first.getDay(); i++) {
      days.push(isoDate(addDays(first, -first.getDay() + i)))
    }
    let d = new Date(first)
    while (d <= last) { days.push(isoDate(d)); d = addDays(d, 1) }
    while (days.length % 7 !== 0) days.push(isoDate(d = addDays(d, 1)))
    return days
  }

  function getWeekDays(): string[] {
    const s = addDays(cursor, -cursor.getDay())
    return Array.from({ length: 7 }, (_, i) => isoDate(addDays(s, i)))
  }

  const days = view === 'month' ? getMonthDays() : getWeekDays()
  const today = isoDate(new Date())

  function eventsForDay(date: string) {
    return events.filter(e => e.date === date)
  }

  function prevPeriod() {
    if (view === 'month') setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
    else setCursor(addDays(cursor, -7))
  }

  function nextPeriod() {
    if (view === 'month') setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
    else setCursor(addDays(cursor, 7))
  }

  function goToday() { setCursor(new Date()) }

  const periodLabel = view === 'month'
    ? `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`
    : (() => {
        const s = addDays(cursor, -cursor.getDay())
        const e = addDays(s, 6)
        return `${MONTH_NAMES[s.getMonth()]} ${s.getDate()} – ${s.getMonth() !== e.getMonth() ? MONTH_NAMES[e.getMonth()] + ' ' : ''}${e.getDate()}, ${e.getFullYear()}`
      })()

  function chipColor(ev: CalEvent) {
    return ev.kind === 'visit' ? '#22d3ee' : '#fb923c'
  }

  // Parse qualifying answers into readable pairs
  function parseQualifyingAnswers(answers: Record<string, any>): { label: string; value: string }[] {
    if (!answers || typeof answers !== 'object') return []
    return Object.entries(answers)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => ({
        label: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        value: Array.isArray(v) ? v.join(', ') : String(v),
      }))
      .slice(0, 8) // cap at 8 to avoid overflow
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Header ─────────────────────────────────────── */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 20, margin: 0 }}>
            {isTech ? 'My Install Schedule' : isSales ? 'My Visit Schedule' : 'Team Schedule'}
          </h1>
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>
            {loading ? 'Loading...' : `${events.length} event${events.length !== 1 ? 's' : ''} in view`}
            {showVisits && <span style={{ marginLeft: 8, color: '#22d3ee' }}>● site visits</span>}
            {showJobs   && <span style={{ marginLeft: 8, color: '#fb923c' }}>● installs</span>}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 10, overflow: 'hidden' }}>
            {(['month', 'week'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '7px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                background: view === v ? '#0d7ea3' : 'transparent',
                color: view === v ? '#fff' : '#64748b',
                transition: 'all 0.15s',
              }}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <button onClick={prevPeriod} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #1e3a4f', background: '#162232', color: '#94a3b8', cursor: 'pointer', fontSize: 14 }}>‹</button>
          <button onClick={goToday}   style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #1e3a4f', background: '#162232', color: '#94a3b8', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Today</button>
          <button onClick={nextPeriod} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #1e3a4f', background: '#162232', color: '#94a3b8', cursor: 'pointer', fontSize: 14 }}>›</button>
          <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14, minWidth: 180, textAlign: 'center' }}>{periodLabel}</span>
        </div>
      </div>

      {/* ── Calendar ────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 16 }}>

        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #1e3a4f', flexShrink: 0 }}>
          {DAY_NAMES.map(d => (
            <div key={d} style={{ padding: '10px 8px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {d}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div style={{
          flex: 1, overflowY: 'auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gridTemplateRows: view === 'month' ? `repeat(${days.length / 7}, 1fr)` : '1fr',
        }}>
          {days.map((day, idx) => {
            const isThisMonth = new Date(day + 'T00:00:00').getMonth() === cursor.getMonth()
            const isToday = day === today
            const dayEvents = eventsForDay(day)
            const isWeekend = [0, 6].includes(new Date(day + 'T00:00:00').getDay())

            return (
              <div key={day} style={{
                borderRight: (idx % 7) < 6 ? '1px solid #1e3a4f' : 'none',
                borderBottom: idx < days.length - 7 ? '1px solid #1e3a4f' : 'none',
                background: isWeekend && view === 'month' ? 'rgba(0,0,0,0.1)' : 'transparent',
                opacity: view === 'month' && !isThisMonth ? 0.35 : 1,
                padding: '6px 6px 8px',
                minHeight: view === 'month' ? 90 : undefined,
                overflow: 'hidden',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isToday ? '#0d7ea3' : 'transparent',
                    color: isToday ? '#fff' : '#94a3b8',
                    fontSize: 12, fontWeight: isToday ? 700 : 500,
                  }}>
                    {new Date(day + 'T00:00:00').getDate()}
                  </div>
                  {dayEvents.length > 0 && (
                    <span style={{ fontSize: 10, color: '#64748b' }}>{dayEvents.length}</span>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {(view === 'month' ? dayEvents.slice(0, 3) : dayEvents).map(ev => (
                    <button
                      key={ev.id}
                      onClick={() => setSelected(ev)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '3px 7px', borderRadius: 6,
                        background: `${chipColor(ev)}18`,
                        border: `1px solid ${chipColor(ev)}35`,
                        cursor: 'pointer', textAlign: 'left', width: '100%',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${chipColor(ev)}30` }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `${chipColor(ev)}18` }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: chipColor(ev), flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: '#e2e8f0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {ev.kind === 'visit'
                          ? `${formatHour(ev.hour)} ${ev.leadName}`
                          : ev.customerName}
                      </span>
                    </button>
                  ))}
                  {view === 'month' && dayEvents.length > 3 && (
                    <button
                      onClick={() => { setCursor(new Date(day + 'T00:00:00')); setView('week') }}
                      style={{ fontSize: 10, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '0 7px' }}
                    >
                      +{dayEvents.length - 3} more
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Event Detail Modal ──────────────────────────── */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setSelected(null) }}
        >
          <div style={{
            width: '100%', maxWidth: selected.kind === 'visit' ? 520 : 440,
            background: '#0f1923',
            border: '1px solid #1e3a4f',
            borderTop: `3px solid ${chipColor(selected)}`,
            borderRadius: 20,
            overflow: 'hidden',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
          }}>

            {/* Modal header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px',
              background: `linear-gradient(135deg, ${chipColor(selected)}12, transparent)`,
              borderBottom: '1px solid #1e3a4f',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: `${chipColor(selected)}18`,
                  border: `1px solid ${chipColor(selected)}30`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0,
                }}>
                  {selected.kind === 'visit' ? '📍' : '🔧'}
                </div>
                <div>
                  <div style={{ color: '#f1f5f9', fontWeight: 800, fontSize: 16, letterSpacing: '-0.01em' }}>
                    {selected.kind === 'visit' ? selected.leadName : selected.customerName}
                  </div>
                  <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                    {selected.kind === 'visit'
                      ? `Site Visit · ${formatHour(selected.hour)}`
                      : `Install Job · ${selected.systemType ? (SYSTEM_LABELS[selected.systemType] || selected.systemType) : 'Install'}`}
                    {' · '}
                    {new Date(selected.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </div>
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{ color: '#475569', background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f', borderRadius: 8, width: 32, height: 32, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
            </div>

            {/* Scrollable body */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* ── VISIT MODAL ── */}
              {selected.kind === 'visit' && (() => {
                const fullAddress = [selected.leadAddress, selected.leadCity, selected.leadState, selected.leadZip].filter(Boolean).join(', ')
                const qaItems = parseQualifyingAnswers(selected.qualifyingAnswers)

                return (
                  <>
                    {/* Status + time */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 11, padding: '4px 12px', borderRadius: 20, fontWeight: 700,
                        background: `${STATUS_COLOR[selected.status] || '#64748b'}18`,
                        color: STATUS_COLOR[selected.status] || '#64748b',
                        border: `1px solid ${STATUS_COLOR[selected.status] || '#64748b'}35`,
                      }}>
                        {selected.status.replace(/_/g, ' ')}
                      </span>
                      <span style={{ fontSize: 12, color: '#64748b' }}>🕐 {formatHour(selected.hour)}</span>
                    </div>

                    {/* Contact info card */}
                    <InfoCard title="Contact Information" icon="👤" accent="#38bdf8">
                      <InfoRow icon="📞" label="Phone" value={selected.leadPhone || '—'} href={selected.leadPhone ? `tel:${selected.leadPhone}` : undefined} valueColor="#38bdf8" />
                      {selected.leadEmail && (
                        <InfoRow icon="✉️" label="Email" value={selected.leadEmail} href={`mailto:${selected.leadEmail}`} valueColor="#38bdf8" />
                      )}
                      {fullAddress && (
                        <InfoRow icon="📍" label="Address" value={fullAddress} />
                      )}
                    </InfoCard>

                    {/* Water concern */}
                    {selected.waterConcern && (
                      <InfoCard title="Water Concern" icon="💧" accent="#22d3ee">
                        <div style={{
                          padding: '10px 14px', borderRadius: 8,
                          background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.15)',
                        }}>
                          <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>{selected.waterConcern}</span>
                        </div>
                      </InfoCard>
                    )}

                    {/* Qualifying answers */}
                    {qaItems.length > 0 && (
                      <InfoCard title="Qualifying Answers" icon="📋" accent="#818cf8">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                          {qaItems.map((item, i) => (
                            <div key={i} style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
                              padding: '9px 0',
                              borderBottom: i < qaItems.length - 1 ? '1px solid #0d1a26' : 'none',
                            }}>
                              <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500, flexShrink: 0, maxWidth: '45%' }}>{item.label}</span>
                              <span style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 600, textAlign: 'right' }}>{item.value}</span>
                            </div>
                          ))}
                        </div>
                      </InfoCard>
                    )}

                    {/* Internal notes */}
                    {selected.notes && (
                      <InfoCard title="Notes" icon="📝" accent="#fbbf24">
                        <div style={{
                          padding: '10px 14px', borderRadius: 8,
                          background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)',
                        }}>
                          <span style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.6 }}>{selected.notes}</span>
                        </div>
                      </InfoCard>
                    )}

                    {/* If no extra info */}
                    {!selected.leadEmail && !fullAddress && !selected.waterConcern && qaItems.length === 0 && !selected.notes && (
                      <div style={{ textAlign: 'center', padding: '12px 0', color: '#334155', fontSize: 13 }}>
                        No additional info on file for this lead.
                      </div>
                    )}
                  </>
                )
              })()}

              {/* ── JOB MODAL ── */}
              {selected.kind === 'job' && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                      fontSize: 11, padding: '4px 12px', borderRadius: 20, fontWeight: 700,
                      background: `${STATUS_COLOR[selected.status] || '#64748b'}18`,
                      color: STATUS_COLOR[selected.status] || '#64748b',
                      border: `1px solid ${STATUS_COLOR[selected.status] || '#64748b'}35`,
                    }}>
                      {selected.status.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <InfoCard title="Job Details" icon="🔧" accent="#fb923c">
                    {selected.address && <InfoRow icon="📍" label="Address" value={selected.address} />}
                    {selected.techName && <InfoRow icon="👷" label="Technician" value={selected.techName} />}
                  </InfoCard>

                  {selected.products.length > 0 && (
                    <InfoCard title="Products to Install" icon="🏷️" accent="#fb923c">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {selected.products.map((p, i) => (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '9px 12px', borderRadius: 8,
                            background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.2)',
                          }}>
                            <span style={{ fontSize: 14 }}>🏷️</span>
                            <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{p}</span>
                          </div>
                        ))}
                      </div>
                    </InfoCard>
                  )}
                </>
              )}
            </div>

            {/* Footer actions */}
            <div style={{ padding: '14px 20px', borderTop: '1px solid #1e3a4f', display: 'flex', gap: 8, flexShrink: 0, background: '#0d1a26' }}>
              {selected.kind === 'visit' && (
                <button
                  onClick={() => { setSelected(null); navigate(`/leads?lead=${selected.leadId}`) }}
                  style={{
                    flex: 1, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 700,
                    background: 'linear-gradient(135deg, #0d7ea3, #0369a1)', color: '#fff', border: 'none', cursor: 'pointer',
                  }}
                >
                  Open Lead →
                </button>
              )}
              {selected.kind === 'job' && (
                <button
                  onClick={() => { setSelected(null); navigate(`/installations/${selected.id}`) }}
                  style={{
                    flex: 1, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 700,
                    background: 'linear-gradient(135deg, #ea580c, #c2410c)', color: '#fff', border: 'none', cursor: 'pointer',
                  }}
                >
                  Open Install →
                </button>
              )}
              <button
                onClick={() => setSelected(null)}
                style={{
                  padding: '11px 18px', borderRadius: 10, fontSize: 13, color: '#64748b',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid #1e3a4f', cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────

function InfoCard({ title, icon, accent, children }: {
  title: string; icon: string; accent: string; children: React.ReactNode
}) {
  return (
    <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
        borderBottom: '1px solid #1e3a4f',
        background: `${accent}08`,
      }}>
        <span style={{ fontSize: 13 }}>{icon}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</span>
      </div>
      <div style={{ padding: '10px 14px' }}>
        {children}
      </div>
    </div>
  )
}

function InfoRow({ icon, label, value, href, valueColor }: {
  icon: string; label: string; value: string; href?: string; valueColor?: string
}) {
  const content = (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '5px 0' }}>
      <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1, opacity: 0.7 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 13, color: valueColor || '#cbd5e1', fontWeight: 500, wordBreak: 'break-word' }}>{value}</div>
      </div>
    </div>
  )

  if (href) {
    return (
      <a href={href} style={{ textDecoration: 'none', display: 'block' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.8' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
      >
        {content}
      </a>
    )
  }
  return content
}

function parseQualifyingAnswers(answers: Record<string, any>): { label: string; value: string }[] {
  if (!answers || typeof answers !== 'object') return []
  return Object.entries(answers)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => ({
      label: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      value: Array.isArray(v) ? v.join(', ') : String(v),
    }))
    .slice(0, 8)
}
