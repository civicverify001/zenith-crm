import { useState } from 'react'
import { reviewProof } from '../../../services/complianceProofService'
import { useAuth } from '../../../hooks/useAuth'
import { useQueryClient } from '@tanstack/react-query'
import { CUSTOMER_KEYS } from '../useCustomers'

interface Props {
  proof: any
  customerId: string
  onClose: () => void
  onCompleted: () => void
}

export function ProofReviewModal({ proof, customerId, onClose, onCompleted }: Props) {
  const { user, profile } = useAuth()
  const qc = useQueryClient()
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function handleReview(status: 'accepted' | 'rejected') {
    if (!user) return
    setPending(true)
    setError('')
    try {
      await reviewProof(proof.id, status, {
        actor_id: user.id, actor_name: profile?.full_name,
      }, notes || undefined)
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.proofs(customerId) })
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.warranties(customerId) })
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
        <h3 className="text-sm font-bold text-white mb-1">Review Compliance Proof</h3>
        <p className="text-xs text-muted mb-4">
          {proof.proof_type?.replace(/_/g, ' ')} — submitted {new Date(proof.submitted_at).toLocaleDateString()}
        </p>

        {/* Proof link */}
        {proof.proof_url && (
          <div className="mb-3 p-3 bg-surface border border-border rounded-lg">
            <a href={proof.proof_url} target="_blank" rel="noopener noreferrer"
              className="text-xs font-medium break-all" style={{ color: '#38bdf8' }}>
              📎 {proof.proof_url}
            </a>
          </div>
        )}

        {/* Review notes */}
        <div className="mb-4">
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide block mb-1">Review Notes (optional)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            rows={2} placeholder="Reason for acceptance or rejection..."
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent resize-none" />
        </div>

        {error && (
          <div className="mb-3 text-xs rounded-lg px-3 py-2" style={{ color: '#f87171', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} disabled={pending}
            className="text-xs px-3 py-2 rounded-lg border border-border text-muted hover:text-slate-300 transition-colors">
            Cancel
          </button>
          <button onClick={() => handleReview('rejected')} disabled={pending}
            className="flex-1 text-xs px-3 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
            {pending ? '...' : '✗ Reject'}
          </button>
          <button onClick={() => handleReview('accepted')} disabled={pending}
            className="flex-1 text-xs px-3 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }}>
            {pending ? '...' : '✓ Accept'}
          </button>
        </div>
      </div>
    </div>
  )
}
