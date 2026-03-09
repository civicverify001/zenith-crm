import { useState } from 'react'
import { useJobsBoard } from './useJobs'
import { JobCard } from './JobCard'
import { JobDrawer } from './JobDrawer'
import type { Job, JobStatus } from './dispatch.types'
import { DISPATCH_COLUMNS, JOB_STATUS_LABELS } from './dispatch.types'
import { useAuth } from '../../hooks/useAuth'

const STATUS_COLORS: Record<JobStatus, string> = {
  scheduled: 'border-t-accent',
  waiting_for_stock: 'border-t-amber',
  in_progress: 'border-t-cyan',
  complete: 'border-t-green',
}

export function DispatchBoardPage() {
  const { role } = useAuth()
  const { data: jobsByStatus, isLoading, error } = useJobsBoard()
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const totalJobs = Object.values(jobsByStatus || {}).reduce((a, b) => a + b.length, 0)

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
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search jobs..."
          className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent w-48 transition-colors"
        />
      </div>

      {/* Kanban board */}
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

      {/* Job drawer */}
      {selectedJob && (
        <JobDrawer job={selectedJob} onClose={() => setSelectedJob(null)} />
      )}
    </div>
  )
}
