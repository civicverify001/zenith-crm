import type { Job } from './dispatch.types'
import { JOB_STATUS_COLORS, JOB_STATUS_LABELS, SYSTEM_TYPE_LABELS } from './dispatch.types'

interface Props {
  job: Job
  onClick: (job: Job) => void
}

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
}

// ── NEW: Inventory status badge config ──
const INV_BADGE: Record<string, { label: string; color: string; bg: string; border: string }> = {
  reserved:      { label: '✅ Stock',    color: '#4ade80', bg: 'rgba(74,222,128,0.1)',  border: 'rgba(74,222,128,0.25)' },
  short:         { label: '⚠️ Short',    color: '#f87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.25)' },
  pending_check: { label: '⏳ Checking', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.25)' },
}

export function JobCard({ job, onClick }: Props) {
  const scheduledStr = job.scheduled_date
    ? new Date(job.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : 'Not scheduled'

  const invStatus = (job as any).inventory_status as string | null
  const invBadge = invStatus ? INV_BADGE[invStatus] : null

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
        {/* ── NEW: Inventory status badge ── */}
        {invBadge && (
          <span
            style={{
              fontSize: 10, fontWeight: 600,
              padding: '1px 6px', borderRadius: 8,
              background: invBadge.bg, color: invBadge.color,
              border: `1px solid ${invBadge.border}`,
            }}
          >
            {invBadge.label}
          </span>
        )}
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
