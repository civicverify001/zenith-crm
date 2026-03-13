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

function fmt(n: number) {
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
}

function today() {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

const REVIEW_STYLES: Record<string, { color: string; label: string }> = {
  pending:  { color: '#fbbf24', label: 'Pending Review' },
  accepted: { color: '#4ade80', label: 'Accepted' },
  rejected: { color: '#f87171', label: 'Rejected' },
}

const QUOTE_TYPE_LABELS: Record<string, string> = {
  rental:    'Rental Agreement',
  purchase:  'Purchase Agreement',
  financing: 'Financing Agreement',
}

// ─── Agreement HTML generator (unchanged) ────────────────────────
function generateAgreementHTML(agreement: any, customer: any, terms: any[]): string {
  const termBlocksHTML = terms.map((block: any) => `
    <div class="section">
      <h3>${block.display_title || ''}</h3>
      <p>${(block.content || '')
        .replace(/\[INSTALL_FEE\]/g, fmt(agreement.install_fee || 0))
        .replace(/\[MONTHLY_AMOUNT\]/g, fmt(agreement.monthly_amount || 0))
        .replace(/\n/g, '<br/>')
      }</p>
    </div>
  `).join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${agreement.agreement_number} — Zenith Pure Solutions</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Georgia, serif; color: #1a1a2e; background: white; padding: 40px; max-width: 800px; margin: 0 auto; }
    .header { background: #0a2540; color: white; padding: 32px; text-align: center; border-radius: 8px 8px 0 0; }
    .header h1 { font-size: 20px; font-weight: bold; letter-spacing: 1px; }
    .header p { font-size: 12px; color: #93c5fd; margin-top: 4px; }
    .subheader { background: #f8fafc; border: 1px solid #e2e8f0; border-top: none; padding: 20px; text-align: center; }
    .subheader h2 { font-size: 22px; font-weight: bold; }
    .subheader .agnum { color: #0a2540; font-size: 14px; font-weight: 600; margin-top: 6px; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; padding: 20px; border: 1px solid #e2e8f0; border-top: none; }
    .party-label { font-size: 10px; font-weight: bold; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
    .party-name { font-weight: bold; font-size: 14px; }
    .party-address { font-size: 12px; color: #64748b; margin-top: 2px; }
    .financials { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; background: #eff6ff; border: 1px solid #bfdbfe; border-top: none; padding: 20px; text-align: center; }
    .fin-label { font-size: 10px; color: #3b82f6; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .fin-value { font-size: 18px; font-weight: bold; color: #1e3a8a; margin-top: 4px; }
    .notice { background: #fffbeb; border: 1px solid #fcd34d; border-top: none; padding: 12px 20px; text-align: center; font-size: 11px; font-weight: bold; color: #92400e; text-transform: uppercase; letter-spacing: 0.5px; }
    .intro { padding: 20px; border: 1px solid #e2e8f0; border-top: none; font-size: 13px; line-height: 1.6; }
    .section { border: 1px solid #e2e8f0; margin-top: 16px; border-radius: 8px; overflow: hidden; }
    .section h3 { background: #f8fafc; padding: 10px 20px; font-size: 13px; font-weight: bold; border-bottom: 1px solid #e2e8f0; }
    .section p { padding: 16px 20px; font-size: 12px; line-height: 1.8; color: #374151; }
    .signatures { border: 2px solid #e2e8f0; border-radius: 8px; padding: 32px; margin-top: 24px; }
    .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .sig-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
    .sig-party-label { font-size: 10px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .sig-name { font-size: 22px; font-style: italic; font-family: Georgia, serif; color: #0a2540; border-bottom: 1px solid #334155; padding-bottom: 6px; margin-bottom: 8px; min-height: 36px; }
    .sig-meta { font-size: 11px; color: #64748b; }
    .footer { margin-top: 32px; text-align: center; font-size: 10px; color: #94a3b8; }
    @media print { body { padding: 20px; } .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom:20px; text-align:center;">
    <button onclick="window.print()" style="background:#0a2540;color:white;border:none;padding:10px 28px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">
      🖨️ Print / Save as PDF
    </button>
    <p style="margin-top:8px;font-size:11px;color:#64748b;">Use your browser's "Save as PDF" option when printing</p>
  </div>
  <div class="header">
    <h1>ZENITH PURE SOLUTIONS LLC</h1>
    <p>6951 E 30th St, Suite B · Indianapolis, IN 46219</p>
    <p>(317) 690-4172 · zenithpuresolutions.com</p>
  </div>
  <div class="subheader">
    <div style="font-size:10px;font-weight:bold;color:#94a3b8;text-transform:uppercase;letter-spacing:2px;margin-bottom:4px;">Legal Agreement</div>
    <h2>Residential Equipment Rental Agreement</h2>
    <div class="agnum">${agreement.agreement_number}</div>
  </div>
  <div class="parties">
    <div>
      <div class="party-label">Company</div>
      <div class="party-name">Zenith Pure Solutions LLC</div>
      <div class="party-address">6951 E 30th St, Suite B<br/>Indianapolis, IN 46219</div>
    </div>
    <div>
      <div class="party-label">Customer</div>
      <div class="party-name">${customer?.full_name || ''}</div>
      <div class="party-address">${customer?.address || ''}<br/>${customer?.city || ''}, ${customer?.state || ''} ${customer?.zip || ''}</div>
    </div>
  </div>
  <div class="financials">
    <div><div class="fin-label">Monthly Payment</div><div class="fin-value">${fmt(agreement.monthly_amount || 0)}/mo</div></div>
    <div><div class="fin-label">Setup Fee (one-time)</div><div class="fin-value">${fmt(agreement.install_fee || 0)}</div></div>
    <div><div class="fin-label">Initial Term</div><div class="fin-value">36 months</div></div>
  </div>
  <div class="notice">By signing, you agree to all terms including the binding arbitration clause in Article IX.</div>
  <div class="intro">
    This Agreement is entered into as of <strong>${today()}</strong> between
    <strong>Zenith Pure Solutions LLC</strong> ("Company") and <strong>${customer?.full_name || ''}</strong> ("Customer").
  </div>
  ${termBlocksHTML}
  <div class="signatures">
    <div style="font-weight:bold;font-size:13px;margin-bottom:4px;">IN WITNESS WHEREOF</div>
    <p style="font-size:11px;color:#64748b;margin-bottom:24px;">Executed as of ${today()}.</p>
    <div class="sig-grid">
      <div class="sig-box">
        <div class="sig-party-label">ZENITH PURE SOLUTIONS LLC</div>
        <div class="sig-name">Kuldeep Singh</div>
        <div class="sig-meta">Authorized Representative · ${today()}</div>
      </div>
      <div class="sig-box">
        <div class="sig-party-label">CUSTOMER</div>
        <div class="sig-name">${agreement.signed_name || customer?.full_name || ''}</div>
        <div class="sig-meta">${customer?.full_name || ''} · Signed ${agreement.signed_at ? new Date(agreement.signed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : today()}</div>
      </div>
    </div>
  </div>
  <div class="footer">
    <p>Zenith Pure Solutions LLC · 6951 E 30th St, Suite B, Indianapolis, IN 46219</p>
    <p>(317) 690-4172 · info@zenithpuresolutions.com · zenithpuresolutions.com</p>
    <p style="margin-top:6px;">Agreement ${agreement.agreement_number} · Generated ${today()}</p>
  </div>
</body>
</html>`
}

// ─── Data hooks ──────────────────────────────────────────────────

function useCustomerJobAndLead(customerId: string) {
  return useQuery({
    queryKey: ['customer_refs', customerId],
    queryFn: async () => {
      const { data } = await supabase
        .from('customers')
        .select('job_id, lead_id, full_name, address, city, state, zip')
        .eq('id', customerId)
        .single()
      return data || { job_id: null, lead_id: null, full_name: null, address: null, city: null, state: null, zip: null }
    },
    enabled: !!customerId,
  })
}

// Dual-query helper — avoids duplicating the merge pattern
async function mergeByIdDesc<T extends { id: string; created_at: string }>(
  queries: Promise<{ data: T[] | null }>[]
): Promise<T[]> {
  const seen = new Set<string>()
  const results: T[] = []
  const responses = await Promise.all(queries)
  for (const res of responses) {
    for (const row of res.data || []) {
      if (!seen.has(row.id)) { seen.add(row.id); results.push(row) }
    }
  }
  results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  return results
}

// Agreements — by customer_id AND lead_id
function useAgreements(customerId: string, leadId: string | null) {
  return useQuery({
    queryKey: ['customer_agreements', customerId, leadId],
    queryFn: () => mergeByIdDesc([
      supabase.from('agreements').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }) as any,
      ...(leadId ? [supabase.from('agreements').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }) as any] : []),
    ]),
    enabled: !!customerId,
  })
}

// Quotes — by customer_id AND lead_id (lead flow sets lead_id, not customer_id)
function useAcceptedQuotes(customerId: string, leadId: string | null) {
  return useQuery({
    queryKey: ['customer_accepted_quotes', customerId, leadId],
    queryFn: () => mergeByIdDesc([
      supabase
        .from('quotes')
        .select('id, quote_number, lead_id, created_at, status, commercial_type, monthly_amount, total, install_fee')
        .eq('customer_id', customerId)
        .in('status', ['accepted', 'signed'])
        .order('created_at', { ascending: false }) as any,
      ...(leadId ? [
        supabase
          .from('quotes')
          .select('id, quote_number, lead_id, created_at, status, commercial_type, monthly_amount, total, install_fee')
          .eq('lead_id', leadId)
          .in('status', ['accepted', 'signed'])
          .order('created_at', { ascending: false }) as any,
      ] : []),
    ]),
    enabled: !!customerId,
  })
}

// Invoices — by customer_id AND lead_id
function usePaidInvoices(customerId: string, leadId: string | null) {
  return useQuery({
    queryKey: ['customer_paid_invoices', customerId, leadId],
    queryFn: () => mergeByIdDesc([
      supabase
        .from('invoices')
        .select('id, invoice_number, lead_id, created_at, paid_at, status, total, amount_paid')
        .eq('customer_id', customerId)
        .in('status', ['paid', 'partial'])
        .order('paid_at', { ascending: false }) as any,
      ...(leadId ? [
        supabase
          .from('invoices')
          .select('id, invoice_number, lead_id, created_at, paid_at, status, total, amount_paid')
          .eq('lead_id', leadId)
          .in('status', ['paid', 'partial'])
          .order('paid_at', { ascending: false }) as any,
      ] : []),
    ]),
    enabled: !!customerId,
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
        .order('submitted_at', { ascending: false })
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
        .order('signed_at', { ascending: false })
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

// ─── Main component ──────────────────────────────────────────────

export function CustomerDocumentsTab({ customerId }: Props) {
  const { role } = useAuth()
  const { data: proofs, isLoading: proofsLoading } = useComplianceProofs(customerId)
  const { data: refs } = useCustomerJobAndLead(customerId)

  const leadId = refs?.lead_id || null

  const { data: agreements     = [] } = useAgreements(customerId, leadId)
  const { data: acceptedQuotes = [] } = useAcceptedQuotes(customerId, leadId)
  const { data: paidInvoices   = [] } = usePaidInvoices(customerId, leadId)
  const { data: formResponses  = [] } = useJobFormResponses(refs?.job_id || null)
  const { data: signatures     = [] } = useJobSignatures(refs?.job_id || null)
  const { data: approvedPhotos = [] } = useApprovedJobPhotos(refs?.job_id || null)

  const [reviewModal, setReviewModal]   = useState<any>(null)
  const [lightboxUrl, setLightboxUrl]   = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  async function handleDownloadAgreement(agr: any) {
    setDownloadingId(agr.id)
    try {
      let terms: any[] = agr.terms_snapshot?.blocks || []
      if (!terms.length) {
        const { data: fetchedTerms } = await supabase
          .from('term_blocks')
          .select('slug, display_title, content, version')
          .like('slug', 'ra-%')
          .eq('is_active', true)
          .order('sort_order')
        terms = fetchedTerms || []
      }
      const html = generateAgreementHTML(agr, refs, terms)
      const win = window.open('', '_blank')
      if (win) {
        win.document.write(html)
        win.document.close()
        setTimeout(() => win.print(), 600)
      } else {
        const blob = new Blob([html], { type: 'text/html' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${agr.agreement_number}.html`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (e: any) {
      console.error('Download failed:', e.message)
    } finally {
      setDownloadingId(null)
    }
  }

  if (proofsLoading) return <p className="text-sm text-muted text-center py-8">Loading documents...</p>

  const allProofs      = (proofs || []) as any[]
  const pendingProofs  = allProofs.filter(p => p.review_status === 'pending')
  const reviewedProofs = allProofs.filter(p => p.review_status !== 'pending')

  const hasAgreements  = agreements.length > 0
  const hasQuotes      = acceptedQuotes.length > 0
  const hasInvoices    = paidInvoices.length > 0
  const hasForms       = formResponses.length > 0
  const hasSignatures  = signatures.length > 0
  const hasPhotos      = approvedPhotos.length > 0
  const hasAnything    = allProofs.length > 0 || hasAgreements || hasQuotes || hasInvoices || hasForms || hasSignatures || hasPhotos

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
                    {QUOTE_TYPE_LABELS[agr.quote_type] || agr.quote_type?.replace(/_/g, ' ') || 'Agreement'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    agr.signed_at ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'
                  }`}>
                    {agr.signed_at ? 'Signed' : 'Pending'}
                  </span>
                  {agr.signed_at && (
                    <button
                      onClick={() => handleDownloadAgreement(agr)}
                      disabled={downloadingId === agr.id}
                      className="text-xs px-2 py-0.5 rounded-lg font-semibold disabled:opacity-50 transition-all"
                      style={{ backgroundColor: 'rgba(56,189,248,0.12)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.25)' }}
                      title="Download signed agreement as PDF"
                    >
                      {downloadingId === agr.id ? '…' : '⬇ PDF'}
                    </button>
                  )}
                </div>
              </div>
              <div className="text-xs text-muted space-y-0.5">
                {agr.agreement_number    && <div className="text-slate-400 font-medium">{agr.agreement_number}</div>}
                {agr.signed_at          && <div>Signed: {formatDateTime(agr.signed_at)}</div>}
                {agr.signed_by_rep      && <div>Rep: {agr.signed_by_rep}</div>}
                {agr.monthly_amount     && <div>Monthly: ${agr.monthly_amount}</div>}
                {agr.total_amount && <div>Total: ${agr.total_amount}</div>}
                {agr.rental_term_months && <div>Term: {agr.rental_term_months} months</div>}
                {agr.deposit_amount     && <div>Deposit: ${agr.deposit_amount} ({agr.deposit_method || 'N/A'})</div>}
                {agr.install_address    && <div>Install: {agr.install_address}</div>}
              </div>
              {agr.customer_signature && (
                <div className="mt-2">
                  <div className="text-xs text-gray-500 mb-1">Customer signature:</div>
                  <img
                    src={agr.customer_signature}
                    alt="Signature"
                    className="h-12 bg-white rounded px-2 py-1 cursor-pointer"
                    onClick={() => setLightboxUrl(agr.customer_signature)}
                  />
                </div>
              )}
            </DocCard>
          ))}
        </DocSection>
      )}

      {/* ─── Accepted Quotes ─────────────────────────────── */}
      {hasQuotes && (
        <DocSection title="Accepted Quotes" icon="📋" count={acceptedQuotes.length}>
          {(acceptedQuotes as any[]).map((q: any) => (
            <DocCard key={q.id}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm">📋</span>
                  <span className="text-sm font-medium text-white">
                    {q.commercial_type === 'rental' ? 'Rental Quote' : q.commercial_type === 'financed' ? 'Financed Quote' : 'Purchase Quote'}
                  </span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                  style={{ backgroundColor: 'rgba(56,189,248,0.15)', color: '#38bdf8' }}>
                  {q.status === 'signed' ? 'Signed' : 'Accepted'}
                </span>
              </div>
              <div className="text-xs text-muted space-y-0.5">
                {q.quote_number && <div className="text-slate-400 font-medium">{q.quote_number}</div>}
                {q.created_at       && <div>Date: {formatDateTime(q.created_at)}</div>}
                {q.monthly_amount   && <div>Monthly: ${q.monthly_amount}/mo</div>}
                {q.total         && <div>Total: ${q.total}</div>}
                {q.install_fee      && <div>Install fee: ${q.install_fee}</div>}
              </div>
            </DocCard>
          ))}
        </DocSection>
      )}

      {/* ─── Paid Invoices ───────────────────────────────── */}
      {hasInvoices && (
        <DocSection title="Paid Invoices" icon="🧾" count={paidInvoices.length}>
          {(paidInvoices as any[]).map((inv: any) => (
            <DocCard key={inv.id}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm">🧾</span>
                  <span className="text-sm font-medium text-white">Invoice</span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                  style={{ backgroundColor: 'rgba(74,222,128,0.15)', color: '#4ade80' }}>
                  {inv.status === 'partial' ? 'Partial' : 'Paid'}
                </span>
              </div>
              <div className="text-xs text-muted space-y-0.5">
                {inv.invoice_number && <div className="text-slate-400 font-medium">{inv.invoice_number}</div>}
                {inv.paid_at          && <div>Paid: {formatDateTime(inv.paid_at)}</div>}
                {inv.total         && <div>Total: ${inv.total}</div>}
                {inv.amount_paid      && <div>Amount paid: ${inv.amount_paid}</div>}
              </div>
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
                <div>Submitted: {formatDateTime(form.submitted_at)}</div>
                {form.response_data?.customer_name && <div>Signed by: {form.response_data.customer_name}</div>}
              </div>
              {form.customer_signature_url && (
                <div className="mt-2">
                  <div className="text-xs text-gray-500 mb-1">Customer signature:</div>
                  <img
                    src={form.customer_signature_url}
                    alt="Signature"
                    className="h-12 bg-white rounded px-2 py-1 cursor-pointer"
                    onClick={() => setLightboxUrl(form.customer_signature_url)}
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
                  <span className="text-sm font-medium text-white">Customer Consent</span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-green-500/20 text-green-400">
                  Signed
                </span>
              </div>
              <div className="text-xs text-muted space-y-0.5">
                <div>Signed: {formatDateTime(sig.signed_at)}</div>
                {sig.signed_by_name && <div>Signed by: {sig.signed_by_name}</div>}
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
            Agreements, quotes, invoices, handover records, consent signatures, and compliance proofs will appear here.
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

// ─── Sub-components ──────────────────────────────────────────────

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
      <div className="divide-y divide-border/30">{children}</div>
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
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${reviewStyle.color}20`, color: reviewStyle.color }}>
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
