import type { Job } from './dispatch.types'
import { JOB_STATUS_COLORS, JOB_STATUS_LABELS, SYSTEM_TYPE_LABELS } from './dispatch.types'

interface Props {
  job: Job
  onClick: (job: Job) => void
}

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
}

export function JobCard({ job, onClick }: Props) {
  const scheduledStr = job.scheduled_date
    ? new Date(job.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : 'Not scheduled'

  return (
    <div
      onClick={() => onClick(job)}
      className="bg-card border border-border rounded-xl p-3 cursor-pointer hover:border-accent/50 transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white truncate">{job.customer_name_snapshot}</div>
          <div className="text-xs text-muted truncate">{job.phone_snapshot}</div>
        </div>
        {job.assigned_technician && (
          <div
            className="w-6 h-6 rounded-full bg-orange/20 text-orange text-xs font-bold flex items-center justify-center flex-shrink-0"
            title={job.assigned_technician.full_name}
          >
            {initials(job.assigned_technician.full_name)}
          </div>
        )}
      </div>

      <div className="text-xs text-muted truncate mb-2">{job.service_address_snapshot}</div>

      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="text-xs bg-surface border border-border rounded px-1.5 py-0.5 text-muted">
          {SYSTEM_TYPE_LABELS[job.system_type]}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">📅 {scheduledStr}</span>
        {job.equipment_summary && (
          <span className="text-xs text-muted truncate max-w-[100px]" title={job.equipment_summary}>
            {job.equipment_summary}
          </span>
        )}
      </div>
    </div>
  )
}
