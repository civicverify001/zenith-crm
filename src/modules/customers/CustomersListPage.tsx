import { useState } from 'react'
import { useCustomers } from './useCustomers'
import { useNavigate } from 'react-router-dom'
import type { Customer, CustomerLifecycle } from './customers.types'
import { LIFECYCLE_LABELS, LIFECYCLE_COLORS } from './customers.types'

// ── Column config ─────────────────────────────────────────────
const COLUMNS: {
  key: CustomerLifecycle
  label: string
  icon: string
  color: string
  bg: string
  border: string
  headerBg: string
}[] = [
  { key: 'active',       label: 'Active',       icon: '✓', color: '#4ade80', bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.25)',   headerBg: 'rgba(34,197,94,0.15)' },
  { key: 'service_due',  label: 'Service Due',  icon: '🔧', color: '#fbbf24', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.25)',  headerBg: 'rgba(245,158,11,0.15)' },
  { key: 'renewal_due',  label: 'Renewal Due',  icon: '↻', color: '#60a5fa', bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.25)',  headerBg: 'rgba(59,130,246,0.15)' },
  { key: 'upsell',       label: 'Upsell',       icon: '↑', color: '#c084fc', bg: 'rgba(168,85,247,0.08)',  border: 'rgba(168,85,247,0.25)',  headerBg: 'rgba(168,85,247,0.15)' },
  { key: 'at_risk',      label: 'At Risk',      icon: '⚠', color: '#f87171', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)',   headerBg: 'rgba(239,68,68,0.15)' },
  { key: 'inactive',     label: 'Inactive',     icon: '○', color: '#94a3b8', bg: 'rgba(148,163,184,0.05)', border: 'rgba(148,163,184,0.15)', headerBg: 'rgba(148,163,184,0.1)' },
]

function CustomerCard({ c, onClick, accentColor }: { c: Customer; onClick: () => void; accentColor: string }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: '#0f1923',
        border: '1px solid #1e3a4f',
        borderRadius: 10,
        padding: '12px 14px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, transform 0.1s',
        marginBottom: 8,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = accentColor
        ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = '#1e3a4f'
        ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'
      }}
    >
      {/* Avatar + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
          background: accentColor + '22', border: `1px solid ${accentColor}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: accentColor, fontWeight: 700, fontSize: 13,
        }}>
          {c.full_name?.charAt(0)?.toUpperCase() || '?'}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {c.full_name}
          </div>
          {c.phone && (
            <div style={{ color: '#64748b', fontSize: 11, marginTop: 1 }}>{c.phone}</div>
          )}
        </div>
      </div>

      {/* Address */}
      {c.service_address && (
        <div style={{
          color: '#475569', fontSize: 11, lineHeight: 1.4,
          borderTop: '1px solid #1e3a4f', paddingTop: 8, marginTop: 4,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          📍 {c.service_address}
        </div>
      )}

      {/* Email */}
      {c.email && (
        <div style={{
          color: '#475569', fontSize: 11, marginTop: 4,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          ✉ {c.email}
        </div>
      )}
    </div>
  )
}

export function CustomersListPage() {
  const navigate = useNavigate()
  const { data: customers, isLoading, error } = useCustomers()
  const [search, setSearch] = useState('')
  const [mobileTab, setMobileTab] = useState<CustomerLifecycle | 'all'>('all')

  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div style={{ color: '#64748b', fontSize: 14 }}>Loading customers...</div>
    </div>
  )
  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div style={{ color: '#f87171', fontSize: 14 }}>Failed to load customers.</div>
    </div>
  )

  const allCustomers = customers || []

  const byStatus: Record<string, Customer[]> = {}
  for (const col of COLUMNS) byStatus[col.key] = []
  for (const c of allCustomers) {
    if (byStatus[c.lifecycle_status]) byStatus[c.lifecycle_status].push(c)
    else byStatus['inactive'] = [...(byStatus['inactive'] || []), c]
  }

  // Search filter
  const filterCustomers = (list: Customer[]) => {
    if (!search) return list
    const q = search.toLowerCase()
    return list.filter(c =>
      c.full_name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      (c.service_address || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    )
  }

  const totalFiltered = allCustomers.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return c.full_name.toLowerCase().includes(q) || c.phone.includes(q)
  }).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Top bar ── */}
      <div style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '0 0 16px 0',
        flexWrap: 'wrap',
      }}>
        <div>
          <h1 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 20, margin: 0 }}>Customers</h1>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>
            {allCustomers.length} total
          </div>
        </div>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name, phone, address…"
          style={{
            background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8,
            color: '#e2e8f0', padding: '9px 14px', fontSize: 13, outline: 'none',
            width: 240, flexShrink: 0,
          }}
        />
      </div>

      {/* ── Summary strip ── */}
      <div style={{
        flexShrink: 0,
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        paddingBottom: 12,
        scrollbarWidth: 'none',
      }}>
        {COLUMNS.map(col => {
          const count = byStatus[col.key]?.length || 0
          return (
            <div
              key={col.key}
              onClick={() => setMobileTab(col.key)}
              style={{
                flexShrink: 0,
                background: col.bg,
                border: `1px solid ${col.border}`,
                borderRadius: 10,
                padding: '8px 14px',
                cursor: 'pointer',
                minWidth: 100,
                textAlign: 'center',
              }}
            >
              <div style={{ color: col.color, fontWeight: 800, fontSize: 18 }}>{count}</div>
              <div style={{ color: col.color, fontSize: 11, fontWeight: 600, marginTop: 2, opacity: 0.85 }}>{col.label}</div>
            </div>
          )
        })}
      </div>

      {/* ── Kanban columns ── */}
      <div style={{
        flex: 1,
        display: 'flex',
        gap: 12,
        overflow: 'hidden',
        minHeight: 0,
      }}>
        {COLUMNS.map(col => {
          const cards = filterCustomers(byStatus[col.key] || [])
          return (
            <div
              key={col.key}
              style={{
                flex: '1 1 0',
                minWidth: 200,
                display: 'flex',
                flexDirection: 'column',
                background: '#0c1a26',
                border: `1px solid ${col.border}`,
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              {/* Column header */}
              <div style={{
                background: col.headerBg,
                padding: '10px 14px',
                borderBottom: `1px solid ${col.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14 }}>{col.icon}</span>
                  <span style={{ color: col.color, fontWeight: 700, fontSize: 13 }}>{col.label}</span>
                </div>
                <div style={{
                  background: col.color + '22',
                  color: col.color,
                  borderRadius: 20,
                  padding: '2px 8px',
                  fontSize: 11,
                  fontWeight: 700,
                }}>
                  {cards.length}
                </div>
              </div>

              {/* Cards */}
              <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '10px 10px 10px',
                scrollbarWidth: 'thin',
                scrollbarColor: '#1e3a4f transparent',
              }}>
                {cards.length === 0 ? (
                  <div style={{
                    textAlign: 'center', padding: '32px 12px',
                    color: '#334155', fontSize: 12,
                  }}>
                    {search ? 'No matches' : 'No customers'}
                  </div>
                ) : (
                  cards.map(c => (
                    <CustomerCard
                      key={c.id}
                      c={c}
                      accentColor={col.color}
                      onClick={() => navigate(`/customers/${c.id}`)}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
