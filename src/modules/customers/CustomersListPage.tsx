import { useState } from 'react'
import { useCustomers } from './useCustomers'
import { useNavigate } from 'react-router-dom'
import type { Customer, CustomerLifecycle } from './customers.types'
import { LIFECYCLE_LABELS, LIFECYCLE_COLORS } from './customers.types'

const TAB_STYLES: Record<string, { active: React.CSSProperties; inactive: React.CSSProperties }> = {
  all: {
    active: { backgroundColor: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.4)' },
    inactive: { backgroundColor: 'transparent', color: '#94a3b8', border: '1px solid rgba(148, 163, 184, 0.2)' },
  },
  active: {
    active: { backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.4)' },
    inactive: { backgroundColor: 'transparent', color: '#94a3b8', border: '1px solid rgba(148, 163, 184, 0.2)' },
  },
  service_due: {
    active: { backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.4)' },
    inactive: { backgroundColor: 'transparent', color: '#94a3b8', border: '1px solid rgba(148, 163, 184, 0.2)' },
  },
  renewal_due: {
    active: { backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.4)' },
    inactive: { backgroundColor: 'transparent', color: '#94a3b8', border: '1px solid rgba(148, 163, 184, 0.2)' },
  },
  upsell: {
    active: { backgroundColor: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.4)' },
    inactive: { backgroundColor: 'transparent', color: '#94a3b8', border: '1px solid rgba(148, 163, 184, 0.2)' },
  },
  at_risk: {
    active: { backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.4)' },
    inactive: { backgroundColor: 'transparent', color: '#94a3b8', border: '1px solid rgba(148, 163, 184, 0.2)' },
  },
}

export function CustomersListPage() {
  const navigate = useNavigate()
  const { data: customers, isLoading, error } = useCustomers()
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<CustomerLifecycle | 'all'>('all')

  if (isLoading) return <div className="flex items-center justify-center h-full"><div className="text-muted text-sm">Loading customers...</div></div>
  if (error) return <div className="flex items-center justify-center h-full"><div className="text-red text-sm">Failed to load customers.</div></div>

  const allCustomers = customers || []

  const filtered = allCustomers.filter(c => {
    if (filterStatus !== 'all' && c.lifecycle_status !== filterStatus) return false
    if (search) {
      const q = search.toLowerCase()
      return c.full_name.toLowerCase().includes(q) || c.phone.includes(q) || c.service_address.toLowerCase().includes(q)
    }
    return true
  })

  const statusCounts: Record<string, number> = { all: allCustomers.length }
  for (const c of allCustomers) {
    statusCounts[c.lifecycle_status] = (statusCounts[c.lifecycle_status] || 0) + 1
  }

  const tabs: { key: CustomerLifecycle | 'all'; label: string }[] = [
    { key: 'all', label: 'All' },
    ...Object.entries(LIFECYCLE_LABELS).map(([k, v]) => ({ key: k as CustomerLifecycle, label: v })),
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white">Customers</h1>
          <p className="text-sm text-muted mt-0.5">{filtered.length} customer{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
          className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent w-48" />
      </div>

      {/* Filter tabs — full width, colored */}
      <div className="mb-4 flex-shrink-0" style={{ display: 'grid', gridTemplateColumns: `repeat(${tabs.length}, 1fr)`, gap: '8px' }}>
        {tabs.map(tab => {
          const count = statusCounts[tab.key] || 0
          const isActive = filterStatus === tab.key
          const styles = TAB_STYLES[tab.key] || TAB_STYLES.all
          return (
            <button
              key={tab.key}
              onClick={() => setFilterStatus(tab.key)}
              style={{
                ...(isActive ? styles.active : styles.inactive),
                padding: '10px 8px',
                borderRadius: '12px',
                fontSize: '13px',
                fontWeight: 600,
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {tab.label}
              {count > 0 && (
                <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 700, opacity: 0.8 }}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-4xl mb-3">👥</div>
            <div className="text-slate-300">No customers yet</div>
            <div className="text-sm text-muted mt-1">Customers are created automatically when installations are completed.</div>
          </div>
        </div>
      ) : (
        <div className="space-y-2 flex-1 overflow-y-auto pb-4">
          {filtered.map(c => (
            <div key={c.id} onClick={() => navigate(`/customers/${c.id}`)}
              className="bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-accent/50 transition-all">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-bold text-white">{c.full_name}</h3>
                <span className={`stage-badge border text-xs ${LIFECYCLE_COLORS[c.lifecycle_status]}`}>
                  {LIFECYCLE_LABELS[c.lifecycle_status]}
                </span>
              </div>
              <div className="text-xs text-muted">{c.service_address}</div>
              <div className="text-xs text-muted">{c.phone}{c.email && ` · ${c.email}`}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}