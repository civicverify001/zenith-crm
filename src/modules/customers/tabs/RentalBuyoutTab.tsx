import { useState } from 'react'
import { useRentalContracts, useRentalPayments, useBuyoutCalculations } from '../useCustomers'
import { useAuth } from '../../../hooks/useAuth'
import { useQueryClient } from '@tanstack/react-query'
import { CUSTOMER_KEYS } from '../useCustomers'
import { calculateBuyout, executeBuyout } from '../../../services/buyoutService'
import { RecordPaymentModal } from '../modals/RecordPaymentModal'
import { ExecuteBuyoutModal } from '../modals/ExecuteBuyoutModal'

interface Props { customerId: string }

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmt(n: number) { return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}` }

const RISK_STYLES: Record<string, { color: string; label: string }> = {
  at_risk: { color: '#fbbf24', label: 'At Risk' },
  delinquent: { color: '#f87171', label: 'Delinquent' },
  termination_pending: { color: '#f87171', label: 'Termination Pending' },
}

export function RentalBuyoutTab({ customerId }: Props) {
  const { data: contracts, isLoading } = useRentalContracts(customerId)

  if (isLoading) return <p className="text-sm text-muted text-center py-8">Loading rental contracts...</p>
  if (!contracts?.length) return <p className="text-sm text-muted text-center py-8">No rental contracts for this customer.</p>

  return (
    <div className="space-y-4">
      {(contracts as any[]).map(contract => (
        <ContractCard key={contract.id} contract={contract} customerId={customerId} />
      ))}
    </div>
  )
}

function ContractCard({ contract, customerId }: { contract: any; customerId: string }) {
  const { user, profile } = useAuth()
  const qc = useQueryClient()
  const { data: payments } = useRentalPayments(contract.id)
  const { data: buyouts } = useBuyoutCalculations(contract.id)
  const [showPayments, setShowPayments] = useState(false)
  const [paymentModal, setPaymentModal] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [showExecuteModal, setShowExecuteModal] = useState(false)
  const [error, setError] = useState('')

  const isActive = contract.status === 'active'
  const risk = contract.rental_risk_status
  const riskStyle = risk ? RISK_STYLES[risk] : null
  const statusColor = isActive ? '#4ade80' : contract.status === 'completed' ? '#38bdf8' : '#94a3b8'

  const latestBuyout = (buyouts as any[] || [])[0]
  const hasUnexecuted = latestBuyout && !latestBuyout.was_executed

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.rentals(customerId) })
    qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.buyouts(contract.id) })
    qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.payments(contract.id) })
    qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.systems(customerId) })
    qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.warranties(customerId) })
    qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.plans(customerId) })
    qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.activity(customerId) })
    qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.detail(customerId) })
  }

  async function handleCalculate() {
    if (!user) return
    setCalculating(true)
    setError('')
    try {
      await calculateBuyout(contract.id, user.id)
      invalidateAll()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCalculating(false)
    }
  }
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      {/* Contract header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-bold text-white">Contract {contract.contract_number || '—'}</div>
          <div className="text-xs text-muted">{contract.term_months || '—'} month term</div>
        </div>
        <div className="flex items-center gap-2">
          {riskStyle && (
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{
              backgroundColor: `${riskStyle.color}20`, color: riskStyle.color,
            }}>
              ⚠️ {riskStyle.label}
            </span>
          )}
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold capitalize" style={{
            backgroundColor: `${statusColor}20`, color: statusColor,
          }}>
            {contract.status}
          </span>
        </div>
      </div>

      {/* Contract details */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs mb-3">
        <Field label="Monthly" value={fmt(contract.monthly_amount || 0)} />
        <Field label="Payments Made" value={String(contract.payments_made || 0)} />
        <Field label="Total Paid" value={fmt(contract.total_paid || 0)} />
        <Field label="Install Fees" value={fmt(contract.total_install_fees || 0)} />
        <Field label="Start Date" value={formatDate(contract.start_date)} />
        <Field label="End Date" value={formatDate(contract.end_date)} />
        {contract.last_payment_date && <Field label="Last Payment" value={formatDate(contract.last_payment_date)} />}
      </div>

      {/* Action buttons for active contracts */}
      {isActive && (
        <div className="flex flex-wrap gap-2 mb-3">
          <button onClick={() => setPaymentModal(true)}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors"
            style={{ backgroundColor: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)' }}>
            💳 Record Payment
          </button>
          <button onClick={handleCalculate} disabled={calculating}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'rgba(56,189,248,0.12)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.25)' }}>
            {calculating ? 'Calculating...' : '🧮 Calculate Buyout'}
          </button>
          {hasUnexecuted && (
            <button onClick={() => setShowExecuteModal(true)}
              className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors"
              style={{ backgroundColor: 'rgba(168,85,247,0.12)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.25)' }}>
              🏠 Execute Buyout
           </button>
        )}

      {error && (
        <div className="mb-3 text-xs rounded-lg px-3 py-2" style={{ color: '#f87171', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </div>
      )}

      {/* Buyout status */}
      {contract.buyout_completed ? (
        <div className="rounded-lg p-3 mb-3" style={{ backgroundColor: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
          <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#4ade80' }}>Buyout Complete</div>
          <div className="text-xs text-muted">Completed {formatDate(contract.buyout_date)}</div>
        </div>
      ) : latestBuyout ? (
        <div className="rounded-lg p-3 mb-3" style={{ backgroundColor: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)' }}>
          <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#38bdf8' }}>
            {latestBuyout.was_executed ? 'Buyout Executed' : 'Latest Buyout Calculation'}
          </div>
          <div className="text-xs space-y-0.5">
            <div className="text-slate-300">Buyout price: <span className="font-semibold text-white">{fmt(latestBuyout.buyout_price)}</span></div>
            <div className="text-muted">Retail: {fmt(latestBuyout.current_retail_total)} — Credit: {fmt(latestBuyout.applied_rental_credit || latestBuyout.rental_credit_applied || 0)}</div>
            <div className="text-muted">Install reimb: {fmt(latestBuyout.install_reimbursement || 0)}</div>
            <div className="text-muted">Calculated {formatDate(latestBuyout.calculated_at)}</div>
            {!latestBuyout.was_executed && (
              <div className="text-xs mt-1" style={{ color: '#fbbf24' }}>⏳ Not yet executed — click "Execute Buyout" above</div>
            )}
          </div>
        </div>
      ) : isActive ? (
        <div className="rounded-lg p-3 mb-3" style={{ backgroundColor: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.15)' }}>
          <div className="text-xs text-muted">No buyout calculation yet. Click "Calculate Buyout" to see the price.</div>
        </div>
      ) : null}

      {/* Payment history */}
      {(payments || []).length > 0 && (
        <div>
          <button onClick={() => setShowPayments(!showPayments)} className="text-xs hover:underline" style={{ color: '#38bdf8' }}>
            {showPayments ? 'Hide' : 'Show'} payment history ({(payments || []).length})
          </button>
          {showPayments && (
            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
              {(payments as any[]).map((p, i) => (
                <div key={p.id || i} className="flex items-center justify-between text-xs py-1.5 border-b border-border/50 last:border-0">
                  <span className="text-muted">{formatDate(p.payment_date)}</span>
                  <span className="text-slate-300">{fmt(p.amount)}</span>
                  <span style={{ color: p.status === 'paid' ? '#4ade80' : p.status === 'reversed' ? '#f87171' : '#94a3b8' }}>
                    {p.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Payment modal */}
          {showExecuteModal && (
  <ExecuteBuyoutModal
    contract={contract}
    customerId={customerId}
    calculation={latestBuyout}
    onClose={() => setShowExecuteModal(false)}
    onInvoiceGenerated={invalidateAll}
  />
)}
      {paymentModal && (
        <RecordPaymentModal
          contract={contract}
          customerId={customerId}
          onClose={() => setPaymentModal(false)}
          onCompleted={() => { setPaymentModal(false); invalidateAll() }}
        />
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted">{label}: </span>
      <span className="text-slate-300">{value}</span>
    </div>
  )
}
