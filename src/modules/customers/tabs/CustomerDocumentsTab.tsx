import { useComplianceProofs } from '../useCustomers'

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
  const { data: proofs, isLoading } = useComplianceProofs(customerId)

  if (isLoading) return <p className="text-sm text-muted text-center py-8">Loading documents...</p>

  const hasProofs = (proofs || []).length > 0

  return (
    <div className="space-y-4">
      {/* Compliance Proofs */}
      <div>
        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wide mb-3">Compliance Proofs</h4>
        {!hasProofs ? (
          <div className="bg-card border border-border rounded-xl p-4 text-center">
            <div className="text-3xl mb-2">📎</div>
            <div className="text-sm text-muted">No compliance proofs submitted yet.</div>
            <div className="text-xs text-muted mt-1">Proofs will appear here when customers submit filter replacement receipts, service records, etc.</div>
          </div>
        ) : (
          <div className="space-y-2">
            {(proofs as any[]).map(proof => {
              const reviewStyle = REVIEW_STYLES[proof.review_status] || REVIEW_STYLES.pending
              return (
                <div key={proof.id} className="bg-card border border-border rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">📄</span>
                      <span className="text-sm font-medium text-white">
                        {proof.proof_type?.replace(/_/g, ' ') || 'Compliance Proof'}
                      </span>
                    </div>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{
                      backgroundColor: `${reviewStyle.color}20`, color: reviewStyle.color,
                    }}>
                      {reviewStyle.label}
                    </span>
                  </div>
                  <div className="text-xs text-muted space-y-0.5">
                    <div>Submitted: {formatDate(proof.submitted_at)}</div>
                    {proof.submitted_by && <div>By: {proof.submitted_by}</div>}
                    {proof.reviewed_at && <div>Reviewed: {formatDate(proof.reviewed_at)} {proof.reviewed_by ? `by ${proof.reviewed_by}` : ''}</div>}
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
            })}
          </div>
        )}
      </div>

      {/* Future: Document uploads */}
      <div className="bg-card border border-border/50 rounded-xl p-4 text-center" style={{ borderStyle: 'dashed' }}>
        <div className="text-xs text-muted">Document uploads and agreement storage coming soon.</div>
      </div>
    </div>
  )
}
