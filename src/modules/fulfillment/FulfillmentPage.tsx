// src/modules/fulfillment/FulfillmentPage.tsx
// Service Fulfillment Queue — shows customers who paid and need scheduling

import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchFulfillmentRequests,
  markScheduled,
  markInProgress,
  markCompleted,
  cancelRequest,
  type FulfillmentRequest,
  type FulfillmentStatus,
} from '../../services/fulfillmentService'

// ── Helpers ──────────────────────────────────────────────────────

function timeAgo(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const days = Math.floor(diffMs / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

function daysSince(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - d.getTime()) / 86400000)
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  paid_awaiting_schedule: { bg: 'rgba(251,191,36,0.12)', text: '#fbbf24', border: 'rgba(251,191,36,0.25)', label: 'Awaiting Schedule' },
  scheduled:              { bg: 'rgba(96,165,250,0.12)', text: '#60a5fa', border: 'rgba(96,165,250,0.25)', label: 'Scheduled' },
  in_progress:            { bg: 'rgba(168,85,247,0.12)', text: '#a855f7', border: 'rgba(168,85,247,0.25)', label: 'In Progress' },
  completed:              { bg: 'rgba(74,222,128,0.12)', text: '#4ade80', border: 'rgba(74,222,128,0.25)', label: 'Completed' },
  cancelled:              { bg: 'rgba(248,113,113,0.12)', text: '#f87171', border: 'rgba(248,113,113,0.25)', label: 'Cancelled' },
}

const TYPE_LABELS: Record<string, string> = {
  tech_visit: '🔧 Tech Visit',
  maintenance_visit: '⚙️ Maintenance',
  shipment: '📦 Shipment',
}

// ── Tab Config ───────────────────────────────────────────────────

interface TabDef {
  key: string
  label: string
  icon: string
  filter: FulfillmentStatus[] | null
  color: string
}

const TABS: TabDef[] = [
  { key: 'awaiting',    label: 'Awaiting Schedule', icon: '🔔', filter: ['paid_awaiting_schedule'], color: '#fbbf24' },
  { key: 'scheduled',   label: 'Scheduled',         icon: '📅', filter: ['scheduled'],              color: '#60a5fa' },
  { key: 'in_progress', label: 'In Progress',       icon: '⚡', filter: ['in_progress'],            color: '#a855f7' },
  { key: 'completed',   label: 'Completed',         icon: '✅', filter: ['completed'],              color: '#4ade80' },
  { key: 'all',         label: 'All',               icon: '📋', filter: null,                       color: '#94a3b8' },
]

