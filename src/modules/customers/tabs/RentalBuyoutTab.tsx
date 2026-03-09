import { useState } from 'react'
import { useRentalContracts } from '../useCustomers'
import type { RentalContract } from '../customers.types'
import { useAuth } from '../../../hooks/useAuth'
import { useQueryClient } from '@tanstack/react-query'
import { CUSTOMER_KEYS } from '../useCustomers'

interface Props { customerId: string }

function fmt(n: number) { return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}` }
function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function RentalBuyoutTab({ customerId }: Props) {
  const { user, profile } = useAuth()
  const qc = useQueryClient()
  const { data: contracts, isLoading } = useRentalContracts(customerId)

  if (isLoading) return <p className="text-sm text-muted text-center py-8">Loading...</p>
  if (!contracts?.length) return <p className="text-sm text-muted text-center py-8">No rental contracts for this customer.</p>

  return (
    <div className="space-y-4">
      {(contracts as RentalContract[]).map(contract => (
        <ContractCard key={contract.id} contract={contract} customerId={customerId} />
      ))}
    </div>
  )
}

function ContractCard({ contract, customerId }: { contract: RentalContract; customerId: string }) {
  const { user, profile } = useAuth()
  const qc = useQueryClient()
  const [calc, setCalc] = useState<BuyoutCalculation | null>(null)
  const [loading, setLoading] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')

  async function handleCalculate() {
    setLoading(true)
    setError('')
    try {
      const result = await calculateBuyout(contract.id)
      setCalc(result)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  async function handleBuyout() {
    if (!confirm('Process buyout? This will convert all rented systems to purchased and cannot be undone.')) return
    setProcessing(true)
    try {
      await processBuyout(contract.id, { actor_id: user!.id, actor_name: profile?.full_name })
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.rentals(customerId) })
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.systems(customerId) })
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.activity(customerId) })
      setCalc(null)
    } catch (e: any) { setError(e.message) }
    finally { setProcessing(false) }
  }

  const isActive = contract.status === 'active'
  const pctComplete = contract.term_months > 0 ? Math.round((contract.payments_made / contract.term_months) * 100) : 0

  return (
    <div className={`border rounded-xl p-4 ${contract.buyout_completed ? 'border-green/30 bg-green/5' : 'border-border'}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="text-sm font-bold text-white">{contract.contract_number || 'Rental Contract'}</h4>
          <div className="text-xs text-muted">
            {formatDate(contract.start_date)} — {formatDate(contract.end_date)}
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
          contract.buyout_completed ? 'bg-green/20 text-green'
            : isActive ? 'bg-accent/20 text-accent'
            : 'bg-muted/20 text-muted'
        }`}>
          {contract.buyout_completed ? 'Bought Out' : contract.status}
        </span>
      </div>

      {/* Contract details */}
      <div className="grid grid-cols-2 gap-3 text-xs mb-3">
        <div><span className="text-muted">Monthly: </span><span className="text-slate-200 font-semibold">{fmt(contract.monthly_amount)}</span></div>
        <div><span className="text-muted">Term: </span><span className="text-slate-200">{contract.term_months} months</span></div>
        <div><span className="text-muted">Payments Made: </span><span className="text-slate-200">{contract.payments_made}</span></div>
        <div><span className="text-muted">Total Paid: </span><span className="text-slate-200 font-semibold">{fmt(contract.total_paid)}</span></div>
        <div><span className="text-muted">Install Fees: </span><span className="text-slate-200">{fmt(contract.total_install_fees)}</span></div>
        <div><span className="text-muted">Rental Credit (50%): </span><span className="text-slate-200">{fmt(contract.total_paid * 0.5)}</span></div>
      </div>

      {/* Progress bar */}
      {isActive && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-muted mb-1">
            <span>{contract.payments_made}/{contract.term_months} payments</span>
            <span>{pctComplete}%</span>
          </div>
          <div className="h-2 bg-surface rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full" style={{ width: `${pctComplete}%` }} />
          </div>
        </div>
      )}

      {/* Buyout completed */}
      {contract.buyout_completed && contract.buyout_audit && (
        <div className="bg-green/10 border border-green/20 rounded-lg p-3 text-xs space-y-1">
          <div className="font-semibold text-green mb-1">Buyout Completed — {formatDate(contract.buyout_date)}</div>
          <div className="text-muted">Final Price: <span className="text-white font-bold">{fmt(contract.buyout_price_snapshot || 0)}</span></div>
          {/* Full audit trail */}
          <div className="text-muted mt-2 pt-2 border-t border-green/20">
            <div>Current Retail: {fmt((contract.buyout_audit as any).currentRetailTotal)}</div>
            <div>− Install Reimbursement: {fmt((contract.buyout_audit as any).installReimbursement)}</div>
            <div>− Rental Credit Applied: {fmt((contract.buyout_audit as any).appliedRentalCredit)}</div>
            <div className="font-semibold text-white mt-1">= Buyout Price: {fmt((contract.buyout_audit as any).buyoutPrice)}</div>
          </div>
        </div>
      )}

      {/* Buyout calculator */}
      {isActive && !contract.buyout_completed && (
        <div className="mt-3 pt-3 border-t border-border">
          {!calc ? (
            <button onClick={handleCalculate} disabled={loading}
              className="text-xs px-3 py-1.5 bg-accent/15 text-accent border border-accent/30 rounded-lg font-semibold hover:bg-accent/25 transition-colors">
              {loading ? 'Calculating...' : 'Calculate Buyout Price'}
            </button>
          ) : (
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-300 uppercase tracking-wide">Buyout Breakdown</div>
              <div className="bg-surface border border-border rounded-lg p-3 text-xs space-y-1">
                <Row label="Current Retail (all systems)" value={fmt(calc.currentRetailTotal)} />
                <Row label="− Install Fee Reimbursement" value={`-${fmt(calc.installReimbursement)}`} color="text-green" />
                <Row label={`− Rental Credit (50% of ${fmt(calc.totalPaid)} paid)`} value={`-${fmt(calc.appliedRentalCredit)}`} color="text-green" />
                {calc.rentalCredit > calc.appliedRentalCredit && (
                  <div className="text-xs text-muted italic">Credit capped at 50% of retail ({fmt(calc.rentalCreditCap)})</div>
                )}
                <div className="border-t border-border pt-1 mt-1 flex justify-between font-bold">
                  <span className="text-white">Buyout Price</span>
                  <span className="text-white text-sm">{fmt(calc.buyoutPrice)}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleBuyout} disabled={processing}
                  className="text-xs px-3 py-1.5 bg-green/15 text-green border border-green/30 rounded-lg font-semibold hover:bg-green/25 transition-colors">
                  {processing ? 'Processing...' : 'Process Buyout'}
                </button>
                <button onClick={() => setCalc(null)} className="text-xs px-3 py-1.5 text-muted hover:text-white transition-colors">Cancel</button>
              </div>
            </div>
          )}
          {error && <div className="text-xs text-red mt-2">{error}</div>}
        </div>
      )}

      {/* Risk status */}
      {contract.rental_risk_status && (
        <div className={`mt-2 text-xs font-semibold ${
          contract.rental_risk_status === 'termination_pending' ? 'text-red' : 'text-amber'
        }`}>
          ⚠️ {contract.rental_risk_status.replace(/_/g, ' ').toUpperCase()}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className={color || 'text-slate-200'}>{value}</span>
    </div>
  )
}
