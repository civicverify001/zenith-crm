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
  return d.toISOString().split('T')[0]
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

  const isAdmin   = role === 'admin'
  const isTech    = role === 'technician'
  const isSales   = role === 'salesrep' || role === 'frontdesk'
  const showVisits = isAdmin || isSales
  const showJobs   = isAdmin || isTech

  // Date range to fetch
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
          .select('id, full_name, phone')
          .in('id', leadIds)
        const lmap: Record<string, any> = Object.fromEntries((leads || []).map((l: any) => [l.id, l]))

        for (const v of visits) {
          const lead = lmap[v.lead_id]
          if (!lead) continue
          all.push({
            kind: 'visit',
            id: v.id,
            date: v.visit_date,
            hour: v.visit_hour,
            leadId: v.lead_id,
            leadName: lead.full_name,
            leadPhone: lead.phone || '',
            repId: v.assigned_rep_id,
            status: v.status,
          })
        }
      }
    }

    // ── Jobs ───────────────────────────────────────────────────
    if (showJobs) {
      let q = supabase
        .from('jobs')
        .select('id, customer_name_snapshot, service_address_snapshot, system_type, status, scheduled_date, assigned_technician_name, source_quote_id')
        .gte('scheduled_date', rangeStart)
        .lte('scheduled_date', rangeEnd)
        .not('status', 'eq', 'cancelled')

      const { data: jobs } = await q
      if (jobs && jobs.length > 0) {
        // Fetch quote line items for product names
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
            date: j.scheduled_date,
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

  // ── Calendar grid helpers ─────────────────────────────────────
  function getMonthDays(): string[] {
    const first = startOfMonth(cursor)
    const last  = endOfMonth(cursor)
    const days: string[] = []
    // Pad start
    for (let i = 0; i < first.getDay(); i++) {
      days.push(isoDate(addDays(first, -first.getDay() + i)))
    }
    // Month days
    let d = new Date(first)
    while (d <= last) { days.push(isoDate(d)); d = addDays(d, 1) }
    // Pad end to complete grid rows
    while (days.length % 7 !== 0) days.push(isoDate(d = addDays(d, 1)))
    return days
  }

  function getWeekDays(): string[] {
    const startOfWeek = addDays(cursor, -cursor.getDay())
    return Array.from({ length: 7 }, (_, i) => isoDate(addDays(startOfWeek, i)))
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

  // ── Period label ──────────────────────────────────────────────
  const periodLabel = view === 'month'
    ? `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`
    : (() => {
        const s = addDays(cursor, -cursor.getDay())
        const e = addDays(s, 6)
        return `${MONTH_NAMES[s.getMonth()]} ${s.getDate()} – ${s.getMonth() !== e.getMonth() ? MONTH_NAMES[e.getMonth()] + ' ' : ''}${e.getDate()}, ${e.getFullYear()}`
      })()

  // ── Event chip color ──────────────────────────────────────────
  function chipColor(ev: CalEvent) {
    if (ev.kind === 'visit') return '#22d3ee'
    return '#fb923c'
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
            {showVisits && showJobs && (
              <span style={{ marginLeft: 12 }}>
                <span style={{ color: '#22d3ee' }}>● site visits</span>
                <span style={{ marginLeft: 8, color: '#fb923c' }}>● installs</span>
              </span>
            )}
            {showVisits && !showJobs && <span style={{ marginLeft: 8, color: '#22d3ee' }}>● site visits</span>}
            {showJobs && !showVisits && <span style={{ marginLeft: 8, color: '#fb923c' }}>● installs</span>}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* View toggle */}
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

          {/* Nav */}
          <button onClick={prevPeriod} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #1e3a4f', background: '#162232', color: '#94a3b8', cursor: 'pointer', fontSize: 14 }}>‹</button>
          <button onClick={goToday} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #1e3a4f', background: '#162232', color: '#94a3b8', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Today</button>
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
          gap: 0,
        }}>
          {days.map((day, idx) => {
            const isThisMonth = new Date(day + 'T00:00:00').getMonth() === cursor.getMonth()
            const isToday = day === today
            const dayEvents = eventsForDay(day)
            const isWeekend = new Date(day + 'T00:00:00').getDay() === 0 || new Date(day + 'T00:00:00').getDay() === 6

            return (
              <div
                key={day}
                style={{
                  borderRight: (idx % 7) < 6 ? '1px solid #1e3a4f' : 'none',
                  borderBottom: idx < days.length - 7 ? '1px solid #1e3a4f' : 'none',
                  background: isWeekend && view === 'month' ? 'rgba(0,0,0,0.1)' : 'transparent',
                  opacity: view === 'month' && !isThisMonth ? 0.35 : 1,
                  padding: '6px 6px 8px',
                  minHeight: view === 'month' ? 90 : undefined,
                  overflow: 'hidden',
                }}
              >
                {/* Date number */}
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

                {/* Event chips */}
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
                        transition: 'all 0.1s',
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

      {/* ── Event Detail Panel ──────────────────────────── */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setSelected(null) }}
        >
          <div style={{
            width: '100%', maxWidth: 420,
            background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 20,
            overflow: 'hidden',
          }}>
            {/* Panel header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 20px', borderBottom: '1px solid #1e3a4f',
              background: `${chipColor(selected)}10`,
              borderTop: `3px solid ${chipColor(selected)}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>{selected.kind === 'visit' ? '📍' : '🔧'}</span>
                <div>
                  <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 15 }}>
                    {selected.kind === 'visit' ? selected.leadName : selected.customerName}
                  </div>
                  <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                    {selected.kind === 'visit' ? `Site Visit · ${formatHour(selected.hour)}` : 'Install Job'}
                    {' · '}
                    {new Date(selected.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </div>
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{ color: '#64748b', background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            {/* Panel body */}
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>

              {selected.kind === 'visit' && (
                <>
                  <DetailRow icon="📞" label="Phone" value={selected.leadPhone || '—'} />
                  <DetailRow icon="📅" label="Time" value={formatHour(selected.hour)} />
                  <StatusPill status={selected.status} color={STATUS_COLOR[selected.status] || '#64748b'} />
                </>
              )}

              {selected.kind === 'job' && (
                <>
                  {selected.address && <DetailRow icon="📍" label="Address" value={selected.address} />}
                  {selected.techName && <DetailRow icon="👷" label="Technician" value={selected.techName} />}
                  <StatusPill status={selected.status} color={STATUS_COLOR[selected.status] || '#64748b'} />

                  {/* Products to install */}
                  {selected.products.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                        Products to Install
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {selected.products.map((p, i) => (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '8px 12px', borderRadius: 8,
                            background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.2)',
                          }}>
                            <span style={{ fontSize: 14 }}>🏷️</span>
                            <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{p}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Panel footer actions */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid #1e3a4f', display: 'flex', gap: 8 }}>
              {selected.kind === 'visit' && (
                <button
                  onClick={() => { setSelected(null); navigate(`/leads?lead=${selected.leadId}`) }}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 10, fontSize: 13, fontWeight: 700,
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
                    flex: 1, padding: '10px 0', borderRadius: 10, fontSize: 13, fontWeight: 700,
                    background: 'linear-gradient(135deg, #ea580c, #c2410c)', color: '#fff', border: 'none', cursor: 'pointer',
                  }}
                >
                  Open Install →
                </button>
              )}
              <button
                onClick={() => setSelected(null)}
                style={{
                  padding: '10px 16px', borderRadius: 10, fontSize: 13, color: '#64748b',
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

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
        <div style={{ fontSize: 13, color: '#e2e8f0', marginTop: 2 }}>{value}</div>
      </div>
    </div>
  )
}

function StatusPill({ status, color }: { status: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</span>
      <span style={{
        fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 700,
        background: `${color}18`, color, border: `1px solid ${color}35`,
      }}>
        {status.replace(/_/g, ' ')}
      </span>
    </div>
  )
}
