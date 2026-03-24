import { useState } from 'react'
import { useJobsBoard } from '../dispatch/useJobs'
import { useAuth } from '../../hooks/useAuth'
import { useNavigate } from 'react-router-dom'
import type { Job } from '../dispatch/dispatch.types'
import { SYSTEM_TYPE_LABELS } from '../dispatch/dispatch.types'

type FilterKey = 'all' | 'scheduled' | 'in_progress' | 'waiting_for_stock' | 'complete'

const TABS: { key: FilterKey; label: string; color: string; activeBg: string; activeBorder: string }[] = [
  { key: 'all',               label: 'All',               color: '#38bdf8', activeBg: 'rgba(56,189,248,0.12)',  activeBorder: 'rgba(56,189,248,0.4)'  },
  { key: 'scheduled',         label: 'Scheduled',         color: '#60a5fa', activeBg: 'rgba(96,165,250,0.12)',  activeBorder: 'rgba(96,165,250,0.4)'  },
  { key: 'in_progress',       label: 'In Progress',       color: '#22d3ee', activeBg: 'rgba(34,211,238,0.12)',  activeBorder: 'rgba(34,211,238,0.4)'  },
  { key: 'waiting_for_stock', label: 'Waiting for Stock', color: '#fbbf24', activeBg: 'rgba(251,191,36,0.12)', activeBorder: 'rgba(251,191,36,0.4)'  },
  { key: 'complete',          label: 'Completed',         color: '#4ade80', activeBg: 'rgba(74,222,128,0.12)', activeBorder: 'rgba(74,222,128,0.4)'  },
]

const STATUS_ACCENT: Record<string, string> = {
  in_progress:       '#22d3ee',
  scheduled:         '#60a5fa',
  waiting_for_stock: '#fbbf24',
  ready_to_schedule: '#a78bfa',
  complete:          '#4ade80',
}

export function InstallationsListPage() {
  const { user, role } = useAuth()
  const navigate = useNavigate()
  const { data: jobsByStatus, isLoading, error } = useJobsBoard()
  const [filter, setFilter] = useState<FilterKey>('all')

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><div style={{ color: '#64748b', fontSize: '14px' }}>Loading jobs...</div></div>
  }
  if (error) {
    return <div className="flex items-center justify-center h-full"><div style={{ color: '#f87171', fontSize: '14px' }}>Failed to load jobs.</div></div>
  }

  const allJobs = Object.values(jobsByStatus || {}).flat()

  const visibleJobs = role === 'admin'
    ? allJobs
    : allJobs.filter(j => j.assigned_technician_id === user?.id)

  // Count per tab
  const counts: Record<string, number> = { all: visibleJobs.length }
  for (const j of visibleJobs) {
    counts[j.status] = (counts[j.status] || 0) + 1
  }

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
  const completedCount = counts['complete'] || 0
  const activeTab = TABS.find(t => t.key === filter)!

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ marginBottom: '16px', flexShrink: 0 }}>
        <h1 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '20px' }}>
          {role === 'technician' ? 'My Installations' : 'All Installations'}
        </h1>
        <p style={{ color: '#64748b', fontSize: '13px', marginTop: '2px' }}>
          {activeCount} active job{activeCount !== 1 ? 's' : ''}
          {completedCount > 0 && ` · ${completedCount} completed`}
        </p>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${TABS.length}, 1fr)`, gap: '8px', marginBottom: '16px', flexShrink: 0 }}>
        {TABS.map(tab => {
          const isActive = filter === tab.key
          const count = counts[tab.key] || 0
          return (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              style={{
                padding: '10px 8px',
                borderRadius: '12px',
                fontSize: '13px',
                fontWeight: 600,
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s',
                background:    isActive ? tab.activeBg    : 'transparent',
                color:         isActive ? tab.color       : '#94a3b8',
                border:        isActive ? `1px solid ${tab.activeBorder}` : '1px solid rgba(148,163,184,0.2)',
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

      {/* Job cards grid */}
      {displayJobs.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '36px', marginBottom: '10px' }}>{filter === 'complete' ? '✅' : '🔧'}</div>
            <div style={{ color: '#cbd5e1', fontWeight: 600, fontSize: '14px' }}>
              No {filter === 'all' ? '' : TABS.find(t => t.key === filter)?.label.toLowerCase() + ' '}jobs
            </div>
            {role === 'technician' && (
              <div style={{ color: '#64748b', fontSize: '12px', marginTop: '4px' }}>Check back soon or contact admin.</div>
            )}
          </div>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
            gap: '10px',
            alignContent: 'start',
            paddingBottom: '16px',
          }}
        >
          {displayJobs.map(job => (
            <JobCard
              key={job.id}
              job={job}
              accentColor={STATUS_ACCENT[job.status] || '#475569'}
              onClick={() => navigate(`/installations/${job.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function JobCard({ job, accentColor, onClick }: { job: Job; accentColor: string; onClick: () => void }) {
  const scheduledStr = job.scheduled_date
    ? new Date(job.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      })
    : 'Not scheduled'

  return (
    <div
      onClick={onClick}
      style={{
        background: '#162232',
        border: '1px solid #1e3a4f',
        borderLeft: `3px solid ${accentColor}`,
        borderRadius: '10px',
        padding: '12px',
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = '#1a2d45')}
      onMouseLeave={e => (e.currentTarget.style.background = '#162232')}
    >
      <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '13px', marginBottom: '2px' }}>
        {job.customer_name_snapshot}
      </div>

      {job.phone_snapshot && (
        <div style={{ color: '#64748b', fontSize: '11px', marginBottom: '4px' }}>
          {job.phone_snapshot}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', marginTop: '8px' }}>
        <span style={{
          background: 'rgba(100,116,139,0.15)',
          border: '1px solid rgba(100,116,139,0.25)',
          color: '#94a3b8',
          borderRadius: '4px',
          padding: '2px 6px',
          fontSize: '10px',
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}>
          {SYSTEM_TYPE_LABELS[job.system_type] || job.system_type}
        </span>
        <span style={{ color: '#475569', fontSize: '10px', whiteSpace: 'nowrap' }}>
          📅 {scheduledStr}
        </span>
      </div>

      {job.status === 'in_progress' && (
        <div style={{ marginTop: '8px', fontSize: '10px', fontWeight: 600, color: '#22d3ee' }}>
          → In progress — tap to continue
        </div>
      )}
    </div>
  )
}
