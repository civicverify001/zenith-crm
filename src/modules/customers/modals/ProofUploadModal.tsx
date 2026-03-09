import { useState } from 'react'
import { submitProof } from '../../../services/complianceProofService'
import { useAuth } from '../../../hooks/useAuth'
import { useQueryClient } from '@tanstack/react-query'
import { CUSTOMER_KEYS } from '../useCustomers'

interface Props {
  requirementId: string
  customerId: string
  requirementLabel: string
  onClose: () => void
  onCompleted: () => void
}

export function ProofUploadModal({ requirementId, customerId, requirementLabel, onClose, onCompleted }: Props) {
  const { user, profile } = useAuth()
  const qc = useQueryClient()
  const [proofUrl, setProofUrl] = useState('')
  const [proofType, setProofType] = useState('receipt')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!user || !proofUrl.trim()) return
    setPending(true)
    setError('')
    try {
      await submitProof(requirementId, proofUrl.trim(), proofType, {
        actor_id: user.id, actor_name: profile?.full_name,
      })
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.proofs(customerId) })
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.activity(customerId) })
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
        <h3 className="text-sm font-bold text-white mb-1">Submit Compliance Proof</h3>
        <p className="text-xs text-muted mb-4">{requirementLabel}</p>

        <div className="mb-3">
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide block mb-1">Proof Type</label>
          <select value={proofType} onChange={e => setProofType(e.target.value)}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent">
            <option value="receipt">Receipt</option>
            <option value="invoice">Invoice</option>
            <option value="photo">Photo</option>
            <option value="service_record">Service Record</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div className="mb-4">
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide block mb-1">Proof URL</label>
          <input type="url" value={proofUrl} onChange={e => setProofUrl(e.target.value)}
            placeholder="https://... (link to receipt, photo, or document)"
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent" />
          <p className="text-xs text-muted mt-1">Paste a link to the uploaded proof document or image.</p>
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
          <button onClick={handleSubmit} disabled={pending || !proofUrl.trim()}
            className="flex-1 text-xs px-3 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'rgba(56,189,248,0.15)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.3)' }}>
            {pending ? 'Submitting...' : 'Submit Proof'}
          </button>
        </div>
      </div>
    </div>
  )
}
