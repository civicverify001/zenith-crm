import { useState, useMemo, useEffect } from 'react'
import { useJobsBoard } from './useJobs'
import { JobCard } from './JobCard'
import { JobDrawer } from './JobDrawer'
import type { Job, JobStatus } from './dispatch.types'
import { DISPATCH_COLUMNS, JOB_STATUS_LABELS, JOB_STATUS_COLORS, SYSTEM_TYPE_LABELS } from './dispatch.types'
import { useAuth } from '../../hooks/useAuth'

const STATUS_COLORS: Record<JobStatus, string> = {
  scheduled: 'border-t-accent',
  waiting_for_stock: 'border-t-amber',
  in_progress: 'border-t-cyan',
  complete: 'border-t-green',
}

const STATUS_DOT: Record<JobStatus, string> = {
  scheduled: 'bg-accent',
  waiting_for_stock: 'bg-amber',
  in_progress: 'bg-cyan',
  complete: 'bg-green',
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

// ── Mobile helper ─────────────────────────────────────────────
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return isMobile
}

// ── Stats Bar ─────────────────────────────────────────────────
function StatsBar({ allJobs }: { allJobs: Job[] }) {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

  const scheduled   = allJobs.filter(j => j.status === 'scheduled')
  const inProgress  = allJobs.filter(j => j.status === 'in_progress')
  const waiting     = allJobs.filter(j => j.status === 'waiting_for_stock')
  const complete    = allJobs.filter(j => j.status === 'complete')
  const todayJobs   = allJobs.filter(j => j.scheduled_date?.split('T')[0] === todayStr)
  const completedToday = todayJobs.filter(j => j.status === 'complete')
  const unassigned  = allJobs.filter(j => !j.assigned_technician_id && j.status === 'scheduled')

  const stats = [
    {
      label: 'Scheduled',
      value: scheduled.length,
      icon: '📅',
      color: '#60a5fa',
      bg: 'rgba(96,165,250,0.1)',
      border: 'rgba(96,165,250,0.2)',
    },
    {
      label: 'In Progress',
      value: inProgress.length,
      icon: '⚡',
      color: '#22d3ee',
      bg: 'rgba(34,211,238,0.1)',
      border: 'rgba(34,211,238,0.2)',
    },
    {
      label: 'Waiting Stock',
      value: waiting.length,
      icon: '📦',
      color: '#f59e0b',
      bg: 'rgba(245,158,11,0.1)',
      border: 'rgba(245,158,11,0.2)',
    },
    {
      label: 'Complete',
      value: complete.length,
      icon: '✅',
      color: '#4ade80',
      bg: 'rgba(74,222,128,0.1)',
      border: 'rgba(74,222,128,0.2)',
    },
    {
      label: "Today's Jobs",
      value: todayJobs.length,
      icon: '🗓️',
      color: '#a78bfa',
      bg: 'rgba(167,139,250,0.1)',
      border: 'rgba(167,139,250,0.2)',
    },
    {
      label: 'Done Today',
      value: completedToday.length,
      icon: '🏁',
      color: '#34d399',
      bg: 'rgba(52,211,153,0.1)',
      border: 'rgba(52,211,153,0.2)',
    },
  ]

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(6, 1fr)',
      gap: 10,
      marginBottom: 16,
      flexShrink: 0,
    }}>
      {stats.map(s => (
        <div key={s.label} style={{
          background: s.bg,
          border: `1px solid ${s.border}`,
          borderRadius: 12,
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Glow orb */}
          <div style={{
            position: 'absolute', top: -12, right: -12,
            width: 50, height: 50, borderRadius: '50%',
            background: `${s.color}20`, pointerEvents: 'none',
          }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14 }}>{s.icon}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{s.label}</span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: s.color, lineHeight: 1, letterSpacing: '-0.02em' }}>
            {s.value}
          </div>
          {s.label === 'Scheduled' && unassigned.length > 0 && (
            <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 600 }}>
              ⚠ {unassigned.length} unassigned
            </div>
          )}
          {s.label === "Today's Jobs" && completedToday.length > 0 && todayJobs.length > 0 && (
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>
              {completedToday.length}/{todayJobs.length} done
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// Mobile compact stats (2-col grid)
function MobileStatsBar({ allJobs }: { allJobs: Job[] }) {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

  const inProgress     = allJobs.filter(j => j.status === 'in_progress').length
  const scheduled      = allJobs.filter(j => j.status === 'scheduled').length
  const complete       = allJobs.filter(j => j.status === 'complete').length
  const todayJobs      = allJobs.filter(j => j.scheduled_date?.split('T')[0] === todayStr).length
  const completedToday = allJobs.filter(j => j.status === 'complete' && j.scheduled_date?.split('T')[0] === todayStr).length
  const unassigned     = allJobs.filter(j => !j.assigned_technician_id && j.status === 'scheduled').length

  const stats = [
    { label: 'Scheduled',   value: scheduled,      color: '#60a5fa', icon: '📅' },
    { label: 'In Progress', value: inProgress,      color: '#22d3ee', icon: '⚡' },
    { label: "Today",       value: todayJobs,       color: '#a78bfa', icon: '🗓️', sub: completedToday > 0 ? `${completedToday} done` : undefined },
    { label: 'Complete',    value: complete,        color: '#4ade80', icon: '✅', sub: unassigned > 0 ? `⚠ ${unassigned} unassigned` : undefined },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12, flexShrink: 0 }}>
      {stats.map(s => (
        <div key={s.label} style={{
          background: `${s.color}10`,
          border: `1px solid ${s.color}25`,
          borderRadius: 10, padding: '10px 10px 8px',
        }}>
          <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            {s.icon} {s.label}
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: s.color, lineHeight: 1 }}>{s.value}</div>
          {s.sub && <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 600, marginTop: 3 }}>{s.sub}</div>}
        </div>
      ))}
    </div>
  )
}

