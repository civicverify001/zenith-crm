// src/modules/contracts/ContractsPage.tsx

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import {
  fetchContracts, updateContractStatus, createContract,
  STATUS_LABELS, STATUS_COLORS, TYPE_LABELS, TYPE_COLORS,
  monthsElapsed, buyoutRemaining,
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

// ─── Detail Drawer ────────────────────────────────────────────

function ContractDetailDrawer({
  contract,
  onClose,
  onRefresh,
}: {
  contract: Contract
  onClose: () => void
  onRefresh: () => void
}) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const isAdmin = profile?.role === 'admin'
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason]         = useState('')
  const [busy, setBusy]             = useState(false)

  const months    = monthsElapsed(contract)
  const remaining = buyoutRemaining(contract)
  const progress  = contract.term_months ? Math.min(100, (months / contract.term_months) * 100) : 0

  async function handleStatus(status: ContractStatus) {
    if (status === 'cancelled' && !reason) {
      setCancelling(true)
      return
    }
    setBusy(true)
    try {
      await updateContractStatus(contract.id, status, reason)
      onRefresh()
      onClose()
    } catch (e: any) {
      alert(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative w-full max-w-lg h-full overflow-y-auto shadow-2xl"
        style={{ background: '#0d1117', borderLeft: '1px solid rgba(148,163,184,0.1)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold text-white">{contract.reference_number}</span>
              <Badge label={STATUS_LABELS[contract.status]} color={STATUS_COLORS[contract.status]} />
              <Badge label={TYPE_LABELS[contract.type]} color={TYPE_COLORS[contract.type]} />
            </div>
            <p className="text-sm text-slate-400 mt-1">{contract.customer_name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        <div className="p-6 space-y-6">

          {/* Progress bar (rental) */}
          {contract.type === 'rental' && contract.term_months && (
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                <span>Term Progress</span>
                <span>{months} of {contract.term_months} months ({Math.round(progress)}%)</span>
              </div>
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${progress}%`, backgroundColor: '#0ea5e9' }}
                />
              </div>
            </div>
          )}

          {/* Key financials */}
          <div className="grid grid-cols-2 gap-3">
            {[
              ['Monthly Amount', fmt(contract.monthly_amount)],
              ['Total Contract',  fmt(contract.total_amount)],
              ['Amount Paid',     fmt(contract.amount_paid)],
              ['Buyout Remaining', fmt(remaining)],
            ].map(([label, val]) => (
              <div key={label} className="rounded-xl p-3" style={{ background: 'rgba(148,163,184,0.05)', border: '1px solid rgba(148,163,184,0.1)' }}>
                <div className="text-xs text-slate-500 mb-1">{label}</div>
                <div className="text-base font-bold text-white">{val}</div>
              </div>
            ))}
          </div>

          {/* Details */}
          <div className="space-y-3 text-sm">
            {[
              ['Customer',     contract.customer_name],
              ['Phone',        contract.customer_phone],
              ['Email',        contract.customer_email],
              ['System',       contract.system_type || '—'],
              ['Start Date',   fmtDate(contract.start_date)],
              ['End Date',     fmtDate(contract.end_date)],
              ['Term',         contract.term_months ? `${contract.term_months} months` : '—'],
              ['Payment Day',  `Day ${contract.payment_day} of month`],
              ['Buyout Formula', contract.buyout_formula || '—'],
              ['Signed',       fmtDate(contract.signed_at)],
            ].map(([label, val]) => (
              <div key={label} className="flex justify-between">
                <span className="text-slate-500">{label}</span>
                <span className="text-slate-200 text-right max-w-xs">{val}</span>
              </div>
            ))}
          </div>

          {contract.notes && (
            <div className="rounded-xl p-3 text-sm text-slate-300" style={{ background: 'rgba(148,163,184,0.05)', border: '1px solid rgba(148,163,184,0.1)' }}>
              <div className="text-xs text-slate-500 mb-1">Notes</div>
              {contract.notes}
            </div>
          )}

          {contract.cancelled_reason && (
            <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <div className="text-xs text-red-400 mb-1">Cancellation Reason</div>
              <div className="text-red-300">{contract.cancelled_reason}</div>
            </div>
          )}

          {/* Actions */}
          {isAdmin && contract.status === 'active' && (
            <div className="pt-2 space-y-2">
              {!cancelling ? (
                <button
                  onClick={() => setCancelling(true)}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
                >
                  Cancel Contract
                </button>
              ) : (
                <div className="space-y-2">
                  <textarea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder="Cancellation reason (required)"
                    rows={3}
                    className="w-full rounded-xl text-sm px-3 py-2 text-slate-200 placeholder-slate-500 resize-none"
                    style={{ background: 'rgba(148,163,184,0.07)', border: '1px solid rgba(148,163,184,0.15)' }}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleStatus('cancelled')}
                      disabled={busy || !reason}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
                      style={{ background: '#ef4444', color: '#fff' }}
                    >
                      {busy ? 'Cancelling…' : 'Confirm Cancel'}
                    </button>
                    <button
                      onClick={() => setCancelling(false)}
                      className="flex-1 py-2.5 rounded-xl text-sm text-slate-400"
                      style={{ border: '1px solid rgba(148,163,184,0.15)' }}
                    >
                      Back
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {isAdmin && contract.status === 'pending' && (
            <button
              onClick={() => handleStatus('active')}
              disabled={busy}
              className="w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
              style={{ background: '#22c55e', color: '#fff' }}
            >
              {busy ? 'Activating…' : 'Activate Contract'}
            </button>
          )}

          <button
            onClick={() => navigate(`/customers/${contract.customer_id}`)}
            className="w-full py-2.5 rounded-xl text-sm text-slate-400 text-center"
            style={{ border: '1px solid rgba(148,163,184,0.15)' }}
          >
            View Customer →
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────

type FilterStatus = 'all' | ContractStatus
type FilterType   = 'all' | ContractType

export function ContractsPage() {
  const { profile } = useAuth()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [fStatus, setFStatus]     = useState<FilterStatus>('all')
  const [fType, setFType]         = useState<FilterType>('all')
  const [selected, setSelected]   = useState<Contract | null>(null)

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
        c.reference_number.toLowerCase().includes(s) ||
        (c.customer_name || '').toLowerCase().includes(s) ||
        (c.system_type   || '').toLowerCase().includes(s)
      )
    }
    return true
  })

  // Summary counts
  const active    = contracts.filter(c => c.status === 'active').length
  const pending   = contracts.filter(c => c.status === 'pending').length
  const totalMRR  = contracts.filter(c => c.status === 'active' && c.type === 'rental')
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
            { label: 'Active Contracts', value: active,                   color: '#22c55e' },
            { label: 'Pending Signature', value: pending,                 color: '#f59e0b' },
            { label: 'Monthly Recurring',  value: fmt(totalMRR),          color: '#0ea5e9' },
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
          filtered.map(c => (
            <div
              key={c.id}
              onClick={() => setSelected(c)}
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
                    <span>{c.reference_number}</span>
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
                    style={{ width: `${Math.min(100, (monthsElapsed(c) / c.term_months) * 100)}%`, backgroundColor: '#0ea5e9' }}
                  />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Detail drawer */}
      {selected && (
        <ContractDetailDrawer
          contract={selected}
          onClose={() => setSelected(null)}
          onRefresh={load}
        />
      )}
    </div>
  )
}
