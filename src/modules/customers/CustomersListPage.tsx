import { useState, useEffect } from 'react'
import { useCustomers } from './useCustomers'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Customer, CustomerLifecycle } from './customers.types'
import { LIFECYCLE_LABELS, LIFECYCLE_COLORS } from './customers.types'
import { AtRiskReasonModal, type AtRiskReasonResult } from '../leads/modals/AtRiskReasonModal'

function useIsMobile() {
  const [v, setV] = useState(window.innerWidth < 768)
  useEffect(() => { const h = () => setV(window.innerWidth < 768); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h) }, [])
  return v
}

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

function CustomerCard({ c, onClick, accentColor, borderColor, onMarkAtRisk }: {
  c: Customer
  onClick: () => void
  accentColor: string
  borderColor: string
  onMarkAtRisk?: (e: React.MouseEvent) => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered
          ? `linear-gradient(135deg, ${accentColor}0d 0%, #0f1923 100%)`
          : `linear-gradient(135deg, #0f1923 0%, #111e2e 100%)`,
        border: `1px solid ${borderColor}`,
        borderLeft: `3px solid ${accentColor}`,
        borderRadius: 10,
        padding: '12px 12px 10px',
        cursor: 'pointer',
        transition: 'all 0.15s',
        marginBottom: 8,
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
        boxShadow: hovered ? `0 4px 16px ${accentColor}20` : 'none',
      }}
    >
      {/* Avatar + name row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
          background: `${accentColor}20`,
          border: `2px solid ${accentColor}55`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: accentColor, fontWeight: 800, fontSize: 14,
          textTransform: 'uppercase',
        }}>
          {c.full_name?.charAt(0) || '?'}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            color: '#f1f5f9', fontWeight: 700, fontSize: 13,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {c.full_name}
          </div>
          {c.phone && (
            <div style={{ color: '#64748b', fontSize: 11, marginTop: 1 }}>{c.phone}</div>
          )}
        </div>
        {/* At Risk button — shows on hover for non-at_risk cards */}
        {onMarkAtRisk && hovered && (
          <button
            onClick={e => { e.stopPropagation(); onMarkAtRisk(e) }}
            title="Mark as At Risk"
            style={{
              flexShrink: 0, padding: '3px 8px', borderRadius: 6,
              background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#f87171', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            ⚠ At Risk
          </button>
        )}
      </div>

      {/* Details */}
      {(c.service_address || c.email) && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${accentColor}18` }}>
          {c.service_address && (
            <div style={{
              color: '#475569', fontSize: 11,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: c.email ? 3 : 0,
            }}>
              📍 {c.service_address}
            </div>
          )}
          {c.email && (
            <div style={{
              color: '#475569', fontSize: 11,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              ✉ {c.email}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function CustomersListPage() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const { data: customers, isLoading, error, refetch } = useCustomers()
  const [search, setSearch] = useState('')
  const [mobileTab, setMobileTab] = useState<CustomerLifecycle>('active')
  const [atRiskTarget, setAtRiskTarget] = useState<Customer | null>(null)
  const [atRiskPending, setAtRiskPending] = useState(false)

  async function handleAtRiskSubmit(result: AtRiskReasonResult) {
    if (!atRiskTarget) return
    setAtRiskPending(true)
    try {
      await supabase
        .from('customers')
        .update({
          lifecycle_status: 'at_risk',
          at_risk_reason_code: result.reasonCode,
          at_risk_reason_label: result.reasonLabel,
          at_risk_notes: result.freeText,
          at_risk_flagged_at: new Date().toISOString(),
        })
        .eq('id', atRiskTarget.id)

      if (result.reEngageDate) {
        await supabase.from('follow_up_tasks').insert({
          entity_type: 'customer', entity_id: atRiskTarget.id,
          title: `Re-engage: ${atRiskTarget.full_name} (At Risk — ${result.reasonLabel})`,
          description: result.freeText || `Customer marked at risk: ${result.reasonLabel}`,
          due_date: result.reEngageDate,
          status: 'pending', priority: 'high',
        }).catch(() => {})
      }

      setAtRiskTarget(null)
      refetch?.()
    } catch (e) {
      console.error('At risk update failed:', e)
    } finally {
      setAtRiskPending(false)
    }
  }

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

  // ── MOBILE LAYOUT ─────────────────────────────────────────
  if (isMobile) {
    const activeCol = COLUMNS.find(c => c.key === mobileTab)!
    const cards = filterCustomers(byStatus[mobileTab] || [])

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ flexShrink: 0, paddingBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <h1 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 18, margin: 0 }}>Customers</h1>
              <div style={{ color: '#64748b', fontSize: 12, marginTop: 1 }}>{allCustomers.length} total</div>
            </div>
          </div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, phone, address…"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8,
              color: '#e2e8f0', padding: '9px 14px', fontSize: 13, outline: 'none',
            }}
          />
        </div>

        {/* Stage tabs — scrollable */}
        <div style={{ flexShrink: 0, display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 10, scrollbarWidth: 'none' }}>
          {COLUMNS.map(col => {
            const count = filterCustomers(byStatus[col.key] || []).length
            const isActive = mobileTab === col.key
            return (
              <button
                key={col.key}
                onClick={() => setMobileTab(col.key)}
                style={{
                  flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
                  padding: '7px 12px', borderRadius: 20,
                  border: `1px solid ${isActive ? col.color : col.border}`,
                  background: isActive ? `${col.color}20` : '#0c1a26',
                  color: isActive ? col.color : '#64748b',
                  fontSize: 12, fontWeight: isActive ? 700 : 500, cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: 13 }}>{col.icon}</span>
                <span>{col.label}</span>
                <span style={{
                  background: isActive ? `${col.color}30` : '#1e3a4f',
                  color: isActive ? col.color : '#64748b',
                  borderRadius: 10, padding: '1px 6px', fontSize: 11, fontWeight: 700,
                }}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Cards — scrollable */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {cards.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 12px', color: '#334155', fontSize: 13 }}>
              {search ? 'No matches' : 'No customers'}
            </div>
          ) : (
            cards.map(c => (
              <CustomerCard
                key={c.id} c={c}
                accentColor={activeCol.color} borderColor={activeCol.border}
                onClick={() => navigate(`/customers/${c.id}`)}
                onMarkAtRisk={activeCol.key !== 'at_risk' ? () => setAtRiskTarget(c) : undefined}
              />
            ))
          )}
        </div>

        {atRiskTarget && (
          <AtRiskReasonModal
            onSubmit={handleAtRiskSubmit}
            onCancel={() => setAtRiskTarget(null)}
            isPending={atRiskPending}
          />
        )}
      </div>
    )
  }

  // ── DESKTOP LAYOUT ────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Top bar */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, padding: '0 0 16px 0', flexWrap: 'wrap',
      }}>
        <div>
          <h1 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 20, margin: 0 }}>Customers</h1>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>{allCustomers.length} total</div>
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

      {/* Kanban columns */}
      <div style={{ flex: 1, display: 'flex', gap: 12, overflow: 'hidden', minHeight: 0 }}>
        {COLUMNS.map(col => {
          const cards = filterCustomers(byStatus[col.key] || [])
          return (
            <div
              key={col.key}
              style={{
                flex: '1 1 0', minWidth: 200, display: 'flex', flexDirection: 'column',
                background: '#0c1a26', border: `1px solid ${col.border}`, borderRadius: 12, overflow: 'hidden',
              }}
            >
              <div style={{
                background: col.headerBg, padding: '12px 14px', borderBottom: `1px solid ${col.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexShrink: 0, borderTop: `3px solid ${col.color}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ fontSize: 16 }}>{col.icon}</span>
                  <span style={{ color: col.color, fontWeight: 800, fontSize: 14, letterSpacing: '0.01em' }}>{col.label}</span>
                </div>
                <div style={{
                  background: col.color + '25', color: col.color, border: `1px solid ${col.color}40`,
                  borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 800, minWidth: 26, textAlign: 'center',
                }}>
                  {cards.length}
                </div>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '10px', scrollbarWidth: 'thin', scrollbarColor: '#1e3a4f transparent' }}>
                {cards.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '32px 12px', color: '#334155', fontSize: 12 }}>
                    {search ? 'No matches' : 'No customers'}
                  </div>
                ) : (
                  cards.map(c => (
                    <CustomerCard
                      key={c.id} c={c}
                      accentColor={col.color} borderColor={col.border}
                      onClick={() => navigate(`/customers/${c.id}`)}
                      onMarkAtRisk={col.key !== 'at_risk' ? () => setAtRiskTarget(c) : undefined}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      {atRiskTarget && (
        <AtRiskReasonModal
          onSubmit={handleAtRiskSubmit}
          onCancel={() => setAtRiskTarget(null)}
          isPending={atRiskPending}
        />
      )}
    </div>
  )
}
