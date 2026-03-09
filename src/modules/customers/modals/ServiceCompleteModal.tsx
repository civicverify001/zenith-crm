import { useState } from 'react'
import { completeService } from '../../../services/serviceScheduleService'
import { useAuth } from '../../../hooks/useAuth'
import { useQueryClient } from '@tanstack/react-query'
import { CUSTOMER_KEYS } from '../useCustomers'

interface Props {
  scheduleItem: any
  customerId: string
  requirementLabel: string
  onClose: () => void
  onCompleted: () => void
}

export function ServiceCompleteModal({ scheduleItem, customerId, requirementLabel, onClose, onCompleted }: Props) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [purchasedThroughZenith, setPurchasedThroughZenith] = useState(true)
  const [cost, setCost] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!user) return
    setPending(true)
    setError('')
    try {
      await completeService(
        scheduleItem.id,
        user.id,
        purchasedThroughZenith,
        cost ? Number(cost) : undefined,
        notes || undefined
      )
      // Invalidate all relevant queries
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.schedules(customerId) })
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.completions(customerId) })
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.warranties(customerId) })
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.requirements(customerId) })
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
      <div className="bg-card border border-border rounded-xl p-5 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-white mb-1">Complete Service</h3>
        <p className="text-xs text-muted mb-4">{requirementLabel}</p>

        {/* Purchase source */}
        <div className="mb-3">
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide block mb-2">
            Purchase Source
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => setPurchasedThroughZenith(true)}
              className="flex-1 text-xs px-3 py-2 rounded-lg border font-semibold transition-colors"
              style={purchasedThroughZenith
                ? { backgroundColor: 'rgba(34,197,94,0.15)', color: '#4ade80', borderColor: 'rgba(34,197,94,0.4)' }
                : { backgroundColor: 'transparent', color: '#94a3b8', borderColor: 'rgba(148,163,184,0.2)' }
              }
            >
              ✓ Through Zenith
            </button>
            <button
              onClick={() => setPurchasedThroughZenith(false)}
              className="flex-1 text-xs px-3 py-2 rounded-lg border font-semibold transition-colors"
              style={!purchasedThroughZenith
                ? { backgroundColor: 'rgba(245,158,11,0.15)', color: '#fbbf24', borderColor: 'rgba(245,158,11,0.4)' }
                : { backgroundColor: 'transparent', color: '#94a3b8', borderColor: 'rgba(148,163,184,0.2)' }
              }
            >
              External Purchase
            </button>
          </div>
          {!purchasedThroughZenith && scheduleItem.must_purchase_through_zenith && (
            <div className="text-xs mt-1.5" style={{ color: '#f87171' }}>
              ⚠️ This requirement must be purchased through Zenith — warranty may be voided.
            </div>
          )}
        </div>

        {/* Cost */}
        <div className="mb-3">
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide block mb-1">
            Cost (optional)
          </label>
          <input
            type="number" value={cost} onChange={e => setCost(e.target.value)}
            placeholder="0.00" step="0.01"
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent"
          />
        </div>

        {/* Notes */}
        <div className="mb-4">
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide block mb-1">
            Notes (optional)
          </label>
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)}
            rows={2} placeholder="Service details, receipt #, etc."
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent resize-none"
          />
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
          <button onClick={handleSubmit} disabled={pending}
            className="flex-1 text-xs px-3 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }}>
            {pending ? 'Completing...' : 'Mark Complete'}
          </button>
        </div>
      </div>
    </div>
  )
}
