// src/modules/contracts/ContractsPage.tsx

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  fetchContracts,
  STATUS_LABELS, STATUS_COLORS, TYPE_LABELS, TYPE_COLORS,
  monthsElapsed,
  type Contract, type ContractStatus, type ContractType,
} from '../../services/contractsService'

// ─── Helpers ─────────────────────────────────────────────────

const fmt = (n: number | null | undefined) =>
  n != null ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n) : '—'

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold"
      style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}40` }}
    >
      {label}
    </span>
  )
}

// ─── Main Page ────────────────────────────────────────────────

type FilterStatus = 'all' | ContractStatus
type FilterType   = 'all' | ContractType

export function ContractsPage() {
  const navigate = useNavigate()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [fStatus, setFStatus]     = useState<FilterStatus>('all')
  const [fType, setFType]         = useState<FilterType>('all')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const data = await fetchContracts()
      setContracts(data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const filtered = contracts.filter(c => {
    if (fStatus !== 'all' && c.status !== fStatus) return false
    if (fType   !== 'all' && c.type   !== fType)   return false
    if (search) {
      const s = search.toLowerCase()
      return (
        (c.reference_number || '').toLowerCase().includes(s) ||
        (c.customer_name    || '').toLowerCase().includes(s) ||
        (c.system_type      || '').toLowerCase().includes(s)
      )
    }
    return true
  })

  const active   = contracts.filter(c => c.status === 'active').length
  const pending  = contracts.filter(c => c.status === 'pending').length
  const totalMRR = contracts
    .filter(c => c.status === 'active' && c.type === 'rental')
    .reduce((s, c) => s + (c.monthly_amount || 0), 0)

  const STATUSES: FilterStatus[] = ['all', 'active', 'pending', 'cancelled', 'completed', 'expired']
  const TYPES:    FilterType[]   = ['all', 'rental', 'purchase', 'financed']

  return (
    <div className="h-full flex flex-col" style={{ background: '#080d13' }}>

      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-slate-800/60">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Contracts</h1>
            <p className="text-sm text-slate-400 mt-0.5">All rental agreements, purchase contracts, and financing</p>
          </div>
        </div>

        {/* KPI bar */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: 'Active Contracts',  value: active,       color: '#22c55e' },
            { label: 'Pending Signature', value: pending,      color: '#f59e0b' },
            { label: 'Monthly Recurring', value: fmt(totalMRR), color: '#0ea5e9' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl p-3" style={{ background: 'rgba(148,163,184,0.05)', border: '1px solid rgba(148,163,184,0.1)' }}>
              <div className="text-xs text-slate-500 mb-1">{label}</div>
              <div className="text-xl font-bold" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by customer, contract #, or system type…"
            className="w-full rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500"
            style={{ background: 'rgba(148,163,184,0.07)', border: '1px solid rgba(148,163,184,0.15)' }}
          />
          <div className="flex gap-2 flex-wrap">
            {STATUSES.map(s => (
              <button
                key={s}
                onClick={() => setFStatus(s)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={fStatus === s
                  ? { background: '#0ea5e9', color: '#fff' }
                  : { background: 'rgba(148,163,184,0.07)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.12)' }
                }
              >
                {s === 'all' ? 'All Status' : STATUS_LABELS[s as ContractStatus]}
              </button>
            ))}
            <div className="w-px bg-slate-700 mx-1" />
            {TYPES.map(t => (
              <button
                key={t}
                onClick={() => setFType(t)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={fType === t
                  ? { background: '#a855f7', color: '#fff' }
                  : { background: 'rgba(148,163,184,0.07)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.12)' }
                }
              >
                {t === 'all' ? 'All Types' : TYPE_LABELS[t as ContractType]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-slate-500">Loading contracts…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <div className="text-3xl">📋</div>
            <div className="text-slate-400 text-sm">No contracts found</div>
          </div>
        ) : (
          filtered.map(c => {
            const displayId = c.reference_number || c.id.slice(0, 8).toUpperCase()
            return (
              <div
                key={c.id}
                onClick={() => navigate(`/contracts/${c.id}`)}
                className="rounded-xl p-4 cursor-pointer transition-all hover:translate-y-[-1px]"
                style={{ background: 'rgba(148,163,184,0.04)', border: '1px solid rgba(148,163,184,0.1)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">{c.customer_name}</span>
                      <Badge label={STATUS_LABELS[c.status]} color={STATUS_COLORS[c.status]} />
                      <Badge label={TYPE_LABELS[c.type]}     color={TYPE_COLORS[c.type]} />
                    </div>
                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-3">
                      <span>{displayId}</span>
                      {c.system_type && <span>· {c.system_type}</span>}
                      {c.start_date  && <span>· Started {fmtDate(c.start_date)}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {c.monthly_amount ? (
                      <div className="text-sm font-bold" style={{ color: '#0ea5e9' }}>{fmt(c.monthly_amount)}/mo</div>
                    ) : c.total_amount ? (
                      <div className="text-sm font-bold text-white">{fmt(c.total_amount)}</div>
                    ) : null}
                    {c.term_months && (
                      <div className="text-xs text-slate-500 mt-0.5">
                        {monthsElapsed(c)}/{c.term_months} mo
                      </div>
                    )}
                  </div>
                </div>

                {/* Mini progress for rentals */}
                {c.type === 'rental' && c.term_months && (
                  <div className="mt-3 h-1 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, (monthsElapsed(c) / c.term_months) * 100)}%`,
                        backgroundColor: '#0ea5e9',
                      }}
                    />
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
