import { useState } from 'react'
import { useJobsBoard } from '../dispatch/useJobs'
import { useAuth } from '../../hooks/useAuth'
import { useNavigate } from 'react-router-dom'
import type { Job, JobStatus } from '../dispatch/dispatch.types'
import { JOB_STATUS_LABELS, JOB_STATUS_COLORS, SYSTEM_TYPE_LABELS } from '../dispatch/dispatch.types'

const TAB_STYLES: Record<string, { active: React.CSSProperties; inactive: React.CSSProperties }> = {
  all: {
    active: { backgroundColor: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.4)' },
    inactive: { backgroundColor: 'transparent', color: '#94a3b8', border: '1px solid rgba(148, 163, 184, 0.2)' },
  },
  scheduled: {
    active: { backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.4)' },
    inactive: { backgroundColor: 'transparent', color: '#94a3b8', border: '1px solid rgba(148, 163, 184, 0.2)' },
  },
  in_progress: {
    active: { backgroundColor: 'rgba(6, 182, 212, 0.15)', color: '#22d3ee', border: '1px solid rgba(6, 182, 212, 0.4)' },
    inactive: { backgroundColor: 'transparent', color: '#94a3b8', border: '1px solid rgba(148, 163, 184, 0.2)' },
  },
  waiting_for_stock: {
    active: { backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.4)' },
    inactive: { backgroundColor: 'transparent', color: '#94a3b8', border: '1px solid rgba(148, 163, 184, 0.2)' },
  },
  complete: {
    active: { backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.4)' },
    inactive: { backgroundColor: 'transparent', color: '#94a3b8', border: '1px solid rgba(148, 163, 184, 0.2)' },
  },
}

type FilterKey = 'all' | 'scheduled' | 'in_progress' | 'waiting_for_stock' | 'complete'

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'waiting_for_stock', label: 'Waiting for Stock' },
  { key: 'complete', label: 'Completed' },
]

export function InstallationsListPage() {
  const { user, role } = useAuth()
  const navigate = useNavigate()
  const { data: jobsByStatus, isLoading, error } = useJobsBoard()
  const [filter, setFilter] = useState<FilterKey>('all')

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><div className="text-muted text-sm">Loading jobs...</div></div>
  }
  if (error) {
    return <div className="flex items-center justify-center h-full"><div className="text-red text-sm">Failed to load jobs.</div></div>
  }

  const allJobs = Object.values(jobsByStatus || {}).flat()

  // Technicians see only their assigned jobs. Admin sees all.
  const visibleJobs = role === 'admin'
    ? allJobs
    : allJobs.filter(j => j.assigned_technician_id === user?.id)

  // Count per status
  const statusCounts: Record<string, number> = { all: visibleJobs.length }
  for (const j of visibleJobs) {
    statusCounts[j.status] = (statusCounts[j.status] || 0) + 1
  }

  // Filter and sort
  const displayJobs = visibleJobs
    .filter(j => filter === 'all' ? true : j.status === filter)
    .sort((a, b) => {
      const order: Record<string, number> = { in_progress: 0, scheduled: 1, waiting_for_stock: 2, complete: 3 }
      const diff = (order[a.status] ?? 4) - (order[b.status] ?? 4)
      if (diff !== 0) return diff
      if (a.status === 'complete') return (b.completed_at || '').localeCompare(a.completed_at || '')
      if (a.scheduled_date && b.scheduled_date) return a.scheduled_date.localeCompare(b.scheduled_date)
      return a.scheduled_date ? -1 : 1
    })

  const activeCount = visibleJobs.filter(j => j.status !== 'complete').length
  const completedCount = statusCounts['complete'] || 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white">
            {role === 'technician' ? 'My Installations' : 'All Installations'}
          </h1>
          <p className="text-sm text-muted mt-0.5">
            {activeCount} active job{activeCount !== 1 ? 's' : ''}
            {completedCount > 0 && ` · ${completedCount} completed`}
          </p>
        </div>
      </div>

      {/* Filter tabs — full width, colored */}
      <div className="mb-4 flex-shrink-0" style={{ display: 'grid', gridTemplateColumns: `repeat(${FILTER_TABS.length}, 1fr)`, gap: '8px' }}>
        {FILTER_TABS.map(tab => {
          const count = statusCounts[tab.key] || 0
          const isActive = filter === tab.key
          const styles = TAB_STYLES[tab.key] || TAB_STYLES.all
          return (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              style={{
                ...(isActive ? styles.active : styles.inactive),
                padding: '10px 8px',
                borderRadius: '12px',
                fontSize: '13px',
                fontWeight: 600,
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {tab.label}
              <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 700, opacity: 0.8 }}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Job list */}
      {displayJobs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-4xl mb-3">{filter === 'complete' ? '✅' : '🔧'}</div>
            <div className="text-slate-300 font-medium">
              No {filter === 'all' ? '' : FILTER_TABS.find(t => t.key === filter)?.label.toLowerCase() + ' '}jobs
            </div>
            <div className="text-sm text-muted mt-1">
              {role === 'technician' && 'Check back soon or contact admin.'}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3 flex-1 overflow-y-auto pb-4">
          {displayJobs.map(job => (
            <JobListCard
              key={job.id}
              job={job}
              onClick={() => navigate(`/installations/${job.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function JobListCard({ job, onClick }: { job: Job; onClick: () => void }) {
  const scheduledStr = job.scheduled_date
    ? new Date(job.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      })
    : 'Not scheduled'

  const needsAction = job.status === 'in_progress'

  return (
    <div
      onClick={onClick}
      className={`bg-card border rounded-xl p-4 cursor-pointer hover:border-accent/50 transition-all ${
        needsAction ? 'border-cyan/30' : 'border-border'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-white">{job.customer_name_snapshot}</h3>
        <span className={`stage-badge border text-xs ${JOB_STATUS_COLORS[job.status]}`}>
          {JOB_STATUS_LABELS[job.status]}
        </span>
      </div>

      <div className="text-xs text-muted mb-1">{job.service_address_snapshot}</div>
      <div className="text-xs text-muted mb-2">{job.phone_snapshot}</div>

      <div className="flex items-center justify-between">
        <span className="text-xs bg-surface border border-border rounded px-1.5 py-0.5 text-muted">
          {SYSTEM_TYPE_LABELS[job.system_type]}
        </span>
        <span className="text-xs text-muted">📅 {scheduledStr}</span>
      </div>

      {needsAction && (
        <div className="mt-2 text-xs font-medium" style={{ color: '#22d3ee' }}>→ In progress — tap to continue</div>
      )}
    </div>
  )
}
