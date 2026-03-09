import { useCustomerActivity } from '../useCustomers'

interface Props { customerId: string }

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function relativeTime(d: string): string {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(d)
}

const EVENT_ICONS: Record<string, string> = {
  customer_created: '👤',
  system_installed: '🔧',
  warranty_change: '🛡️',
  lifecycle_change: '📊',
  payment_recorded: '💳',
  buyout_completed: '🏠',
  consent_submitted: '📝',
  handover_submitted: '📋',
  rental_risk_change: '⚠️',
  service_completed: '✅',
  proof_submitted: '📎',
  proof_reviewed: '📎',
  maintenance_plan_created: '📅',
}

const EVENT_COLORS: Record<string, string> = {
  customer_created: '#4ade80',
  system_installed: '#38bdf8',
  warranty_change: '#fbbf24',
  lifecycle_change: '#c084fc',
  payment_recorded: '#4ade80',
  buyout_completed: '#4ade80',
  rental_risk_change: '#f87171',
}

export function CustomerActivityTab({ customerId }: Props) {
  const { data: activity, isLoading } = useCustomerActivity(customerId)

  if (isLoading) return <p className="text-sm text-muted text-center py-8">Loading activity...</p>
  if (!activity?.length) return <p className="text-sm text-muted text-center py-8">No activity recorded yet.</p>

  return (
    <div className="space-y-0">
      {(activity as any[]).map((entry, i) => {
        const icon = EVENT_ICONS[entry.event_type] || '📌'
        const color = EVENT_COLORS[entry.event_type] || '#94a3b8'

        return (
          <div key={entry.id || i} className="flex gap-3 py-3 border-b border-border/50 last:border-0">
            {/* Timeline dot */}
            <div className="flex flex-col items-center pt-0.5">
              <div className="text-sm">{icon}</div>
              {i < (activity as any[]).length - 1 && (
                <div className="w-px flex-1 mt-1" style={{ backgroundColor: 'rgba(148,163,184,0.15)' }} />
              )}
            </div>
            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium" style={{ color }}>{entry.title}</div>
                <div className="text-xs text-muted whitespace-nowrap flex-shrink-0">{relativeTime(entry.created_at)}</div>
              </div>
              {entry.actor_name && (
                <div className="text-xs text-muted mt-0.5">by {entry.actor_name}</div>
              )}
              {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                <MetadataDisplay metadata={entry.metadata} eventType={entry.event_type} />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MetadataDisplay({ metadata, eventType }: { metadata: Record<string, any>; eventType: string }) {
  // Show relevant metadata based on event type
  const items: string[] = []

  if (metadata.from && metadata.to) {
    items.push(`${metadata.from} → ${metadata.to}`)
  }
  if (metadata.system_type) items.push(`System: ${metadata.system_type.replace(/_/g, ' ')}`)
  if (metadata.ownership_type) items.push(`Type: ${metadata.ownership_type}`)
  if (metadata.buyout_price) items.push(`Buyout: $${Number(metadata.buyout_price).toLocaleString()}`)
  if (metadata.amount) items.push(`Amount: $${Number(metadata.amount).toFixed(2)}`)
  if (metadata.reason) items.push(metadata.reason)
  if (metadata.days_late) items.push(`${metadata.days_late} days late`)

  if (items.length === 0) return null

  return (
    <div className="text-xs text-muted mt-1">
      {items.join(' · ')}
    </div>
  )
}
