import { useJobsBoard } from '../dispatch/useJobs'
import { useAuth } from '../../hooks/useAuth'
import { useNavigate } from 'react-router-dom'
import type { Job } from '../dispatch/dispatch.types'
import { SYSTEM_TYPE_LABELS } from '../dispatch/dispatch.types'

const COLUMNS = [
  { key: 'scheduled',         label: 'Scheduled',         color: '#60a5fa', bg: 'rgba(96,165,250,0.08)',  border: 'rgba(96,165,250,0.3)'  },
  { key: 'in_progress',       label: 'In Progress',       color: '#22d3ee', bg: 'rgba(34,211,238,0.08)',  border: 'rgba(34,211,238,0.3)'  },
  { key: 'waiting_for_stock', label: 'Waiting for Stock', color: '#fbbf24', bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.3)'  },
  { key: 'complete',          label: 'Completed',          color: '#4ade80', bg: 'rgba(74,222,128,0.08)', border: 'rgba(74,222,128,0.3)'  },
]

const STATUS_ACCENT: Record<string, string> = {
  scheduled:         '#60a5fa',
  in_progress:       '#22d3ee',
  waiting_for_stock: '#fbbf24',
  complete:          '#4ade80',
  ready_to_schedule: '#a78bfa',
}

export function InstallationsListPage() {
  const { user, role } = useAuth()
  const navigate = useNavigate()
  const { data: jobsByStatus, isLoading, error } = useJobsBoard()

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><div style={{ color: '#64748b', fontSize: '14px' }}>Loading jobs...</div></div>
  }
  if (error) {
    return <div className="flex items-center justify-center h-full"><div style={{ color: '#f87171', fontSize: '14px' }}>Failed to load jobs.</div></div>
  }

  const allJobs = Object.values(jobsByStatus || {}).flat()
  const visibleJobs = role === 'admin' ? allJobs : allJobs.filter(j => j.assigned_technician_id === user?.id)

  const activeCount = visibleJobs.filter(j => j.status !== 'complete').length
  const completedCount = visibleJobs.filter(j => j.status === 'complete').length

  // Group by column key — jobs not matching any column go into scheduled
  const jobsByCol: Record<string, Job[]> = {}
  for (const col of COLUMNS) jobsByCol[col.key] = []

  for (const job of visibleJobs) {
    if (jobsByCol[job.status]) {
      jobsByCol[job.status].push(job)
    } else if (job.status === 'ready_to_schedule') {
      jobsByCol['scheduled'].push(job)
    }
  }

  // Sort each column
  for (const col of COLUMNS) {
    jobsByCol[col.key].sort((a, b) => {
      if (col.key === 'complete') return (b.completed_at || '').localeCompare(a.completed_at || '')
      if (a.scheduled_date && b.scheduled_date) return a.scheduled_date.localeCompare(b.scheduled_date)
      return a.scheduled_date ? -1 : 1
    })
  }

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

      {/* Kanban columns */}
      <div style={{ display: 'flex', gap: '12px', flex: 1, overflowX: 'auto', overflowY: 'hidden', paddingBottom: '8px' }}>
        {COLUMNS.map(col => {
          const jobs = jobsByCol[col.key] || []
          return (
            <div key={col.key} style={{
              minWidth: '220px', flex: '1 1 220px',
              display: 'flex', flexDirection: 'column',
              background: col.bg,
              border: `1px solid ${col.border}`,
              borderRadius: '12px',
              overflow: 'hidden',
            }}>
              {/* Column header */}
              <div style={{
                padding: '10px 14px',
                borderBottom: `1px solid ${col.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexShrink: 0,
              }}>
                <span style={{ color: col.color, fontWeight: 700, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {col.label}
                </span>
                <span style={{
                  background: col.bg, border: `1px solid ${col.border}`,
                  color: col.color, borderRadius: '20px',
                  padding: '1px 8px', fontSize: '11px', fontWeight: 700,
                }}>
                  {jobs.length}
                </span>
              </div>

              {/* Cards */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                {jobs.length === 0 ? (
                  <div style={{ color: '#334155', fontSize: '12px', textAlign: 'center', padding: '20px 8px' }}>
                    No jobs
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {jobs.map(job => (
                      <JobCard
                        key={job.id}
                        job={job}
                        accentColor={STATUS_ACCENT[job.status] || col.color}
                        onClick={() => navigate(`/installations/${job.id}`)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function JobCard({ job, accentColor, onClick }: { job: Job; accentColor: string; onClick: () => void }) {
  const scheduledStr = job.scheduled_date
    ? new Date(job.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : 'Not scheduled'

  return (
    <div
      onClick={onClick}
      style={{
        background: '#162232', border: '1px solid #1e3a4f',
        borderLeft: `3px solid ${accentColor}`,
        borderRadius: '8px', padding: '10px 12px',
        cursor: 'pointer', transition: 'background 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = '#1a2d45')}
      onMouseLeave={e => (e.currentTarget.style.background = '#162232')}
    >
      <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '13px', marginBottom: '2px' }}>
        {job.customer_name_snapshot}
      </div>
      {job.phone_snapshot && (
        <div style={{ color: '#64748b', fontSize: '11px', marginBottom: '6px' }}>
          {job.phone_snapshot}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
        <span style={{
          background: 'rgba(100,116,139,0.15)', border: '1px solid rgba(100,116,139,0.25)',
          color: '#94a3b8', borderRadius: '4px', padding: '1px 6px',
          fontSize: '10px', fontWeight: 600, whiteSpace: 'nowrap',
        }}>
          {SYSTEM_TYPE_LABELS[job.system_type] || job.system_type}
        </span>
        <span style={{ color: '#475569', fontSize: '10px', whiteSpace: 'nowrap' }}>
          📅 {scheduledStr}
        </span>
      </div>
      {job.status === 'in_progress' && (
        <div style={{ marginTop: '6px', fontSize: '10px', fontWeight: 600, color: '#22d3ee' }}>
          → In progress — tap to continue
        </div>
      )}
    </div>
  )
}
