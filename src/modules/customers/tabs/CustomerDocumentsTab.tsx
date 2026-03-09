import { useState } from 'react'
import { useComplianceProofs } from '../useCustomers'
import { useAuth } from '../../../hooks/useAuth'
import { ProofReviewModal } from '../modals/ProofReviewModal'

interface Props { customerId: string }

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const REVIEW_STYLES: Record<string, { color: string; label: string }> = {
  pending:  { color: '#fbbf24', label: 'Pending Review' },
  accepted: { color: '#4ade80', label: 'Accepted' },
  rejected: { color: '#f87171', label: 'Rejected' },
}

export function CustomerDocumentsTab({ customerId }: Props) {
  const { role } = useAuth()
  const { data: proofs, isLoading } = useComplianceProofs(customerId)
  const [reviewModal, setReviewModal] = useState<any>(null)

  if (isLoading) return <p className="text-sm text-muted text-center py-8">Loading documents...</p>

  const allProofs = (proofs || []) as any[]
  const pendingProofs = allProofs.filter(p => p.review_status === 'pending')
  const reviewedProofs = allProofs.filter(p => p.review_status !== 'pending')

  return (
    <div className="space-y-4">
      {/* Pending review — admin only */}
      {pendingProofs.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#fbbf24' }}>
            Pending Review ({pendingProofs.length})
          </h4>
          <div className="space-y-2">
            {pendingProofs.map(proof => (
              <ProofCard key={proof.id} proof={proof} canReview={role === 'admin'} onReview={() => setReviewModal(proof)} />
            ))}
          </div>
        </div>
      )}

      {/* Reviewed proofs */}
      {reviewedProofs.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wide mb-3">
            Reviewed Documents ({reviewedProofs.length})
          </h4>
          <div className="space-y-2">
            {reviewedProofs.map(proof => (
              <ProofCard key={proof.id} proof={proof} canReview={false} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {allProofs.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-3xl mb-2">📎</div>
          <div className="text-sm text-muted">No compliance proofs submitted yet.</div>
          <div className="text-xs text-muted mt-1">Proofs can be submitted from the Maintenance tab when completing service items.</div>
        </div>
      )}

      {/* Coming soon */}
      <div className="bg-card border border-border/50 rounded-xl p-4 text-center" style={{ borderStyle: 'dashed' }}>
        <div className="text-xs text-muted">Document uploads and agreement storage coming soon.</div>
      </div>

      {/* Review modal */}
      {reviewModal && (
        <ProofReviewModal
          proof={reviewModal}
          customerId={customerId}
          onClose={() => setReviewModal(null)}
          onCompleted={() => setReviewModal(null)}
        />
      )}
    </div>
  )
}

function ProofCard({ proof, canReview, onReview }: { proof: any; canReview: boolean; onReview?: () => void }) {
  const reviewStyle = REVIEW_STYLES[proof.review_status] || REVIEW_STYLES.pending

  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm">📄</span>
          <span className="text-sm font-medium text-white">
            {proof.proof_type?.replace(/_/g, ' ') || 'Compliance Proof'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{
            backgroundColor: `${reviewStyle.color}20`, color: reviewStyle.color,
          }}>
            {reviewStyle.label}
          </span>
          {canReview && proof.review_status === 'pending' && onReview && (
            <button onClick={onReview}
              className="text-xs px-2 py-0.5 rounded-lg font-semibold"
              style={{ backgroundColor: 'rgba(56,189,248,0.12)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.25)' }}>
              Review
            </button>
          )}
        </div>
      </div>
      <div className="text-xs text-muted space-y-0.5">
        <div>Submitted: {formatDate(proof.submitted_at)}</div>
        {proof.reviewed_at && (
          <div>Reviewed: {formatDate(proof.reviewed_at)} {proof.reviewed_by ? `by ${proof.reviewed_by}` : ''}</div>
        )}
        {proof.review_notes && <div className="text-slate-400 mt-1">Notes: {proof.review_notes}</div>}
      </div>
      {proof.proof_url && (
        <a href={proof.proof_url} target="_blank" rel="noopener noreferrer"
          className="text-xs mt-2 inline-block" style={{ color: '#38bdf8' }}>
          View document ↗
        </a>
      )}
    </div>
  )
}
