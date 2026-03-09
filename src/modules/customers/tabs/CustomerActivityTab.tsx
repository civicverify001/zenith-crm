import { useCustomerActivity } from '../useCustomers'

interface Props { customerId: string }

const EVENT_ICONS: Record<string, string> = {
  customer_created: '👤',
  system_installed: '🔧',
  service_completed: '✅',
  replacement_sold: '🔄',
  proof_received: '📷',
  contract_created: '📋',
  buyout_completed: '💰',
  warranty_changed: '🛡️',
  maintenance_renewed: '📅',
  status_change: '→',
  note_added: '📝',
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function CustomerActivityTab({ customerId }: Props) {
  const { data: activity, isLoading } = useCustomerActivity(customerId)

  if (isLoading) return <p className="text-sm text-muted text-center py-8">Loading activity...</p>
  if (!activity?.length) return <p className="text-sm text-muted text-center py-8">No activity yet.</p>

  return (
    <div className="space-y-1">
      {activity.map((entry: any) => (
        <div key={entry.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-surface transition-colors">
          <div className="w-8 h-8 rounded-full bg-card border border-border flex items-center justify-center text-sm flex-shrink-0">
            {EVENT_ICONS[entry.event_type] || '•'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-slate-200">{entry.title}</div>
            <div className="text-xs text-muted">
              by {entry.actor_name || 'System'}
            </div>
          </div>
          <div className="text-xs text-muted flex-shrink-0">{timeAgo(entry.created_at)}</div>
        </div>
      ))}
    </div>
  )
}