// ── Status Badge Component ───────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.cancelled
  return (
    <span style={{
      fontSize: 10, padding: '3px 8px', borderRadius: 12, fontWeight: 600,
      background: s.bg, color: s.text, border: `1px solid ${s.border}`, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

// ── Detail Drawer ────────────────────────────────────────────────

function DetailDrawer({
  fr, onClose, onAction,
}: {
  fr: FulfillmentRequest
  onClose: () => void
  onAction: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [scheduleDate, setScheduleDate] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [showCancel, setShowCancel] = useState(false)

  const customer = fr.customers
  const plan = fr.customer_service_plans

  const scheduleMut = useMutation({
    mutationFn: () => markScheduled(fr.id, '', scheduleDate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fulfillment'] })

      // ── fulfillment_scheduled_sms (fire-and-forget) ─────────
      if (customer?.phone) {
        const dateLabel = scheduleDate
          ? new Date(scheduleDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
          : ''
        fetch('/api/automations/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: 'fulfillment_scheduled_sms',
            to: customer.phone,
            entity_type: 'customer',
            entity_id: fr.customer_id,
            variables: {
              name: (customer.full_name || 'there').split(' ')[0],
              date: dateLabel,
              time: '',
            },
          }),
        }).catch(() => {})
      }

      onAction()
    },
  })

  const inProgressMut = useMutation({
    mutationFn: () => markInProgress(fr.id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['fulfillment'] }); onAction() },
  })

  const completeMut = useMutation({
    mutationFn: () => markCompleted(fr.id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['fulfillment'] }); onAction() },
  })

  const cancelMut = useMutation({
    mutationFn: () => cancelRequest(fr.id, cancelReason),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['fulfillment'] }); onAction() },
  })

  const daysPending = daysSince(fr.due_date)
  const isOverdue = fr.status === 'paid_awaiting_schedule' && daysPending > 7

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />

      <div style={{
        position: 'relative', width: '100%', maxWidth: 480, background: '#162232',
        borderLeft: '1px solid #1e3a4f', overflowY: 'auto', padding: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>
            Fulfillment Request
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {isOverdue && (
          <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 10, padding: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#f87171' }}>⚠️ Overdue — {daysPending} days since payment</div>
            <div style={{ fontSize: 11, color: '#fca5a5', marginTop: 4 }}>Customer paid but has not been contacted to schedule service.</div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <StatusBadge status={fr.status} />
          <span style={{ fontSize: 11, color: '#94a3b8', padding: '3px 8px', borderRadius: 12, background: 'rgba(148,163,184,0.1)', border: '1px solid rgba(148,163,184,0.2)' }}>
            {TYPE_LABELS[fr.type] || fr.type}
          </span>
        </div>

        <div style={{ background: '#0f1923', borderRadius: 10, border: '1px solid #1e3a4f', padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Customer</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#e2e8f0' }}>{customer?.full_name || 'Unknown'}</div>
          {customer?.phone && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>📞 {customer.phone}</div>}
          {customer?.email && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>✉️ {customer.email}</div>}
          <button onClick={() => navigate(`/customers/${fr.customer_id}`)} style={{ marginTop: 10, fontSize: 11, color: '#0d7ea3', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
            View Customer Profile →
          </button>
        </div>

        <div style={{ background: '#0f1923', borderRadius: 10, border: '1px solid #1e3a4f', padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Service Plan</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{plan?.service_plans?.name || 'Unknown plan'}</div>
          {plan?.service_plans?.name && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Template: {plan.service_plans.name}</div>}
        </div>

        <div style={{ background: '#0f1923', borderRadius: 10, border: '1px solid #1e3a4f', padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Timeline</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: '#64748b' }}>Due Date</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{formatDate(fr.due_date)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#64748b' }}>Payment Date</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{formatDate(fr.created_at?.split('T')[0])}</div>
            </div>
            {fr.scheduled_date && (
              <div>
                <div style={{ fontSize: 10, color: '#64748b' }}>Scheduled For</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#60a5fa' }}>{formatDate(fr.scheduled_date)}</div>
              </div>
            )}
            {fr.completed_at && (
              <div>
                <div style={{ fontSize: 10, color: '#64748b' }}>Completed</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#4ade80' }}>{formatDate(fr.completed_at.split('T')[0])}</div>
              </div>
            )}
          </div>
        </div>

        {fr.notes && (
          <div style={{ background: '#0f1923', borderRadius: 10, border: '1px solid #1e3a4f', padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Notes</div>
            <div style={{ fontSize: 13, color: '#cbd5e1' }}>{fr.notes}</div>
          </div>
        )}

        {fr.status === 'paid_awaiting_schedule' && (
          <div style={{ background: '#0f1923', borderRadius: 10, border: '1px solid #1e3a4f', padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 10 }}>Schedule Visit</div>
            <input
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13, background: '#162232', color: '#e2e8f0', border: '1px solid #1e3a4f', marginBottom: 10 }}
            />
            <button
              onClick={() => scheduleMut.mutate()}
              disabled={!scheduleDate || scheduleMut.isPending}
              style={{ width: '100%', padding: '10px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, background: '#0d7ea3', color: '#fff', border: 'none', cursor: 'pointer', opacity: !scheduleDate || scheduleMut.isPending ? 0.5 : 1 }}
            >
              {scheduleMut.isPending ? 'Scheduling...' : '📅 Mark Scheduled'}
            </button>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
              Customer will receive a confirmation SMS when scheduled.
            </div>
          </div>
        )}

        {fr.status === 'scheduled' && (
          <button
            onClick={() => inProgressMut.mutate()}
            disabled={inProgressMut.isPending}
            style={{ width: '100%', padding: '12px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, background: '#7c3aed', color: '#fff', border: 'none', cursor: 'pointer', marginBottom: 12, opacity: inProgressMut.isPending ? 0.5 : 1 }}
          >
            {inProgressMut.isPending ? 'Updating...' : '⚡ Mark In Progress'}
          </button>
        )}

        {fr.status === 'in_progress' && (
          <button
            onClick={() => completeMut.mutate()}
            disabled={completeMut.isPending}
            style={{ width: '100%', padding: '12px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, background: '#16a34a', color: '#fff', border: 'none', cursor: 'pointer', marginBottom: 12, opacity: completeMut.isPending ? 0.5 : 1 }}
          >
            {completeMut.isPending ? 'Completing...' : '✅ Mark Completed'}
          </button>
        )}

        {['paid_awaiting_schedule', 'scheduled'].includes(fr.status) && (
          <>
            {!showCancel ? (
              <button
                onClick={() => setShowCancel(true)}
                style={{ width: '100%', padding: '10px 0', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'rgba(248,113,113,0.1)', color: '#f87171', border: '1px solid rgba(248,113,113,0.25)', cursor: 'pointer' }}
              >
                Cancel Request
              </button>
            ) : (
              <div style={{ background: '#0f1923', borderRadius: 10, border: '1px solid rgba(248,113,113,0.25)', padding: 16 }}>
                <input
                  type="text"
                  placeholder="Reason for cancellation (optional)"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 12, background: '#162232', color: '#e2e8f0', border: '1px solid #1e3a4f', marginBottom: 10 }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => cancelMut.mutate()}
                    disabled={cancelMut.isPending}
                    style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer' }}
                  >
                    {cancelMut.isPending ? 'Cancelling...' : 'Confirm Cancel'}
                  </button>
                  <button
                    onClick={() => setShowCancel(false)}
                    style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#1e3a4f', color: '#94a3b8', border: 'none', cursor: 'pointer' }}
                  >
                    Never mind
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────

export function FulfillmentPage() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('awaiting')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const currentTab = TABS.find(t => t.key === activeTab) || TABS[0]

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['fulfillment', 'list', currentTab.filter],
    queryFn: () =>
      currentTab.filter
        ? fetchFulfillmentRequests({ status: currentTab.filter })
        : fetchFulfillmentRequests(),
    refetchInterval: 30_000,
  })

  const filtered = search.trim()
    ? items.filter((fr) => {
        const q = search.toLowerCase()
        return (
          fr.customers?.full_name?.toLowerCase().includes(q) ||
          fr.customer_service_plans?.service_plans?.name?.toLowerCase().includes(q)
        )
      })
    : items

  const { data: allItems = [] } = useQuery({
    queryKey: ['fulfillment', 'counts'],
    queryFn: () => fetchFulfillmentRequests(),
    refetchInterval: 30_000,
  })

  const tabCounts: Record<string, number> = {
    awaiting: allItems.filter(i => i.status === 'paid_awaiting_schedule').length,
    scheduled: allItems.filter(i => i.status === 'scheduled').length,
    in_progress: allItems.filter(i => i.status === 'in_progress').length,
    completed: allItems.filter(i => i.status === 'completed').length,
    all: allItems.length,
  }

  const selectedFr = selectedId ? items.find(i => i.id === selectedId) : null

  return (
    <div style={{ padding: '24px 20px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>Service Fulfillment Queue</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>Customers who paid — schedule their service</p>
        </div>
        <input
          type="text"
          placeholder="Search by customer or plan..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '8px 14px', borderRadius: 8, fontSize: 13, width: 260, background: '#162232', color: '#e2e8f0', border: '1px solid #1e3a4f' }}
        />
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20, overflowX: 'auto', paddingBottom: 4 }}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key
          const count = tabCounts[tab.key] ?? 0
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
                borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                background: isActive ? 'rgba(13,126,163,0.15)' : '#162232',
                color: isActive ? '#0d7ea3' : '#94a3b8',
                border: isActive ? '1px solid rgba(13,126,163,0.3)' : '1px solid #1e3a4f',
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              {count > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: isActive ? 'rgba(13,126,163,0.25)' : 'rgba(148,163,184,0.1)', color: isActive ? '#0d7ea3' : '#64748b' }}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#64748b', background: '#162232', borderRadius: 12, border: '1px solid #1e3a4f' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>{activeTab === 'awaiting' ? '🎉' : '📋'}</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{activeTab === 'awaiting' ? 'All caught up!' : 'No requests found'}</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>{activeTab === 'awaiting' ? 'No customers waiting to be scheduled right now.' : 'No fulfillment requests match this filter.'}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((fr) => {
            const daysPending = daysSince(fr.due_date)
            const isOverdue = fr.status === 'paid_awaiting_schedule' && daysPending > 7
            return (
              <div
                key={fr.id}
                onClick={() => setSelectedId(fr.id)}
                style={{ background: '#162232', borderRadius: 10, padding: '14px 18px', border: isOverdue ? '1px solid rgba(248,113,113,0.35)' : '1px solid #1e3a4f', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, transition: 'border-color 0.15s' }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#0d7ea3')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = isOverdue ? 'rgba(248,113,113,0.35)' : '#1e3a4f')}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{fr.customers?.full_name || 'Unknown'}</span>
                    <StatusBadge status={fr.status} />
                    {isOverdue && <span style={{ fontSize: 10, color: '#f87171', fontWeight: 700 }}>⚠️ {daysPending}d overdue</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    {fr.customer_service_plans?.service_plans?.name || 'Unknown plan'}
                    <span style={{ margin: '0 6px', color: '#334155' }}>·</span>
                    {TYPE_LABELS[fr.type] || fr.type}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>
                    {fr.status === 'paid_awaiting_schedule' && `Paid ${timeAgo(fr.created_at)}`}
                    {fr.status === 'scheduled' && `Visit: ${formatDate(fr.scheduled_date)}`}
                    {fr.status === 'in_progress' && 'In progress'}
                    {fr.status === 'completed' && `Done ${formatDate(fr.completed_at?.split('T')[0] || null)}`}
                    {fr.status === 'cancelled' && 'Cancelled'}
                  </div>
                  {fr.customers?.phone && (
                    <a href={`tel:${fr.customers.phone}`} onClick={(e) => e.stopPropagation()} style={{ fontSize: 11, color: '#0d7ea3', textDecoration: 'none' }}>
                      📞 {fr.customers.phone}
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {selectedFr && (
        <DetailDrawer
          fr={selectedFr}
          onClose={() => setSelectedId(null)}
          onAction={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}
