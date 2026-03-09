import { useJobActivity } from '../useJobs'
import type { JobActivity } from '../dispatch.types'

interface Props {
  jobId: string
}

const EVENT_CONFIG: Record<string, { icon: string; color: string }> = {
  job_created:                { icon: '➕', color: 'bg-accent' },
  status_change:              { icon: '→',  color: 'bg-purple-500' },
  tech_assigned:              { icon: '👤', color: 'bg-orange-500' },
  checklist_item_completed:   { icon: '✓',  color: 'bg-green-500' },
  tech_verification:          { icon: '✅', color: 'bg-emerald-500' },
  photo_uploaded:             { icon: '📷', color: 'bg-cyan-500' },
  handover_submitted:         { icon: '📋', color: 'bg-sky-500' },
  consent_submitted:          { icon: '✍️', color: 'bg-amber-500' },
  job_completed:              { icon: '🎉', color: 'bg-green-500' },
  note_added:                 { icon: '📝', color: 'bg-slate-500' },
}

function formatTimestamp(str: string) {
  const d = new Date(str)
  const diff = Math.floor((Date.now() - d.getTime()) / 60000)
  if (diff < 1) return 'Just now'
  if (diff < 60) return `${diff}m ago`
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function JobActivityTab({ jobId }: Props) {
  const { data: activity, isLoading } = useJobActivity(jobId)

  if (isLoading) return <p className="text-sm text-muted text-center py-8">Loading activity...</p>
  if (!activity?.length) return <p className="text-sm text-muted text-center py-8">No activity yet.</p>

  return (
    <div className="space-y-0">
      {(activity as JobActivity[]).map((entry, idx) => {
        const config = EVENT_CONFIG[entry.event_type] || { icon: '•', color: 'bg-muted' }

        return (
          <div key={entry.id} className="flex gap-3 relative">
            {idx < activity.length - 1 && (
              <div className="absolute left-[11px] top-7 bottom-0 w-px bg-border" />
            )}
            <div className={`w-6 h-6 rounded-full ${config.color} flex items-center justify-center flex-shrink-0 text-xs text-white z-10`}>
              {config.icon}
            </div>
            <div className="flex-1 pb-4 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm text-slate-200 font-medium">{entry.title}</div>
                <div className="text-xs text-muted whitespace-nowrap flex-shrink-0">{formatTimestamp(entry.created_at)}</div>
              </div>
              {entry.from_status && entry.to_status && (
                <div className="text-xs text-muted mt-0.5">
                  {entry.from_status.replace(/_/g, ' ')} → {entry.to_status.replace(/_/g, ' ')}
                </div>
              )}
              {entry.actor_name && (
                <div className="text-xs text-muted mt-0.5">by {entry.actor_name}</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
