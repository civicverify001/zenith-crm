// src/modules/schedule/MySchedulePage.tsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'

// ─── Types ─────────────────────────────────────────────────────────
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

// ─── Helpers ───────────────────────────────────────────────────────
function formatHour(h: number) {
  if (h === 0) return '12:00 AM'
  if (h < 12) return `${h}:00 AM`
  if (h === 12) return '12:00 PM'
  return `${h - 12}:00 PM`
}

function isoDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function endOfMonth(d: Date)   { return new Date(d.getFullYear(), d.getMonth() + 1, 0) }

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_NAMES_FULL  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const DAY_NAMES_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

const STATUS_COLOR: Record<string, string> = {
  scheduled: '#60a5fa', confirmed: '#60a5fa',
  in_progress: '#22d3ee', complete: '#4ade80',
  cancelled: '#64748b', pending: '#fbbf24',
}

const SYSTEM_LABELS: Record<string, string> = {
  ro: 'RO System', ro_install: 'RO System',
  softener: 'Water Softener', softener_only: 'Water Softener',
  whole_home_filter: 'Whole Home Filter', iron_filter: 'Iron Filter',
  dual_tank: 'Dual Tank', advanced_softener: 'Advanced Softener',
}

// ─── Main Component ─────────────────────────────────────────────────
export function MySchedulePage() {
  const { profile, role } = useAuth()
  const navigate = useNavigate()

  const [view, setView]         = useState<'month' | 'week'>('month')
  const [cursor, setCursor]     = useState(new Date())
  const [events, setEvents]     = useState<CalEvent[]>([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState<CalEvent | null>(null)
  const [questionLabels, setQuestionLabels] = useState<Record<string, string>>({})

  const isAdmin    = role === 'admin'
  const isTech     = role === 'technician'
  const isSales    = role === 'salesrep' || role === 'frontdesk'
  const showVisits = isAdmin || isSales
  const showJobs   = isAdmin || isTech

  const rangeStart = view === 'month'
    ? isoDate(addDays(startOfMonth(cursor), -6))
    : isoDate(addDays(cursor, -cursor.getDay()))
  const rangeEnd = view === 'month'
    ? isoDate(addDays(endOfMonth(cursor), 6))
    : isoDate(addDays(cursor, 6 - cursor.getDay()))

  // Fetch qualifying question labels once (uuid → text)
  useEffect(() => {
    supabase
      .from('qualifying_questions')
      .select('id, question_text')
      .then(({ data }) => {
        if (data) {
          const map: Record<string, string> = {}
          for (const q of data) map[q.id] = q.question_text
          setQuestionLabels(map)
        }
      })
  }, [])

  useEffect(() => {
    if (!profile?.id) return
    fetchEvents()
  }, [profile?.id, rangeStart, rangeEnd, role])

  async function fetchEvents() {
    setLoading(true)
    const all: CalEvent[] = []

    if (showVisits) {
      let q = supabase
        .from('site_visits')
        .select('id, lead_id, assigned_rep_id, visit_date, visit_hour, status')
        .gte('visit_date', rangeStart).lte('visit_date', rangeEnd)
        .not('status', 'eq', 'cancelled')
      if (!isAdmin) q = q.eq('assigned_rep_id', profile!.id)

      const { data: visits } = await q
      if (visits?.length) {
        const leadIds = [...new Set(visits.map((v: any) => v.lead_id).filter(Boolean))]
        const { data: leads } = await supabase
          .from('leads')
          .select('id, full_name, phone, email, address, city, state, zip, water_concern, notes, qualifying_answers')
          .in('id', leadIds)
        const lmap: Record<string, any> = Object.fromEntries((leads || []).map((l: any) => [l.id, l]))

        for (const v of visits) {
          const lead = lmap[v.lead_id]
          if (!lead) continue
          all.push({
            kind: 'visit', id: v.id,
            date: v.visit_date, hour: v.visit_hour,
            leadId: v.lead_id, leadName: lead.full_name,
            leadPhone: lead.phone || '', leadEmail: lead.email || '',
            leadAddress: lead.address || '', leadCity: lead.city || '',
            leadState: lead.state || '', leadZip: lead.zip || '',
            waterConcern: lead.water_concern || '',
            notes: lead.notes || '',
            qualifyingAnswers: lead.qualifying_answers || {},
            repId: v.assigned_rep_id, status: v.status,
          })
        }
      }
    }

    if (showJobs) {
      // FIX: removed assigned_technician_name (doesn't exist) → assigned_technician_id
      // FIX: removed .not('status', 'eq', 'cancelled') — 'cancelled' not in job_status_enum
      const { data: jobs } = await supabase
        .from('jobs')
        .select('id, customer_name_snapshot, service_address_snapshot, system_type, status, scheduled_date, assigned_technician_id, source_quote_id')
        .gte('scheduled_date', rangeStart).lte('scheduled_date', rangeEnd)

      if (jobs?.length) {
        // Fetch tech names from user_profiles for assigned jobs
        const techIds = [...new Set(jobs.map((j: any) => j.assigned_technician_id).filter(Boolean))]
        let techMap: Record<string, string> = {}
        if (techIds.length) {
          const { data: profiles } = await supabase
            .from('user_profiles')
            .select('id, full_name')
            .in('id', techIds)
          techMap = Object.fromEntries((profiles || []).map((p: any) => [p.id, p.full_name]))
        }

        const quoteIds = [...new Set(jobs.map((j: any) => j.source_quote_id).filter(Boolean))]
        let lineMap: Record<string, string[]> = {}
        if (quoteIds.length) {
          const { data: lines } = await supabase
            .from('quote_line_items').select('quote_id, description').in('quote_id', quoteIds)
          if (lines) for (const l of lines) {
            if (!lineMap[l.quote_id]) lineMap[l.quote_id] = []
            lineMap[l.quote_id].push(l.description)
          }
        }

        for (const j of jobs) {
          const products = j.source_quote_id && lineMap[j.source_quote_id]
            ? lineMap[j.source_quote_id]
            : [SYSTEM_LABELS[j.system_type] || j.system_type || 'Install'].filter(Boolean)
          all.push({
            kind: 'job', id: j.id,
            date: (j.scheduled_date || '').split('T')[0],
            customerName: j.customer_name_snapshot || 'Unknown',
            address: j.service_address_snapshot || '',
            systemType: j.system_type || '', status: j.status,
            techName: j.assigned_technician_id ? (techMap[j.assigned_technician_id] || '') : '',
            products,
          })
        }
      }
    }

    setEvents(all)
    setLoading(false)
  }

  // Calendar grid helpers
  function getMonthDays(): string[] {
    const first = startOfMonth(cursor), last = endOfMonth(cursor)
    const days: string[] = []
    for (let i = 0; i < first.getDay(); i++) days.push(isoDate(addDays(first, -first.getDay() + i)))
    let d = new Date(first)
    while (d <= last) { days.push(isoDate(d)); d = addDays(d, 1) }
    while (days.length % 7 !== 0) days.push(isoDate(d = addDays(d, 1)))
    return days
  }

  function getWeekDays(): string[] {
    const s = addDays(cursor, -cursor.getDay())
    return Array.from({ length: 7 }, (_, i) => isoDate(addDays(s, i)))
  }

  const days  = view === 'month' ? getMonthDays() : getWeekDays()
  const today = isoDate(new Date())

  function eventsForDay(d: string) { return events.filter(e => e.date === d) }

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
        const s = addDays(cursor, -cursor.getDay()), e = addDays(s, 6)
        return `${MONTH_NAMES[s.getMonth()]} ${s.getDate()} – ${
          s.getMonth() !== e.getMonth() ? MONTH_NAMES[e.getMonth()] + ' ' : ''
        }${e.getDate()}, ${e.getFullYear()}`
      })()

  function chipColor(ev: CalEvent) { return ev.kind === 'visit' ? '#22d3ee' : '#fb923c' }

  function resolveQA(answers: Record<string, any>): { label: string; value: string }[] {
    if (!answers || typeof answers !== 'object') return []
    return Object.entries(answers)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => ({
        label: questionLabels[k] || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        value: Array.isArray(v) ? v.join(', ') : String(v),
      }))
      .slice(0, 10)
  }

  // Upcoming list for mobile
  const todayStr = isoDate(new Date())
  const in14     = isoDate(addDays(new Date(), 14))
  const upcoming = events
    .filter(e => e.date >= todayStr && e.date <= in14)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      const ah = a.kind === 'visit' ? a.hour : 0
      const bh = b.kind === 'visit' ? b.hour : 0
      return ah - bh
    })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        marginBottom: 16, flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <h1 style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 22, margin: 0, letterSpacing: '-0.01em' }}>
            {isTech ? 'My Install Schedule' : isSales ? 'My Visit Schedule' : 'Team Schedule'}
          </h1>
          <p style={{ color: '#475569', fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            {loading ? 'Loading…' : `${events.length} event${events.length !== 1 ? 's' : ''} in view`}
            {showVisits && <span style={{ marginLeft: 10, color: '#22d3ee', fontSize: 12 }}>● site visits</span>}
            {showJobs   && <span style={{ marginLeft: 10, color: '#fb923c', fontSize: 12 }}>● installs</span>}
          </p>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* View toggle */}
          <div style={{ display: 'flex', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 10, overflow: 'hidden' }}>
            {(['month', 'week'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none',
                background: view === v ? '#0d7ea3' : 'transparent',
                color: view === v ? '#fff' : '#64748b',
                transition: 'all 0.15s',
              }}>
                {v === 'month' ? 'Month' : 'Week'}
              </button>
            ))}
          </div>
          {/* Nav */}
          <button onClick={prevPeriod} style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid #1e3a4f', background: '#162232', color: '#94a3b8', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
          <button onClick={goToday}   style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #1e3a4f', background: '#162232', color: '#94a3b8', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Today</button>
          <button onClick={nextPeriod} style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid #1e3a4f', background: '#162232', color: '#94a3b8', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
          <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14, minWidth: 160, textAlign: 'center' }}>{periodLabel}</span>
        </div>
      </div>

      {/* ── MOBILE: Upcoming list ───────────────────────────────── */}
      <div className="block md:hidden" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#475569', fontSize: 14 }}>Loading…</div>
        ) : upcoming.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
            <div style={{ color: '#475569', fontSize: 15, fontWeight: 600 }}>No upcoming events</div>
            <div style={{ color: '#334155', fontSize: 13, marginTop: 6 }}>Next 14 days are clear</div>
          </div>
        ) : (
          (() => {
            let lastDate = ''
            return upcoming.map(ev => {
              const showHeader = ev.date !== lastDate
              lastDate = ev.date
              const isEvToday  = ev.date === todayStr
              const isTomorrow = ev.date === isoDate(addDays(new Date(), 1))
              const dateLabel  = isEvToday ? 'Today' : isTomorrow ? 'Tomorrow'
                : new Date(ev.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
              const accent = chipColor(ev)

              return (
                <div key={ev.id}>
                  {showHeader && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, marginTop: lastDate && lastDate !== ev.date ? 4 : 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: isEvToday ? '#0d7ea3' : '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {dateLabel}
                      </span>
                      <div style={{ flex: 1, height: 1, background: '#1e3a4f' }} />
                    </div>
                  )}
                  <button
                    onClick={() => setSelected(ev)}
                    style={{
                      width: '100%', textAlign: 'left', cursor: 'pointer',
                      background: '#0f1923', border: `1px solid ${accent}30`,
                      borderLeft: `4px solid ${accent}`, borderRadius: 14, padding: '14px 16px',
                      display: 'flex', alignItems: 'center', gap: 14, transition: 'background 0.12s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#162232' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#0f1923' }}
                  >
                    {/* Icon */}
                    <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: `${accent}15`, border: `1px solid ${accent}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                      {ev.kind === 'visit' ? '📍' : '🔧'}
                    </div>
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ev.kind === 'visit' ? ev.leadName : ev.customerName}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
                        {ev.kind === 'visit'
                          ? `${formatHour(ev.hour)} · Site Visit`
                          : `${SYSTEM_LABELS[ev.systemType] || ev.systemType || 'Install'}${ev.techName ? ` · ${ev.techName}` : ''}`
                        }
                      </div>
                      {ev.kind === 'visit' && ev.leadPhone && (
                        <div style={{ fontSize: 12, color: '#22d3ee', marginTop: 2 }}>{ev.leadPhone}</div>
                      )}
                      {ev.kind === 'job' && ev.address && (
                        <div style={{ fontSize: 11, color: '#475569', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.address}</div>
                      )}
                    </div>
                    {/* Status badge */}
                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                      <span style={{ fontSize: 10, padding: '3px 9px', borderRadius: 20, fontWeight: 700, background: `${STATUS_COLOR[ev.status] || '#64748b'}18`, color: STATUS_COLOR[ev.status] || '#64748b', border: `1px solid ${STATUS_COLOR[ev.status] || '#64748b'}30`, display: 'block', whiteSpace: 'nowrap' }}>
                        {ev.status.replace(/_/g, ' ')}
                      </span>
                      <div style={{ fontSize: 10, color: '#334155', marginTop: 4 }}>tap to view</div>
                    </div>
                  </button>
                </div>
              )
            })
          })()
        )}
      </div>

      {/* ── DESKTOP: Full calendar grid ─────────────────────────── */}
      <div
        className="hidden md:flex"
        style={{ flex: 1, overflow: 'hidden', flexDirection: 'column', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 16 }}
      >
        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #1e3a4f', flexShrink: 0 }}>
          {DAY_NAMES_SHORT.map(d => (
            <div key={d} style={{ padding: '10px 8px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {d}
            </div>
          ))}
        </div>

        {/* Grid cells */}
        <div style={{
          flex: 1, overflowY: 'auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gridTemplateRows: view === 'month' ? `repeat(${days.length / 7}, 1fr)` : '1fr',
        }}>
          {days.map((day, idx) => {
            const isThisMonth = new Date(day + 'T00:00:00').getMonth() === cursor.getMonth()
            const isToday     = day === today
            const dayEvents   = eventsForDay(day)
            const isWeekend   = [0, 6].includes(new Date(day + 'T00:00:00').getDay())
            return (
              <div key={day} style={{
                borderRight: (idx % 7) < 6 ? '1px solid #1e3a4f' : 'none',
                borderBottom: idx < days.length - 7 ? '1px solid #1e3a4f' : 'none',
                background: isWeekend && view === 'month' ? 'rgba(0,0,0,0.1)' : 'transparent',
                opacity: view === 'month' && !isThisMonth ? 0.35 : 1,
                padding: '6px 6px 8px', minHeight: view === 'month' ? 100 : undefined, overflow: 'hidden',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isToday ? '#0d7ea3' : 'transparent',
                    color: isToday ? '#fff' : '#94a3b8',
                    fontSize: 13, fontWeight: isToday ? 800 : 500,
                    boxShadow: isToday ? '0 0 10px rgba(13,126,163,0.4)' : 'none',
                  }}>
                    {new Date(day + 'T00:00:00').getDate()}
                  </div>
                  {dayEvents.length > 0 && <span style={{ fontSize: 10, color: '#475569', fontWeight: 600 }}>{dayEvents.length}</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {(view === 'month' ? dayEvents.slice(0, 3) : dayEvents).map(ev => (
                    <button key={ev.id} onClick={() => setSelected(ev)} style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '4px 8px', borderRadius: 6,
                      background: `${chipColor(ev)}18`, border: `1px solid ${chipColor(ev)}35`,
                      cursor: 'pointer', textAlign: 'left', width: '100%',
                    }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${chipColor(ev)}30` }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `${chipColor(ev)}18` }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: chipColor(ev), flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: '#e2e8f0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {ev.kind === 'visit' ? `${formatHour(ev.hour)} ${ev.leadName}` : ev.customerName}
                      </span>
                    </button>
                  ))}
                  {view === 'month' && dayEvents.length > 3 && (
                    <button onClick={() => { setCursor(new Date(day + 'T00:00:00')); setView('week') }}
                      style={{ fontSize: 10, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '0 8px' }}>
                      +{dayEvents.length - 3} more
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Event Detail Modal ──────────────────────────────────── */}
      {selected && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            display: 'flex', alignItems: 'flex-end',
            justifyContent: 'center', padding: '0',
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
          }}
          className="sm:items-center sm:p-4"
          onClick={e => { if (e.target === e.currentTarget) setSelected(null) }}
        >
          <div style={{
            width: '100%', maxWidth: 560,
            background: '#0f1923',
            border: '1px solid #1e3a4f',
            borderTop: `3px solid ${chipColor(selected)}`,
            borderRadius: '20px 20px 0 0',
            maxHeight: '92vh',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}
            className="sm:rounded-[20px]"
          >
            {/* Drag handle — mobile */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden" style={{ flexShrink: 0 }}>
              <div style={{ width: 40, height: 4, borderRadius: 4, background: '#1e3a4f' }} />
            </div>

            {/* Modal header */}
            <div style={{
              flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 20px 16px',
              background: `linear-gradient(135deg, ${chipColor(selected)}10, transparent)`,
              borderBottom: '1px solid #1e3a4f',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                  background: `${chipColor(selected)}18`, border: `1px solid ${chipColor(selected)}30`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                }}>
                  {selected.kind === 'visit' ? '📍' : '🔧'}
                </div>
                <div>
                  <div style={{ color: '#f1f5f9', fontWeight: 800, fontSize: 17, letterSpacing: '-0.01em' }}>
                    {selected.kind === 'visit' ? selected.leadName : selected.customerName}
                  </div>
                  <div style={{ color: '#64748b', fontSize: 13, marginTop: 3 }}>
                    {selected.kind === 'visit'
                      ? `Site Visit · ${formatHour(selected.hour)}`
                      : `Install · ${SYSTEM_LABELS[selected.systemType] || selected.systemType || 'Job'}`}
                    {' · '}
                    {new Date(selected.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </div>
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{
                color: '#475569', background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f',
                borderRadius: 8, width: 34, height: 34, fontSize: 18, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>×</button>
            </div>

            {/* Scrollable body */}
            <div style={{
              flex: 1, overflowY: 'auto', overflowX: 'hidden',
              padding: '20px 20px',
              display: 'flex', flexDirection: 'column', gap: 14,
              WebkitOverflowScrolling: 'touch',
            }}>

              {/* ── VISIT body ── */}
              {selected.kind === 'visit' && (() => {
                const fullAddr = [selected.leadAddress, selected.leadCity, selected.leadState, selected.leadZip].filter(Boolean).join(', ')
                const qaItems  = resolveQA(selected.qualifyingAnswers)
                return (
                  <>
                    {/* Status + time row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 12, padding: '5px 14px', borderRadius: 20, fontWeight: 700,
                        background: `${STATUS_COLOR[selected.status] || '#64748b'}18`,
                        color: STATUS_COLOR[selected.status] || '#64748b',
                        border: `1px solid ${STATUS_COLOR[selected.status] || '#64748b'}35`,
                      }}>
                        {selected.status.replace(/_/g, ' ')}
                      </span>
                      <span style={{ fontSize: 13, color: '#64748b' }}>🕐 {formatHour(selected.hour)}</span>
                      <span style={{ fontSize: 13, color: '#64748b' }}>
                        📅 {DAY_NAMES_FULL[new Date(selected.date + 'T00:00:00').getDay()]}, {new Date(selected.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                      </span>
                    </div>

                    {/* Contact */}
                    <InfoCard title="Contact Information" icon="👤" accent="#38bdf8">
                      <InfoRow icon="📞" label="Phone" value={selected.leadPhone || '—'} href={selected.leadPhone ? `tel:${selected.leadPhone}` : undefined} valueColor="#38bdf8" />
                      {selected.leadEmail && <InfoRow icon="✉️" label="Email" value={selected.leadEmail} href={`mailto:${selected.leadEmail}`} valueColor="#38bdf8" />}
                      {fullAddr && <InfoRow icon="📍" label="Address" value={fullAddr} />}
                    </InfoCard>

                    {/* Water concern */}
                    {selected.waterConcern && (
                      <InfoCard title="Water Concern" icon="💧" accent="#22d3ee">
                        <div style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.15)' }}>
                          <span style={{ fontSize: 14, color: '#e2e8f0', fontWeight: 500, lineHeight: 1.5 }}>{selected.waterConcern}</span>
                        </div>
                      </InfoCard>
                    )}

                    {/* Qualifying answers with real labels */}
                    {qaItems.length > 0 && (
                      <InfoCard title="Qualifying Answers" icon="📋" accent="#818cf8">
                        {qaItems.map((item, i) => (
                          <div key={i} style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16,
                            padding: '10px 0',
                            borderBottom: i < qaItems.length - 1 ? '1px solid #0d1a26' : 'none',
                          }}>
                            <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500, flex: 1, lineHeight: 1.4 }}>{item.label}</span>
                            <span style={{ fontSize: 13, color: '#cbd5e1', fontWeight: 700, textAlign: 'right', flexShrink: 0, maxWidth: '55%', lineHeight: 1.4 }}>{item.value}</span>
                          </div>
                        ))}
                      </InfoCard>
                    )}

                    {/* Notes */}
                    {selected.notes && (
                      <InfoCard title="Notes" icon="📝" accent="#fbbf24">
                        <div style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)' }}>
                          <span style={{ fontSize: 14, color: '#e2e8f0', lineHeight: 1.6 }}>{selected.notes}</span>
                        </div>
                      </InfoCard>
                    )}

                    {!selected.leadEmail && !fullAddr && !selected.waterConcern && qaItems.length === 0 && !selected.notes && (
                      <div style={{ textAlign: 'center', padding: '20px 0', color: '#334155', fontSize: 14 }}>No additional info on file for this lead.</div>
                    )}
                  </>
                )
              })()}

              {/* ── JOB body ── */}
              {selected.kind === 'job' && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 12, padding: '5px 14px', borderRadius: 20, fontWeight: 700,
                      background: `${STATUS_COLOR[selected.status] || '#64748b'}18`,
                      color: STATUS_COLOR[selected.status] || '#64748b',
                      border: `1px solid ${STATUS_COLOR[selected.status] || '#64748b'}35`,
                    }}>
                      {selected.status.replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontSize: 13, color: '#64748b' }}>
                      📅 {DAY_NAMES_FULL[new Date(selected.date + 'T00:00:00').getDay()]}, {new Date(selected.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                    </span>
                  </div>

                  <InfoCard title="Job Details" icon="🔧" accent="#fb923c">
                    {selected.address  && <InfoRow icon="📍" label="Address"    value={selected.address}  />}
                    {selected.techName && <InfoRow icon="👷" label="Technician" value={selected.techName} />}
                  </InfoCard>

                  {selected.products.length > 0 && (
                    <InfoCard title="Products to Install" icon="🏷️" accent="#fb923c">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {selected.products.map((p, i) => (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '11px 14px', borderRadius: 10,
                            background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.2)',
                          }}>
                            <span style={{ fontSize: 16 }}>🏷️</span>
                            <span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{p}</span>
                          </div>
                        ))}
                      </div>
                    </InfoCard>
                  )}
                </>
              )}
            </div>

            {/* Fixed footer */}
            <div style={{
              flexShrink: 0, padding: '14px 20px 20px',
              borderTop: '1px solid #1e3a4f', display: 'flex', gap: 10,
              background: '#0d1a26',
            }}>
              {selected.kind === 'visit' && (
                <button
                  onClick={() => { setSelected(null); navigate(`/leads?lead=${selected.leadId}`) }}
                  style={{
                    flex: 1, padding: '13px 0', borderRadius: 12, fontSize: 14, fontWeight: 800,
                    background: 'linear-gradient(135deg, #0d7ea3, #0369a1)', color: '#fff', border: 'none', cursor: 'pointer',
                    letterSpacing: '-0.01em',
                  }}
                >
                  Open Lead →
                </button>
              )}
              {selected.kind === 'job' && (
                <button
                  onClick={() => { setSelected(null); navigate(`/installations/${selected.id}`) }}
                  style={{
                    flex: 1, padding: '13px 0', borderRadius: 12, fontSize: 14, fontWeight: 800,
                    background: 'linear-gradient(135deg, #ea580c, #c2410c)', color: '#fff', border: 'none', cursor: 'pointer',
                    letterSpacing: '-0.01em',
                  }}
                >
                  Open Install →
                </button>
              )}
              <button
                onClick={() => setSelected(null)}
                style={{
                  padding: '13px 20px', borderRadius: 12, fontSize: 14, color: '#64748b',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid #1e3a4f', cursor: 'pointer', fontWeight: 600,
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

// ─── Sub-components ──────────────────────────────────────────────────

function InfoCard({ title, icon, accent, children }: {
  title: string; icon: string; accent: string; children: React.ReactNode
}) {
  return (
    <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
        borderBottom: '1px solid #1e3a4f', background: `${accent}08`,
      }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{title}</span>
      </div>
      <div style={{ padding: '10px 14px' }}>{children}</div>
    </div>
  )
}

function InfoRow({ icon, label, value, href, valueColor }: {
  icon: string; label: string; value: string; href?: string; valueColor?: string
}) {
  const inner = (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '7px 0' }}>
      <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1, opacity: 0.7 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 14, color: valueColor || '#cbd5e1', fontWeight: 500, wordBreak: 'break-word', lineHeight: 1.4 }}>{value}</div>
      </div>
    </div>
  )
  if (href) return (
    <a href={href} style={{ textDecoration: 'none', display: 'block' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.8' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
    >{inner}</a>
  )
  return inner
}
