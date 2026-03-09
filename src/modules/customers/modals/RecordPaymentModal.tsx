import { useState } from 'react'
import { recordPayment } from '../../../services/rentalService'
import { useAuth } from '../../../hooks/useAuth'
import { useQueryClient } from '@tanstack/react-query'
import { CUSTOMER_KEYS } from '../useCustomers'

interface Props {
  contract: any
  customerId: string
  onClose: () => void
  onCompleted: () => void
}

export function RecordPaymentModal({ contract, customerId, onClose, onCompleted }: Props) {
  const { user, profile } = useAuth()
  const qc = useQueryClient()
  const [amount, setAmount] = useState(String(contract.monthly_amount || ''))
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!user || !amount || !paymentDate) return
    setPending(true)
    setError('')
    try {
      await recordPayment(contract.id, Number(amount), paymentDate, {
        actor_id: user.id, actor_name: profile?.full_name,
      })
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.rentals(customerId) })
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.payments(contract.id) })
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.activity(customerId) })
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.detail(customerId) })
      onCompleted()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl p-5 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-white mb-1">Record Payment</h3>
        <p className="text-xs text-muted mb-4">Contract {contract.contract_number || '—'}</p>

        <div className="mb-3">
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide block mb-1">Amount</label>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
            step="0.01" placeholder="0.00"
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent" />
        </div>

        <div className="mb-4">
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide block mb-1">Payment Date</label>
          <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent" />
        </div>

        {error && (
          <div className="mb-3 text-xs rounded-lg px-3 py-2" style={{ color: '#f87171', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} disabled={pending}
            className="flex-1 text-xs px-3 py-2 rounded-lg border border-border text-muted hover:text-slate-300 transition-colors">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={pending || !amount}
            className="flex-1 text-xs px-3 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }}>
            {pending ? 'Recording...' : 'Record Payment'}
          </button>
        </div>
      </div>
    </div>
  )
}
