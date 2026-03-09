import type { ActivityRow } from '../../services/activityService'
import { LEAD_STAGE_LABELS } from '../../types/domain.types'
import type { LeadStage } from '../../types/domain.types'

// ─── Icon + color mapping by event type ──────────────────────────
const EVENT_CONFIG: Record<string, { icon: string; color: string }> = {
  lead_created:      { icon: '➕', color: 'bg-accent' },
  stage_change:      { icon: '→',  color: 'bg-purple-500' },
  call_logged:       { icon: '📞', color: 'bg-green-500' },
  note_added:        { icon: '📝', color: 'bg-slate-500' },
  agreement_signed:  { icon: '✅', color: 'bg-emerald-500' },
  job_created:       { icon: '🔧', color: 'bg-cyan-500' },
  lead_lost:         { icon: '✕',  color: 'bg-red-500' },
  lead_dnd:          { icon: '🔇', color: 'bg-amber-500' },
  lead_followup:     { icon: '🕐', color: 'bg-violet-500' },
  field_updated:     { icon: '✏️', color: 'bg-slate-500' },
  rep_changed:       { icon: '👤', color: 'bg-sky-500' },
}

function formatTimestamp(str: string) {
  const d = new Date(str)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMs / 3600000)

  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`

  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function stageBadge(stage: string) {
  const label = LEAD_STAGE_LABELS[stage as LeadStage] || stage
  return (
    <span className="inline-block text-xs px-1.5 py-0.5 rounded bg-surface border border-border text-slate-300 font-medium">
      {label}
    </span>
  )
}

// ─── Metadata renderer per event type ────────────────────────────
function renderMetadata(entry: ActivityRow) {
  const m = entry.metadata || {}

  switch (entry.event_type) {
    case 'stage_change':
      if (m.from_stage && m.to_stage) {
        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            {stageBadge(m.from_stage)} <span className="text-muted">→</span> {stageBadge(m.to_stage)}
            {m.cleared_fields && (
              <span className="text-xs text-muted ml-1">
                (cleared: {(m.cleared_fields as string[]).join(', ')})
              </span>
            )}
          </div>
        )
      }
      return null

    case 'agreement_signed':
      return (
        <div className="text-xs text-muted space-y-0.5">
          {m.quote_total && <div>Quote: <span className="text-slate-300">${Number(m.quote_total).toLocaleString()}</span></div>}
          {m.deposit_amount && <div>Deposit: <span className="text-slate-300">${Number(m.deposit_amount).toLocaleString()}</span></div>}
          {m.payment_method && <div>Payment: <span className="text-slate-300 capitalize">{m.payment_method}</span></div>}
          {m.signed_by && <div>Signed by: <span className="text-slate-300">{m.signed_by}</span></div>}
        </div>
      )

    case 'lead_lost':
      return m.reason ? (
        <div className="text-xs text-red-400/80">Reason: {String(m.reason)}</div>
      ) : null

    case 'lead_followup':
      return (
        <div className="text-xs text-muted">
          {m.followup_date && <div>Date: <span className="text-slate-300">{m.followup_date}</span></div>}
          {m.followup_notes && <div>Notes: <span className="text-slate-300">{String(m.followup_notes)}</span></div>}
        </div>
      )

    case 'job_created':
      return (
        <div className="text-xs text-muted">
          {m.install_preference && <div>Preference: <span className="text-slate-300 capitalize">{String(m.install_preference).replace('_', ' ')}</span></div>}
          {m.install_date && <div>Date: <span className="text-slate-300">{m.install_date}</span></div>}
        </div>
      )

    case 'call_logged':
      return (
        <div className="text-xs text-muted">
          {m.outcome && <div>Outcome: <span className="text-slate-300 capitalize">{String(m.outcome).replace(/_/g, ' ')}</span></div>}
          {m.notes && <div>Notes: <span className="text-slate-300">{String(m.notes)}</span></div>}
        </div>
      )

    case 'lead_dnd':
      return m.previous_stage ? (
        <div className="text-xs text-muted">From: {stageBadge(m.previous_stage)}</div>
      ) : null

    case 'rep_changed':
      return (
        <div className="text-xs text-muted">
          {m.from_rep && <span>{String(m.from_rep)}</span>}
          {m.from_rep && m.to_rep && <span className="mx-1">→</span>}
          {m.to_rep && <span className="text-slate-300">{String(m.to_rep)}</span>}
        </div>
      )

    case 'field_updated':
      return (
        <div className="text-xs text-muted">
          {m.field_name}: {m.old_value ? `${m.old_value} → ` : ''}<span className="text-slate-300">{m.new_value}</span>
        </div>
      )

    default:
      return null
  }
}

// ─── Component ───────────────────────────────────────────────────
interface Props {
  activity: ActivityRow[]
  isLoading?: boolean
}

export function ActivityFeed({ activity, isLoading }: Props) {
  if (isLoading) {
    return <p className="text-sm text-muted text-center py-8">Loading activity...</p>
  }

  if (!activity?.length) {
    return <p className="text-sm text-muted text-center py-8">No activity yet.</p>
  }

  return (
    <div className="space-y-0">
      {activity.map((entry, idx) => {
        const config = EVENT_CONFIG[entry.event_type] || { icon: '•', color: 'bg-muted' }
        const meta = renderMetadata(entry)

        return (
          <div key={entry.id} className="flex gap-3 relative">
            {/* Timeline line */}
            {idx < activity.length - 1 && (
              <div className="absolute left-[11px] top-7 bottom-0 w-px bg-border" />
            )}

            {/* Icon */}
            <div className={`w-6 h-6 rounded-full ${config.color} flex items-center justify-center flex-shrink-0 text-xs text-white z-10`}>
              {config.icon}
            </div>

            {/* Content */}
            <div className="flex-1 pb-4 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm text-slate-200 font-medium leading-tight">
                  {entry.title}
                </div>
                <div className="text-xs text-muted whitespace-nowrap flex-shrink-0">
                  {formatTimestamp(entry.created_at)}
                </div>
              </div>

              {meta && <div className="mt-1">{meta}</div>}

              {entry.actor_name && (
                <div className="text-xs text-muted mt-1">
                  by {entry.actor_name}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
