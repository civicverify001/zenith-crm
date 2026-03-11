import { useState, useMemo } from 'react'
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

// ── Calendar Day Cell ─────────────────────────────────────────
function CalendarDay({
  date,
  isCurrentMonth,
  isToday,
  jobs,
  onJobClick,
  onDayClick,
  selected,
}: {
  date: Date
  isCurrentMonth: boolean
  isToday: boolean
  jobs: Job[]
  onJobClick: (job: Job) => void
  onDayClick: (date: Date) => void
  selected: boolean
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
      {/* Day number */}
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

      {/* Status dots summary */}
      {jobs.length > 0 && (
        <div className="flex gap-1 mb-1.5 flex-wrap">
          {scheduled.length  > 0 && <span className="text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent font-semibold">{scheduled.length} sched</span>}
          {inProgress.length > 0 && <span className="text-xs px-1.5 py-0.5 rounded bg-cyan/20 text-cyan font-semibold">{inProgress.length} active</span>}
          {waiting.length    > 0 && <span className="text-xs px-1.5 py-0.5 rounded bg-amber/20 text-amber font-semibold">{waiting.length} wait</span>}
          {complete.length   > 0 && <span className="text-xs px-1.5 py-0.5 rounded bg-green/20 text-green font-semibold">{complete.length} done</span>}
        </div>
      )}

      {/* Job pills — show up to 3 */}
      <div className="space-y-1">
        {jobs.slice(0, 3).map(job => (
          <div
            key={job.id}
            onClick={e => { e.stopPropagation(); onJobClick(job) }}
            className="flex items-center gap-1.5 bg-card rounded px-1.5 py-1 hover:bg-card/80 transition-colors cursor-pointer group"
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[job.status]}`} />
            <span className="text-xs text-slate-300 truncate group-hover:text-white transition-colors">
              {job.customer_name_snapshot}
            </span>
          </div>
        ))}
        {jobs.length > 3 && (
          <div className="text-xs text-muted pl-1">+{jobs.length - 3} more</div>
        )}
      </div>

      {/* Empty day hint */}
      {jobs.length === 0 && isCurrentMonth && (
        <div className="text-xs text-muted/40 mt-2 text-center">open</div>
      )}
    </div>
  )
}

// ── Day Detail Drawer (right side panel) ─────────────────────
function DayDetailPanel({
  date,
  jobs,
  onJobClick,
  onClose,
}: {
  date: Date | null
  jobs: Job[]
  onJobClick: (job: Job) => void
  onClose: () => void
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
      {/* Header */}
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
                    <div
                      key={job.id}
                      onClick={() => onJobClick(job)}
                      className="bg-card border border-border rounded-lg p-3 cursor-pointer hover:border-accent/50 transition-colors"
                    >
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

// ── Calendar View ─────────────────────────────────────────────
function CalendarView({
  allJobs,
  onJobClick,
}: {
  allJobs: Job[]
  onJobClick: (job: Job) => void
}) {
  const today = new Date()
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  const year  = viewDate.getFullYear()
  const month = viewDate.getMonth()

  // Build calendar grid
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()

  const cells: { date: Date; isCurrentMonth: boolean }[] = []

  // Prev month fill
  for (let i = firstDay - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month - 1, daysInPrevMonth - i), isCurrentMonth: false })
  }
  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), isCurrentMonth: true })
  }
  // Next month fill
  const remaining = 42 - cells.length
  for (let d = 1; d <= remaining; d++) {
    cells.push({ date: new Date(year, month + 1, d), isCurrentMonth: false })
  }

  // Map jobs to dates
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

  // Month summary stats
  const monthJobs = allJobs.filter(j => {
    if (!j.scheduled_date) return false
    const d = new Date(j.scheduled_date)
    return d.getFullYear() === year && d.getMonth() === month
  })
  const unassigned = monthJobs.filter(j => !j.assigned_technician_id && j.status === 'scheduled')

  return (
    <div className="flex gap-4 flex-1 overflow-hidden">
      {/* Calendar main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Month nav + stats */}
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setViewDate(new Date(year, month - 1, 1))}
              className="text-muted hover:text-white text-lg w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface transition-colors"
            >←</button>
            <h2 className="text-base font-bold text-white w-44 text-center">
              {MONTHS[month]} {year}
            </h2>
            <button
              onClick={() => setViewDate(new Date(year, month + 1, 1))}
              className="text-muted hover:text-white text-lg w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface transition-colors"
            >→</button>
            <button
              onClick={() => setViewDate(new Date(today.getFullYear(), today.getMonth(), 1))}
              className="text-xs px-3 py-1.5 bg-surface border border-border rounded-lg text-muted hover:text-white transition-colors"
            >Today</button>
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

        {/* Day headers */}
        <div className="grid grid-cols-7 gap-2 mb-2 flex-shrink-0">
          {DAYS.map(d => (
            <div key={d} className="text-xs font-bold text-muted uppercase tracking-wide text-center py-1">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-2 flex-1 overflow-y-auto">
          {cells.map((cell, i) => (
            <CalendarDay
              key={i}
              date={cell.date}
              isCurrentMonth={cell.isCurrentMonth}
              isToday={isToday(cell.date)}
              jobs={jobsByDate.get(dateKey(cell.date)) || []}
              onJobClick={onJobClick}
              onDayClick={(d) => setSelectedDate(prev =>
                prev && dateKey(prev) === dateKey(d) ? null : d
              )}
              selected={!!selectedDate && dateKey(selectedDate) === dateKey(cell.date)}
            />
          ))}
        </div>
      </div>

      {/* Day detail panel */}
      {selectedDate && (
        <DayDetailPanel
          date={selectedDate}
          jobs={selectedJobs}
          onJobClick={onJobClick}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export function DispatchBoardPage() {
  const { role } = useAuth()
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white">Dispatch Board</h1>
          <p className="text-sm text-muted mt-0.5">
            {totalJobs} job{totalJobs !== 1 ? 's' : ''} total
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex items-center bg-surface border border-border rounded-lg p-1">
            <button
              onClick={() => setView('board')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                view === 'board'
                  ? 'bg-accent text-white'
                  : 'text-muted hover:text-white'
              }`}
            >
              ⠿ Board
            </button>
            <button
              onClick={() => setView('calendar')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                view === 'calendar'
                  ? 'bg-accent text-white'
                  : 'text-muted hover:text-white'
              }`}
            >
              📅 Calendar
            </button>
          </div>

          {view === 'board' && (
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search jobs..."
              className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent w-48 transition-colors"
            />
          )}
        </div>
      </div>

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
                <div className="flex flex-col gap-2 p-2 overflow-y-auto max-h-[calc(100vh-220px)]">
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

      {/* Job drawer (shared between both views) */}
      {selectedJob && (
        <JobDrawer job={selectedJob} onClose={() => setSelectedJob(null)} />
      )}
    </div>
  )
}

// named re-export for Router compatibility
export { DispatchBoardPage }
