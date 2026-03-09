import { useState } from 'react'
import { useComplianceProofs } from '../useCustomers'
import { useAuth } from '../../../hooks/useAuth'
import { ProofReviewModal } from '../modals/ProofReviewModal'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'

interface Props { customerId: string }

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const REVIEW_STYLES: Record<string, { color: string; label: string }> = {
  pending:  { color: '#fbbf24', label: 'Pending Review' },
  accepted: { color: '#4ade80', label: 'Accepted' },
  rejected: { color: '#f87171', label: 'Rejected' },
}

// ─── Data hooks ─────────────────────────────────────────────

function useCustomerJobAndLead(customerId: string) {
  return useQuery({
    queryKey: ['customer_refs', customerId],
    queryFn: async () => {
      const { data } = await supabase
        .from('customers')
        .select('job_id, lead_id')
        .eq('id', customerId)
        .single()
      return data || { job_id: null, lead_id: null }
    },
    enabled: !!customerId,
  })
}

function useAgreements(leadId: string | null) {
  return useQuery({
    queryKey: ['customer_agreements', leadId],
    queryFn: async () => {
      if (!leadId) return []
      const { data } = await supabase
        .from('agreements')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
      return data || []
    },
    enabled: !!leadId,
  })
}

function useJobFormResponses(jobId: string | null) {
  return useQuery({
    queryKey: ['customer_job_forms', jobId],
    queryFn: async () => {
      if (!jobId) return []
      const { data } = await supabase
        .from('job_form_responses')
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })
      return data || []
    },
    enabled: !!jobId,
  })
}

function useJobSignatures(jobId: string | null) {
  return useQuery({
    queryKey: ['customer_job_signatures', jobId],
    queryFn: async () => {
      if (!jobId) return []
      const { data } = await supabase
        .from('job_signatures')
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })
      return data || []
    },
    enabled: !!jobId,
  })
}

function useApprovedJobPhotos(jobId: string | null) {
  return useQuery({
    queryKey: ['customer_approved_photos', jobId],
    queryFn: async () => {
      if (!jobId) return []
      const { data } = await supabase
        .from('job_photos')
        .select('*')
        .eq('job_id', jobId)
        .eq('review_status', 'approved')
        .order('created_at', { ascending: true })
      return data || []
    },
    enabled: !!jobId,
  })
}

// ─── Component ──────────────────────────────────────────────