// ── Calendar Day Cell ─────────────────────────────────────────
function CalendarDay({
  date, isCurrentMonth, isToday, jobs, onJobClick, onDayClick, selected,
}: {
  date: Date; isCurrentMonth: boolean; isToday: boolean; jobs: Job[]
  onJobClick: (job: Job) => void; onDayClick: (date: Date) => void; selected: boolean
}) {
  const scheduled  = jobs.filter(j => j.status === 'scheduled')
  const inProgress = jobs.filter(j => j.status === 'in_progress')
  const waiting    = jobs.filter(j => j.status === 'waiting_for_stock')
  const complete   = jobs.filter(j => j.status === 'complete')

  return (
    <div
      onClick={() => onDayClick(date)}
      className={`
        min-h-[110px] rounded-xl border p-2 cursor-pointer transition-all
        ${isCurrentMonth ? 'bg-surface border-border' : 'bg-surface/30 border-border/30'}
        ${isToday ? 'ring-2 ring-accent border-accent' : ''}
        ${selected ? 'ring-2 ring-cyan border-cyan' : ''}
        ${jobs.length > 0 ? 'hover:border-accent/60' : 'hover:border-border/60'}
      `}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className={`
          text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full
          ${isToday ? 'bg-accent text-white' : isCurrentMonth ? 'text-slate-300' : 'text-muted'}
        `}>
          {date.getDate()}
        </span>
        {jobs.length > 0 && (
          <span className="text-xs text-muted font-semibold">{jobs.length} job{jobs.length !== 1 ? 's' : ''}</span>
        )}
      </div>
      {jobs.length > 0 && (
        <div className="flex gap-1 mb-1.5 flex-wrap">
          {scheduled.length  > 0 && <span className="text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent font-semibold">{scheduled.length} sched</span>}
          {inProgress.length > 0 && <span className="text-xs px-1.5 py-0.5 rounded bg-cyan/20 text-cyan font-semibold">{inProgress.length} active</span>}
          {waiting.length    > 0 && <span className="text-xs px-1.5 py-0.5 rounded bg-amber/20 text-amber font-semibold">{waiting.length} wait</span>}
          {complete.length   > 0 && <span className="text-xs px-1.5 py-0.5 rounded bg-green/20 text-green font-semibold">{complete.length} done</span>}
        </div>
      )}
      <div className="space-y-1">
        {jobs.slice(0, 3).map(job => (
          <div key={job.id} onClick={e => { e.stopPropagation(); onJobClick(job) }}
            className="flex items-center gap-1.5 bg-card rounded px-1.5 py-1 hover:bg-card/80 transition-colors cursor-pointer group">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[job.status]}`} />
            <span className="text-xs text-slate-300 truncate group-hover:text-white transition-colors">
              {job.customer_name_snapshot}
            </span>
          </div>
        ))}
        {jobs.length > 3 && <div className="text-xs text-muted pl-1">+{jobs.length - 3} more</div>}
      </div>
      {jobs.length === 0 && isCurrentMonth && (
        <div className="text-xs text-muted/40 mt-2 text-center">open</div>
      )}
    </div>
  )
}

// ── Day Detail Drawer ─────────────────────────────────────────
function DayDetailPanel({ date, jobs, onJobClick, onClose }: {
  date: Date | null; jobs: Job[]; onJobClick: (job: Job) => void; onClose: () => void
}) {
  if (!date) return null
  const label = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const byStatus: Record<JobStatus, Job[]> = {
    scheduled: jobs.filter(j => j.status === 'scheduled'),
    waiting_for_stock: jobs.filter(j => j.status === 'waiting_for_stock'),
    in_progress: jobs.filter(j => j.status === 'in_progress'),
    complete: jobs.filter(j => j.status === 'complete'),
  }
  return (
    <div className="w-80 flex-shrink-0 bg-surface border border-border rounded-xl overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <div className="text-sm font-bold text-white">{label}</div>
          <div className="text-xs text-muted mt-0.5">
            {jobs.length === 0 ? 'No installs scheduled' : `${jobs.length} job${jobs.length !== 1 ? 's' : ''}`}
          </div>
        </div>
        <button onClick={onClose} className="text-muted hover:text-white text-lg leading-none">×</button>
      </div>
      <div className="overflow-y-auto flex-1 p-3 space-y-4">
        {jobs.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-3xl mb-2">📅</div>
            <div className="text-sm text-muted">Open slot — no installs scheduled</div>
          </div>
        ) : (
          (['scheduled','in_progress','waiting_for_stock','complete'] as JobStatus[]).map(status => {
            const statusJobs = byStatus[status]
            if (!statusJobs.length) return null
            return (
              <div key={status}>
                <div className="text-xs font-bold text-muted uppercase tracking-wide mb-2">
                  {JOB_STATUS_LABELS[status]} ({statusJobs.length})
                </div>
                <div className="space-y-2">
                  {statusJobs.map(job => (
                    <div key={job.id} onClick={() => onJobClick(job)}
                      className="bg-card border border-border rounded-lg p-3 cursor-pointer hover:border-accent/50 transition-colors">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="text-sm font-semibold text-white leading-tight">{job.customer_name_snapshot}</div>
                        <span className={`text-xs px-1.5 py-0.5 rounded border font-semibold flex-shrink-0 ${JOB_STATUS_COLORS[job.status]}`}>
                          {JOB_STATUS_LABELS[job.status]}
                        </span>
                      </div>
                      <div className="text-xs text-muted">{SYSTEM_TYPE_LABELS[job.system_type]}</div>
                      <div className="text-xs text-muted mt-1 truncate">{job.service_address_snapshot}</div>
                      {job.assigned_technician && (
                        <div className="text-xs text-accent mt-1">🔧 {job.assigned_technician.full_name}</div>
                      )}
                      {!job.assigned_technician && (
                        <div className="text-xs text-amber mt-1">⚠ Unassigned</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Calendar View (Desktop) ───────────────────────────────────
function CalendarView({ allJobs, onJobClick }: { allJobs: Job[]; onJobClick: (job: Job) => void }) {
  const today = new Date()
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  const year  = viewDate.getFullYear()
  const month = viewDate.getMonth()

  const firstDay       = new Date(year, month, 1).getDay()
  const daysInMonth    = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()

  const cells: { date: Date; isCurrentMonth: boolean }[] = []
  for (let i = firstDay - 1; i >= 0; i--)
    cells.push({ date: new Date(year, month - 1, daysInPrevMonth - i), isCurrentMonth: false })
  for (let d = 1; d <= daysInMonth; d++)
    cells.push({ date: new Date(year, month, d), isCurrentMonth: true })
  const remaining = 42 - cells.length
  for (let d = 1; d <= remaining; d++)
    cells.push({ date: new Date(year, month + 1, d), isCurrentMonth: false })

  const jobsByDate = useMemo(() => {
    const map = new Map<string, Job[]>()
    allJobs.forEach(job => {
      if (!job.scheduled_date) return
      const key = job.scheduled_date.split('T')[0]
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(job)
    })
    return map
  }, [allJobs])

  function dateKey(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }

  function isToday(d: Date) {
    return d.getFullYear() === today.getFullYear()
      && d.getMonth() === today.getMonth()
      && d.getDate() === today.getDate()
  }

  const selectedJobs = selectedDate ? (jobsByDate.get(dateKey(selectedDate)) || []) : []
  const monthJobs  = allJobs.filter(j => {
    if (!j.scheduled_date) return false
    const d = new Date(j.scheduled_date)
    return d.getFullYear() === year && d.getMonth() === month
  })
  const unassigned = monthJobs.filter(j => !j.assigned_technician_id && j.status === 'scheduled')

  return (
    <div className="flex gap-4 flex-1 overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setViewDate(new Date(year, month - 1, 1))}
              className="text-muted hover:text-white text-lg w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface transition-colors">←</button>
            <h2 className="text-base font-bold text-white w-44 text-center">{MONTHS[month]} {year}</h2>
            <button onClick={() => setViewDate(new Date(year, month + 1, 1))}
              className="text-muted hover:text-white text-lg w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface transition-colors">→</button>
            <button onClick={() => setViewDate(new Date(today.getFullYear(), today.getMonth(), 1))}
              className="text-xs px-3 py-1.5 bg-surface border border-border rounded-lg text-muted hover:text-white transition-colors">Today</button>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-muted">{monthJobs.length} installs this month</span>
            {unassigned.length > 0 && (
              <span className="px-2 py-1 bg-amber/20 text-amber rounded-lg font-semibold">
                ⚠ {unassigned.length} unassigned
              </span>
            )}
          </div>
        </div>
        <div className="grid grid-cols-7 gap-2 mb-2 flex-shrink-0">
          {DAYS.map(d => (
            <div key={d} className="text-xs font-bold text-muted uppercase tracking-wide text-center py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-2 flex-1 overflow-y-auto">
          {cells.map((cell, i) => (
            <CalendarDay key={i} date={cell.date} isCurrentMonth={cell.isCurrentMonth}
              isToday={isToday(cell.date)} jobs={jobsByDate.get(dateKey(cell.date)) || []}
              onJobClick={onJobClick}
              onDayClick={(d) => setSelectedDate(prev => prev && dateKey(prev) === dateKey(d) ? null : d)}
              selected={!!selectedDate && dateKey(selectedDate) === dateKey(cell.date)}
            />
          ))}
        </div>
      </div>
      {selectedDate && (
        <DayDetailPanel date={selectedDate} jobs={selectedJobs}
          onJobClick={onJobClick} onClose={() => setSelectedDate(null)} />
      )}
    </div>
  )
}

// ── Mobile Board View ─────────────────────────────────────────
function MobileBoardView({ jobsByStatus, searchQuery, onJobClick }: {
  jobsByStatus: Partial<Record<JobStatus, Job[]>>; searchQuery: string; onJobClick: (job: Job) => void
}) {
  const [activeStatus, setActiveStatus] = useState<JobStatus>('scheduled')

  const tabDef: { status: JobStatus; color: string; bg: string; border: string }[] = [
    { status: 'scheduled',         color: '#0d7ea3', bg: 'rgba(13,126,163,0.15)',  border: 'rgba(13,126,163,0.4)'  },
    { status: 'in_progress',       color: '#22d3ee', bg: 'rgba(34,211,238,0.15)', border: 'rgba(34,211,238,0.4)'  },
    { status: 'waiting_for_stock', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.4)'  },
    { status: 'complete',          color: '#22c55e', bg: 'rgba(34,197,94,0.15)',   border: 'rgba(34,197,94,0.4)'   },
  ]

  const jobs = jobsByStatus?.[activeStatus] || []
  const filtered = searchQuery
    ? jobs.filter(j =>
        j.customer_name_snapshot.toLowerCase().includes(searchQuery.toLowerCase()) ||
        j.phone_snapshot.includes(searchQuery) ||
        j.service_address_snapshot.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : jobs

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 0, marginBottom: 12, paddingBottom: 2 }}>
        {tabDef.map(({ status, color, bg, border }) => {
          const count = (jobsByStatus?.[status] || []).length
          const isActive = activeStatus === status
          return (
            <button key={status} onClick={() => setActiveStatus(status)} style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 10,
              border: `1px solid ${isActive ? border : '#1e3a4f'}`,
              background: isActive ? bg : 'rgba(255,255,255,0.02)',
              color: isActive ? color : '#475569',
              cursor: 'pointer', fontSize: 12, fontWeight: isActive ? 700 : 500,
              boxShadow: isActive ? `0 0 12px ${color}20` : 'none',
            }}>
              <span>{JOB_STATUS_LABELS[status]}</span>
              {count > 0 && (
                <span style={{
                  background: isActive ? color + '30' : 'rgba(255,255,255,0.06)',
                  color: isActive ? color : '#64748b',
                  borderRadius: 20, padding: '1px 6px', fontSize: 11, fontWeight: 700,
                }}>{count}</span>
              )}
            </button>
          )
        })}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#64748b', fontSize: 13 }}>No jobs</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(job => (
              <JobCard key={job.id} job={job} onClick={onJobClick} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Mobile Calendar View ──────────────────────────────────────
function MobileCalendarView({ allJobs, onJobClick }: { allJobs: Job[]; onJobClick: (job: Job) => void }) {
  const today = new Date()
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  const year  = viewDate.getFullYear()
  const month = viewDate.getMonth()

  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrev  = new Date(year, month, 0).getDate()

  const cells: { date: Date; isCurrentMonth: boolean }[] = []
  for (let i = firstDay - 1; i >= 0; i--)
    cells.push({ date: new Date(year, month - 1, daysInPrev - i), isCurrentMonth: false })
  for (let d = 1; d <= daysInMonth; d++)
    cells.push({ date: new Date(year, month, d), isCurrentMonth: true })
  const remaining = 42 - cells.length
  for (let d = 1; d <= remaining; d++)
    cells.push({ date: new Date(year, month + 1, d), isCurrentMonth: false })

  const jobsByDate = useMemo(() => {
    const map = new Map<string, Job[]>()
    allJobs.forEach(job => {
      if (!job.scheduled_date) return
      const key = job.scheduled_date.split('T')[0]
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(job)
    })
    return map
  }, [allJobs])

  function dateKey(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }

  function isTodayFn(d: Date) {
    return d.getFullYear() === today.getFullYear()
      && d.getMonth() === today.getMonth()
      && d.getDate() === today.getDate()
  }

  const monthJobs  = allJobs.filter(j => {
    if (!j.scheduled_date) return false
    const d = new Date(j.scheduled_date)
    return d.getFullYear() === year && d.getMonth() === month
  })
  const unassigned   = monthJobs.filter(j => !j.assigned_technician_id && j.status === 'scheduled')
  const selectedJobs = selectedDate ? (jobsByDate.get(dateKey(selectedDate)) || []) : []

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setViewDate(new Date(year, month - 1, 1))}
            style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 18, cursor: 'pointer', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}>←</button>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0', minWidth: 130, textAlign: 'center' }}>
            {MONTHS[month]} {year}
          </span>
          <button onClick={() => setViewDate(new Date(year, month + 1, 1))}
            style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 18, cursor: 'pointer', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}>→</button>
        </div>
        <button onClick={() => { setViewDate(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDate(null) }}
          style={{ fontSize: 11, padding: '4px 10px', background: '#1e3a4f', border: '1px solid #1e3a4f', borderRadius: 6, color: '#94a3b8', cursor: 'pointer' }}>Today</button>
      </div>

      {unassigned.length > 0 && (
        <div style={{ marginBottom: 8, padding: '6px 12px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, fontSize: 12, color: '#f59e0b', fontWeight: 600, flexShrink: 0 }}>
          ⚠ {unassigned.length} unassigned · {monthJobs.length} installs this month
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4, flexShrink: 0 }}>
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} style={{ fontSize: 10, fontWeight: 700, color: '#475569', textAlign: 'center', padding: '3px 0', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{d}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, flexShrink: 0 }}>
        {cells.map((cell, i) => {
          const key = dateKey(cell.date)
          const dayJobs   = jobsByDate.get(key) || []
          const isSelected = !!selectedDate && dateKey(selectedDate) === key
          const isTod      = isTodayFn(cell.date)
          return (
            <div key={i} onClick={() => setSelectedDate(prev => prev && dateKey(prev) === key ? null : cell.date)} style={{
              minHeight: 40, borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${isSelected ? '#22d3ee' : isTod ? '#0d7ea3' : dayJobs.length > 0 ? '#1e3a4f' : '#1a2535'}`,
              background: isSelected ? 'rgba(34,211,238,0.08)' : isTod ? 'rgba(13,126,163,0.12)' : cell.isCurrentMonth ? '#162232' : 'rgba(22,34,50,0.4)',
              padding: '4px 2px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              opacity: cell.isCurrentMonth ? 1 : 0.35,
              boxShadow: isTod ? '0 0 0 2px rgba(13,126,163,0.4)' : isSelected ? '0 0 0 2px rgba(34,211,238,0.4)' : 'none',
            }}>
              <span style={{
                fontSize: 11, fontWeight: isTod ? 800 : 600,
                color: isTod ? '#fff' : cell.isCurrentMonth ? '#cbd5e1' : '#475569',
                width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '50%', background: isTod ? '#0d7ea3' : 'transparent',
              }}>
                {cell.date.getDate()}
              </span>
              {dayJobs.length > 0 && (
                <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {dayJobs.slice(0, 3).map((job, ji) => (
                    <span key={ji} style={{
                      width: 5, height: 5, borderRadius: '50%',
                      background: job.status === 'scheduled' ? '#0d7ea3' : job.status === 'in_progress' ? '#22d3ee' : job.status === 'waiting_for_stock' ? '#f59e0b' : '#22c55e',
                    }} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', marginTop: 14 }}>
        {selectedDate ? (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
              {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              {' · '}{selectedJobs.length} job{selectedJobs.length !== 1 ? 's' : ''}
            </div>
            {selectedJobs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#475569', fontSize: 13 }}>No installs scheduled</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {selectedJobs.map(job => (
                  <JobCard key={job.id} job={job} onClick={onJobClick} />
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '20px 0', color: '#334155', fontSize: 13 }}>Tap a day to see jobs</div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export function DispatchBoardPage() {
  const { role } = useAuth()
  const isMobile = useIsMobile()
  const { data: jobsByStatus, isLoading, error } = useJobsBoard()
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [view, setView] = useState<'board' | 'calendar'>('board')

  const allJobs = useMemo(
    () => Object.values(jobsByStatus || {}).flat(),
    [jobsByStatus]
  )

  const totalJobs = allJobs.length

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted text-sm">Loading dispatch board...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red text-sm">Failed to load dispatch board.</div>
      </div>
    )
  }

  // ── MOBILE ────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {/* Mobile header */}
        <div style={{ flexShrink: 0, marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18, color: '#e2e8f0' }}>Dispatch Board</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                {totalJobs} job{totalJobs !== 1 ? 's' : ''} total
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8, padding: 3 }}>
              <button onClick={() => setView('board')} style={{
                padding: '6px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 600,
                background: view === 'board' ? '#0d7ea3' : 'transparent',
                color: view === 'board' ? '#fff' : '#64748b',
              }}>⠿ Board</button>
              <button onClick={() => setView('calendar')} style={{
                padding: '6px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 600,
                background: view === 'calendar' ? '#0d7ea3' : 'transparent',
                color: view === 'calendar' ? '#fff' : '#64748b',
              }}>📅 Cal</button>
            </div>
          </div>

          {/* Mobile stats */}
          <MobileStatsBar allJobs={allJobs} />

          {view === 'board' && (
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search jobs..."
              style={{
                width: '100%', boxSizing: 'border-box' as const,
                background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8,
                color: '#e2e8f0', padding: '10px 14px', fontSize: 13, outline: 'none',
                marginBottom: 10,
              }}
            />
          )}
        </div>

        {view === 'board' && (
          <MobileBoardView jobsByStatus={jobsByStatus || {}} searchQuery={searchQuery} onJobClick={setSelectedJob} />
        )}
        {view === 'calendar' && (
          <MobileCalendarView allJobs={allJobs} onJobClick={setSelectedJob} />
        )}
        {selectedJob && (
          <JobDrawer job={selectedJob} onClose={() => setSelectedJob(null)} />
        )}
      </div>
    )
  }

  // ── DESKTOP ───────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white">Dispatch Board</h1>
          <p className="text-sm text-muted mt-0.5">
            {totalJobs} job{totalJobs !== 1 ? 's' : ''} total
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-surface border border-border rounded-lg p-1">
            <button onClick={() => setView('board')} className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${view === 'board' ? 'bg-accent text-white' : 'text-muted hover:text-white'}`}>
              ⠿ Board
            </button>
            <button onClick={() => setView('calendar')} className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${view === 'calendar' ? 'bg-accent text-white' : 'text-muted hover:text-white'}`}>
              📅 Calendar
            </button>
          </div>
          {view === 'board' && (
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search jobs..."
              className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent w-48 transition-colors"
            />
          )}
        </div>
      </div>

      {/* Stats bar — desktop */}
      <StatsBar allJobs={allJobs} />

      {/* Board view */}
      {view === 'board' && (
        <div className="flex gap-4 overflow-x-auto flex-1 pb-4">
          {DISPATCH_COLUMNS.map(status => {
            const jobs = jobsByStatus?.[status] || []
            const filtered = searchQuery
              ? jobs.filter(j =>
                  j.customer_name_snapshot.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  j.phone_snapshot.includes(searchQuery) ||
                  j.service_address_snapshot.toLowerCase().includes(searchQuery.toLowerCase())
                )
              : jobs
            return (
              <div key={status} className={`kanban-col bg-surface border-t-2 ${STATUS_COLORS[status]} rounded-xl flex-shrink-0`}>
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">
                    {JOB_STATUS_LABELS[status]}
                  </span>
                  <span className="text-xs bg-card border border-border rounded-full px-2 py-0.5 text-muted font-semibold">
                    {filtered.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2 p-2 overflow-y-auto max-h-[calc(100vh-340px)]">
                  {filtered.length === 0 ? (
                    <div className="text-center py-6 text-xs text-muted">No jobs</div>
                  ) : (
                    filtered.map(job => (
                      <JobCard key={job.id} job={job} onClick={setSelectedJob} />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Calendar view */}
      {view === 'calendar' && (
        <CalendarView allJobs={allJobs} onJobClick={setSelectedJob} />
      )}

      {selectedJob && (
        <JobDrawer job={selectedJob} onClose={() => setSelectedJob(null)} />
      )}
    </div>
  )
}
