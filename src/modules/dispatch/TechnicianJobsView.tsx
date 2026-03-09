import { useState } from 'react'
import { useJobsBoard } from './useJobs'
import { JobDrawer } from './JobDrawer'
import type { Job } from './dispatch.types'
import { JOB_STATUS_LABELS, JOB_STATUS_COLORS, SYSTEM_TYPE_LABELS } from './dispatch.types'
import { useAuth } from '../../hooks/useAuth'

export function TechnicianJobsView() {
  const { user } = useAuth()
  const { data: jobsByStatus, isLoading } = useJobsBoard()
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><div className="text-muted text-sm">Loading your jobs...</div></div>
  }

  // Filter to only this technician's jobs, exclude complete
  const allJobs = Object.values(jobsByStatus || {}).flat()
  const myJobs = allJobs
    .filter(j => j.assigned_technician_id === user?.id && j.status !== 'complete')
    .sort((a, b) => {
      if (a.scheduled_date && b.scheduled_date) return a.scheduled_date.localeCompare(b.scheduled_date)
      if (a.scheduled_date) return -1
      return 1
    })

  const myCompleted = allJobs.filter(j => j.assigned_technician_id === user?.id && j.status === 'complete')

  return (
    <div className="flex flex-col h-full">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-white">My Jobs</h1>
        <p className="text-sm text-muted mt-0.5">{myJobs.length} active job{myJobs.length !== 1 ? 's' : ''}</p>
      </div>

      {myJobs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-4xl mb-3">🔧</div>
            <div className="text-slate-300 font-medium">No jobs assigned</div>
            <div className="text-sm text-muted mt-1">Check back soon or contact admin.</div>
          </div>
        </div>
      ) : (
        <div className="space-y-3 flex-1 overflow-y-auto">
          {myJobs.map(job => (
            <div
              key={job.id}
              onClick={() => setSelectedJob(job)}
              className="bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-accent/50 transition-all"
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
                <span className="text-xs text-muted">
                  📅 {job.scheduled_date
                    ? new Date(job.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : 'Not scheduled'}
                </span>
              </div>
            </div>
          ))}

          {myCompleted.length > 0 && (
            <>
              <div className="text-xs font-bold text-muted uppercase tracking-wide mt-4 mb-2">
                Recently Completed ({myCompleted.length})
              </div>
              {myCompleted.slice(0, 5).map(job => (
                <div
                  key={job.id}
                  onClick={() => setSelectedJob(job)}
                  className="bg-card/50 border border-border/50 rounded-xl p-3 cursor-pointer opacity-70 hover:opacity-100 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-300">{job.customer_name_snapshot}</span>
                    <span className="text-xs text-green">✅ Complete</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {selectedJob && (
        <JobDrawer job={selectedJob} onClose={() => setSelectedJob(null)} />
      )}
    </div>
  )
}