export function CustomerDocumentsTab({ customerId }: Props) {
  const { role } = useAuth()
  const { data: proofs, isLoading: proofsLoading } = useComplianceProofs(customerId)
  const { data: refs } = useCustomerJobAndLead(customerId)
  const { data: agreements = [] } = useAgreements(refs?.lead_id || null)
  const { data: formResponses = [] } = useJobFormResponses(refs?.job_id || null)
  const { data: signatures = [] } = useJobSignatures(refs?.job_id || null)
  const { data: approvedPhotos = [] } = useApprovedJobPhotos(refs?.job_id || null)
  const [reviewModal, setReviewModal] = useState<any>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  if (proofsLoading) return <p className="text-sm text-muted text-center py-8">Loading documents...</p>

  const allProofs = (proofs || []) as any[]
  const pendingProofs = allProofs.filter(p => p.review_status === 'pending')
  const reviewedProofs = allProofs.filter(p => p.review_status !== 'pending')

  const hasAgreements = agreements.length > 0
  const hasForms = formResponses.length > 0
  const hasSignatures = signatures.length > 0
  const hasPhotos = approvedPhotos.length > 0
  const hasAnything = allProofs.length > 0 || hasAgreements || hasForms || hasSignatures || hasPhotos

  return (
    <div className="space-y-5">

      {/* ─── Agreements ──────────────────────────────────── */}
      {hasAgreements && (
        <DocSection title="Agreements" icon="📝" count={agreements.length}>
          {agreements.map((agr: any) => (
            <DocCard key={agr.id}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm">📝</span>
                  <span className="text-sm font-medium text-white">
                    {agr.agreement_type?.replace(/_/g, ' ') || 'Agreement'}
                  </span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                  agr.status === 'signed' ? 'bg-green-500/20 text-green-400' :
                  agr.status === 'sent' ? 'bg-blue-500/20 text-blue-400' :
                  'bg-gray-700 text-gray-400'
                }`}>
                  {agr.status || 'Unknown'}
                </span>
              </div>
              <div className="text-xs text-muted space-y-0.5">
                <div>Created: {formatDateTime(agr.created_at)}</div>
                {agr.signed_at && <div>Signed: {formatDateTime(agr.signed_at)}</div>}
                {agr.monthly_amount && <div>Monthly: ${agr.monthly_amount}</div>}
                {agr.term_months && <div>Term: {agr.term_months} months</div>}
              </div>
              {agr.document_url && (
                <a href={agr.document_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs mt-2 inline-block" style={{ color: '#38bdf8' }}>
                  View document ↗
                </a>
              )}
            </DocCard>
          ))}
        </DocSection>
      )}

      {/* ─── Customer Handover Records ───────────────────── */}
      {hasForms && (
        <DocSection title="Customer Handover" icon="🤝" count={formResponses.length}>
          {formResponses.map((form: any) => (
            <DocCard key={form.id}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm">🤝</span>
                  <span className="text-sm font-medium text-white">
                    {form.form_type?.replace(/_/g, ' ') || 'Handover Form'}
                  </span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-green-500/20 text-green-400">
                  Completed
                </span>
              </div>
              <div className="text-xs text-muted space-y-0.5">
                <div>Completed: {formatDateTime(form.created_at)}</div>
                {form.response_data?.customer_name && (
                  <div>Signed by: {form.response_data.customer_name}</div>
                )}
              </div>
              {form.signature_url && (
                <div className="mt-2">
                  <div className="text-xs text-gray-500 mb-1">Customer signature:</div>
                  <img
                    src={form.signature_url}
                    alt="Signature"
                    className="h-12 bg-white rounded px-2 py-1 cursor-pointer"
                    onClick={() => setLightboxUrl(form.signature_url)}
                  />
                </div>
              )}
            </DocCard>
          ))}
        </DocSection>
      )}

      {/* ─── Consent Signatures ──────────────────────────── */}
      {hasSignatures && (
        <DocSection title="Consent Signatures" icon="✍️" count={signatures.length}>
          {signatures.map((sig: any) => (
            <DocCard key={sig.id}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm">✍️</span>
                  <span className="text-sm font-medium text-white">
                    {sig.signature_type?.replace(/_/g, ' ') || sig.form_type?.replace(/_/g, ' ') || 'Consent'}
                  </span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-green-500/20 text-green-400">
                  Signed
                </span>
              </div>
              <div className="text-xs text-muted">
                Signed: {formatDateTime(sig.signed_at || sig.created_at)}
              </div>
              {sig.signature_url && (
                <div className="mt-2">
                  <img
                    src={sig.signature_url}
                    alt="Signature"
                    className="h-12 bg-white rounded px-2 py-1 cursor-pointer"
                    onClick={() => setLightboxUrl(sig.signature_url)}
                  />
                </div>
              )}
            </DocCard>
          ))}
        </DocSection>
      )}

      {/* ─── Compliance Proofs — Pending ─────────────────── */}
      {pendingProofs.length > 0 && (
        <DocSection title="Pending Review" icon="📋" count={pendingProofs.length} urgentColor>
          {pendingProofs.map(proof => (
            <ProofCard key={proof.id} proof={proof} canReview={role === 'admin'} onReview={() => setReviewModal(proof)} />
          ))}
        </DocSection>
      )}

      {/* ─── Compliance Proofs — Reviewed ────────────────── */}
      {reviewedProofs.length > 0 && (
        <DocSection title="Compliance Documents" icon="📄" count={reviewedProofs.length}>
          {reviewedProofs.map(proof => (
            <ProofCard key={proof.id} proof={proof} canReview={false} />
          ))}
        </DocSection>
      )}

      {/* ─── Approved Install Photos ─────────────────────── */}
      {hasPhotos && (
        <DocSection title="Approved Install Photos" icon="📷" count={approvedPhotos.length}>
          <div className="grid grid-cols-3 gap-2 px-3 pb-3">
            {approvedPhotos.map((photo: any) => (
              <div key={photo.id} className="cursor-pointer" onClick={() => setLightboxUrl(photo.photo_url)}>
                <img
                  src={photo.photo_url}
                  alt={photo.caption || 'Install photo'}
                  className="w-full aspect-square object-cover rounded-lg"
                />
                <div className="text-[10px] text-gray-500 mt-1 capitalize">{photo.category?.replace(/_/g, ' ')}</div>
              </div>
            ))}
          </div>
        </DocSection>
      )}

      {/* ─── Empty state ─────────────────────────────────── */}
      {!hasAnything && (
        <div className="bg-card border border-border rounded-xl p-6 text-center">
          <div className="text-3xl mb-2">📎</div>
          <div className="text-sm text-muted">No documents on file yet.</div>
          <div className="text-xs text-muted mt-1">
            Agreements, handover records, consent signatures, and compliance proofs will appear here.
          </div>
        </div>
      )}

      {/* ─── Review modal ────────────────────────────────── */}
      {reviewModal && (
        <ProofReviewModal
          proof={reviewModal}
          customerId={customerId}
          onClose={() => setReviewModal(null)}
          onCompleted={() => setReviewModal(null)}
        />
      )}

      {/* ─── Lightbox ────────────────────────────────────── */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-8 cursor-pointer"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="Document" className="max-w-full max-h-full object-contain rounded-lg" />
          <button className="absolute top-6 right-6 text-white text-2xl hover:text-gray-300" onClick={() => setLightboxUrl(null)}>×</button>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────

function DocSection({ title, icon, count, urgentColor, children }: {
  title: string; icon: string; count: number; urgentColor?: boolean; children: React.ReactNode
}) {
  return (
    <div className={`bg-card border rounded-xl overflow-hidden ${urgentColor ? 'border-amber-700/40' : 'border-border'}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <span className="text-sm">{icon}</span>
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wide">{title}</h4>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          urgentColor ? 'bg-amber-500/20 text-amber-400' : 'bg-gray-700 text-gray-300'
        }`}>{count}</span>
      </div>
      <div className="divide-y divide-border/30">
        {children}
      </div>
    </div>
  )
}

function DocCard({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-3">{children}</div>
}

function ProofCard({ proof, canReview, onReview }: { proof: any; canReview: boolean; onReview?: () => void }) {
  const reviewStyle = REVIEW_STYLES[proof.review_status] || REVIEW_STYLES.pending

  return (
    <DocCard>
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
    </DocCard>
  )
}
