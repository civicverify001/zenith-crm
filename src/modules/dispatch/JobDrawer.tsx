import { useState, useCallback } from 'react'
import type { Job } from './dispatch.types'
import { JOB_STATUS_LABELS, JOB_STATUS_COLORS, SYSTEM_TYPE_LABELS } from './dispatch.types'
import { JobOverviewTab } from './tabs/JobOverviewTab'
import { JobActivityTab } from './tabs/JobActivityTab'
import { useQueryClient } from '@tanstack/react-query'
import { JOB_KEYS } from './useJobs'

interface Props {
  job: Job
  onClose: () => void
}

type DispatchTab = 'overview' | 'activity'

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
}

export function JobDrawer({ job: initialJob, onClose }: Props) {
  const [job, setJob] = useState<Job>(initialJob)
  const [activeTab, setActiveTab] = useState<DispatchTab>('overview')
  const qc = useQueryClient()

  const handleJobUpdated = useCallback((updated: Job) => {
    setJob(updated)
    qc.invalidateQueries({ queryKey: JOB_KEYS.board() })
    qc.invalidateQueries({ queryKey: JOB_KEYS.activity(updated.id) })
  }, [qc])

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-surface border-l border-border h-full overflow-y-auto shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-cyan/20 text-cyan font-bold flex items-center justify-center text-sm">
              {initials(job.customer_name_snapshot)}
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{job.customer_name_snapshot}</h2>
              <div className="text-sm text-muted">{job.phone_snapshot}</div>
              <div className="text-xs text-muted mt-0.5">{SYSTEM_TYPE_LABELS[job.system_type]}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`stage-badge border ${JOB_STATUS_COLORS[job.status]}`}>
              {JOB_STATUS_LABELS[job.status]}
            </div>
            <button onClick={onClose} className="text-muted hover:text-white text-xl leading-none ml-2">✕</button>
          </div>
        </div>

        {/* Tabs — Dispatch only shows Overview + Activity */}
        <div className="flex border-b border-border flex-shrink-0">
          {(['overview', 'activity'] as DispatchTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                activeTab === tab
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-muted hover:text-slate-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'overview' && <JobOverviewTab job={job} onJobUpdated={handleJobUpdated} />}
          {activeTab === 'activity' && <JobActivityTab jobId={job.id} />}
        </div>
      </div>
    </div>
  )
}
