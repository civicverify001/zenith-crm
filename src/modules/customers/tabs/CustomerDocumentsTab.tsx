import { useState } from 'react'
import { useComplianceProofs } from '../useCustomers'
import { useAuth } from '../../../hooks/useAuth'
import { ProofReviewModal } from '../modals/ProofReviewModal'
import { useQuery } from '@tanstack/react-query'
import { ZENITH_LOGO_FULL } from '../../../lib/pdfLogoBase64'

interface Props { customerId: string }

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function formatDateTime(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function fmt(n: number) { return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}` }
function today() { return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) }

const REVIEW_STYLES: Record<string, { color: string; label: string }> = {
  pending:  { color: '#fbbf24', label: 'Pending Review' },
  accepted: { color: '#4ade80', label: 'Accepted' },
  rejected: { color: '#f87171', label: 'Rejected' },
}
const QUOTE_TYPE_LABELS: Record<string, string> = {
  rental: 'Rental Agreement', purchase: 'Purchase Agreement', financing: 'Financing Agreement',
}

// ─── Shared PDF styles ───────────────────────────────────────────
const PDF_BASE_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Georgia, serif; color: #1a1a2e; background: white; padding: 40px; max-width: 800px; margin: 0 auto; }
  .header { background: #0a2540; color: white; padding: 32px; text-align: center; border-radius: 8px 8px 0 0; }
  .header h1 { font-size: 20px; font-weight: bold; letter-spacing: 1px; }
  .header p { font-size: 12px; color: #93c5fd; margin-top: 4px; }
  .subheader { background: #f8fafc; border: 1px solid #e2e8f0; border-top: none; padding: 20px; text-align: center; }
  .subheader h2 { font-size: 20px; font-weight: bold; }
  .subheader .sub { color: #64748b; font-size: 13px; margin-top: 4px; }
  .body-section { border: 1px solid #e2e8f0; border-top: none; padding: 24px; }
  .body-section p { font-size: 13px; line-height: 1.7; color: #374151; margin-bottom: 12px; }
  .body-section ul { margin: 12px 0 12px 20px; }
  .body-section li { font-size: 13px; line-height: 1.7; color: #374151; margin-bottom: 6px; }
  .body-section strong { color: #1a1a2e; }
  .confirm-box { background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; padding: 14px 18px; margin: 16px 0; font-size: 13px; font-weight: 600; color: #166534; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0; }
  .info-item { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 16px; }
  .info-label { font-size: 10px; font-weight: bold; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  .info-value { font-size: 14px; font-weight: 600; color: #1e293b; }
  .sig-section { border: 2px solid #e2e8f0; border-radius: 8px; padding: 24px; margin-top: 24px; }
  .sig-label { font-size: 10px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .sig-img { max-height: 80px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px; }
  .sig-meta { font-size: 11px; color: #64748b; margin-top: 8px; }
  .footer { margin-top: 32px; text-align: center; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 16px; }
  .no-print { margin-bottom: 20px; text-align: center; }
  @media print { .no-print { display: none !important; } body { padding: 20px; } }
`
const PDF_PRINT_BTN = `
  <div class="no-print">
    <button onclick="window.print()" style="background:#0a2540;color:white;border:none;padding:10px 28px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">
      🖨️ Print / Save as PDF
    </button>
    <p style="margin-top:8px;font-size:11px;color:#64748b;">Use your browser's "Save as PDF" option when printing</p>
  </div>
`
const PDF_HEADER = `
  <div class="header" style="background:#0a2540;padding:24px 32px;text-align:center;border-radius:8px 8px 0 0;">
    <img src="${ZENITH_LOGO_FULL}" style="height:64px;max-width:320px;object-fit:contain;" alt="Zenith Pure Solutions" />
    <p style="color:#93c5fd;font-size:12px;margin-top:10px;">6951 E 30th St, Suite B · Indianapolis, IN 46219</p>
    <p style="color:#93c5fd;font-size:12px;">(317) 690-4172 · zenithpuresolutions.com</p>
  </div>
`
`
const PDF_FOOTER = `
  <div class="footer">
    <p>Zenith Pure Solutions LLC · 6951 E 30th St, Suite B, Indianapolis, IN 46219</p>
    <p>(317) 690-4172 · info@zenithpuresolutions.com · zenithpuresolutions.com</p>
  </div>
`

// ─── Quote PDF generator ──────────────────────────────────────────
function generateQuoteHTML(quote: any, customer: any, lineItems: any[]): string {
  const isRental = quote.commercial_type === 'rental'
  const productItems = lineItems.filter((li: any) => li.item_type !== 'service_plan')
  const planItems    = lineItems.filter((li: any) => li.item_type === 'service_plan')

  const rowsHTML = productItems.map((li: any) => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#334155;">
        <strong>${li.description}</strong>
      </td>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:center;font-size:13px;color:#64748b;">${li.quantity}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;color:#64748b;">${fmt(parseFloat(li.unit_price) || 0)}${isRental ? '/mo' : ''}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;font-weight:600;color:#0f172a;">${fmt(parseFloat(li.total) || 0)}${isRental ? '/mo' : ''}</td>
    </tr>`).join('')

  const plansHTML = planItems.length > 0 ? `
    <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:16px;margin-top:16px;">
      <div style="font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;">Included Service Plans</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${planItems.map((p: any) => `
          <tr>
            <td style="font-size:13px;color:#78350f;padding:4px 0;">${p.description}</td>
            <td style="font-size:13px;color:#92400e;font-weight:600;text-align:right;padding:4px 0;">${fmt(parseFloat(p.unit_price) || 0)}</td>
          </tr>`).join('')}
      </table>
    </div>` : ''

  const totalsHTML = isRental ? `
    <table width="240" cellpadding="0" cellspacing="0" style="margin-left:auto;">
      <tr><td style="font-size:13px;color:#64748b;padding:4px 0;">Installation Fee (one-time)</td><td style="text-align:right;font-size:13px;font-weight:600;color:#0f172a;padding:4px 0;">${fmt(parseFloat(quote.install_fee) || 0)}</td></tr>
      <tr style="border-top:2px solid #e2e8f0;"><td style="font-size:15px;font-weight:700;color:#0f172a;padding-top:8px;">Monthly Total</td><td style="text-align:right;font-size:16px;font-weight:800;color:#1e3a8a;padding-top:8px;">${fmt(parseFloat(quote.monthly_amount) || 0)}/mo</td></tr>
    </table>` : `
    <table width="240" cellpadding="0" cellspacing="0" style="margin-left:auto;">
      <tr><td style="font-size:13px;color:#64748b;padding:4px 0;">Subtotal</td><td style="text-align:right;font-size:13px;font-weight:600;color:#0f172a;padding:4px 0;">${fmt(parseFloat(quote.subtotal) || 0)}</td></tr>
      <tr><td style="font-size:13px;color:#64748b;padding:4px 0 10px;">Tax (7% Indiana)</td><td style="text-align:right;font-size:13px;font-weight:600;color:#0f172a;padding:4px 0 10px;">${fmt(parseFloat(quote.tax_amount) || 0)}</td></tr>
      <tr style="border-top:2px solid #e2e8f0;"><td style="font-size:15px;font-weight:700;color:#0f172a;padding-top:8px;">Total</td><td style="text-align:right;font-size:17px;font-weight:800;color:#0f172a;padding-top:8px;">${fmt(parseFloat(quote.total) || 0)}</td></tr>
    </table>`

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>${quote.quote_number} — Zenith Pure Solutions</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Georgia, serif; color: #1a1a2e; background: white; padding: 40px; max-width: 800px; margin: 0 auto; }
  @media print { .no-print { display: none !important; } body { padding: 20px; } }
</style>
</head><body>
${PDF_PRINT_BTN}

<!-- Header -->
<div style="background:#0a2540;color:white;padding:28px 32px;border-radius:8px 8px 0 0;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td><div style="font-size:11px;color:#93c5fd;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:4px;">Zenith Pure Solutions LLC</div>
          <div style="font-size:22px;font-weight:900;letter-spacing:1px;">QUOTATION # ${quote.quote_number}</div></td>
      <td style="text-align:right;vertical-align:top;">
        <div style="font-size:11px;color:#93c5fd;">6951 E 30th, Suite B</div>
        <div style="font-size:11px;color:#93c5fd;">Indianapolis IN 46219</div>
        <div style="font-size:11px;color:#93c5fd;">United States</div>
      </td>
    </tr>
  </table>
</div>

<!-- Bill To / Install -->
<div style="border:1px solid #e2e8f0;border-top:none;padding:20px 28px;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td width="50%" style="vertical-align:top;">
        <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Bill To:</div>
        <div style="font-size:13px;font-weight:600;color:#1e293b;">${customer?.full_name || ''}</div>
        <div style="font-size:12px;color:#64748b;">${customer?.address || ''}</div>
        <div style="font-size:12px;color:#64748b;">${[customer?.city, customer?.state, customer?.zip].filter(Boolean).join(', ')}</div>
        <div style="font-size:12px;color:#64748b;">United States</div>
      </td>
      <td width="50%" style="vertical-align:top;">
        <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Installation Address</div>
        <div style="font-size:13px;font-weight:600;color:#1e293b;">${customer?.full_name || ''}</div>
        <div style="font-size:12px;color:#64748b;">${customer?.address || ''}</div>
        <div style="font-size:12px;color:#64748b;">${[customer?.city, customer?.state, customer?.zip].filter(Boolean).join(', ')}</div>
        <div style="font-size:12px;color:#64748b;">${customer?.phone || ''}</div>
      </td>
    </tr>
  </table>
</div>

<!-- Meta row -->
<div style="border:1px solid #e2e8f0;border-top:none;padding:14px 28px;background:#f8fafc;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td><div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Quotation Date</div><div style="font-size:13px;color:#1e293b;margin-top:2px;">${quote.created_at ? new Date(quote.created_at).toLocaleDateString() : today()}</div></td>
      <td><div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Expiration</div><div style="font-size:13px;color:#dc2626;font-weight:600;margin-top:2px;">${quote.valid_until ? new Date(quote.valid_until).toLocaleDateString() : '—'}</div></td>
      <td><div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Sales Consultant</div><div style="font-size:13px;color:#1e293b;margin-top:2px;">Kuldeep</div></td>
      <td><div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Type</div><div style="font-size:13px;color:#1e293b;margin-top:2px;">${isRental ? 'Rental' : 'Purchase'}</div></td>
    </tr>
  </table>
</div>

<!-- Line items -->
<div style="border:1px solid #e2e8f0;border-top:none;padding:16px 28px;">
  <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:12px;">ESTIMATION DETAILS</div>
  <p style="font-size:12px;color:#64748b;margin-bottom:16px;line-height:1.6;">This system has been recommended based on your home size, water usage, and water quality needs.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;">
    <thead>
      <tr style="background:#f8fafc;">
        <th style="padding:10px 16px;text-align:left;font-size:11px;color:#94a3b8;font-weight:700;border-bottom:2px solid #e2e8f0;text-transform:uppercase;">Name and Description</th>
        <th style="padding:10px 16px;text-align:center;font-size:11px;color:#94a3b8;font-weight:700;border-bottom:2px solid #e2e8f0;text-transform:uppercase;">Qty</th>
        <th style="padding:10px 16px;text-align:right;font-size:11px;color:#94a3b8;font-weight:700;border-bottom:2px solid #e2e8f0;text-transform:uppercase;">Unit Price</th>
        <th style="padding:10px 16px;text-align:right;font-size:11px;color:#94a3b8;font-weight:700;border-bottom:2px solid #e2e8f0;text-transform:uppercase;">Total</th>
      </tr>
    </thead>
    <tbody>${rowsHTML}</tbody>
  </table>
  <div style="background:#f8fafc;border-radius:8px;padding:16px 20px;margin-top:8px;">${totalsHTML}</div>
  ${plansHTML}
</div>

<!-- Customer Authorization -->
<div style="border:1px solid #e2e8f0;border-top:none;padding:20px 28px;">
  <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:10px;">CUSTOMER AUTHORIZATION</div>
  <p style="font-size:11px;color:#64748b;line-height:1.7;margin-bottom:8px;">This is an estimate, not a final invoice or contract for services.</p>
  <p style="font-size:11px;color:#64748b;line-height:1.7;margin-bottom:8px;">The summary above is a good-faith estimate based on our evaluation of the work to be performed at the installation address.</p>
  <p style="font-size:11px;color:#64748b;line-height:1.7;margin-bottom:8px;">By approving this estimate, I authorize Zenith Pure Solutions to proceed as outlined and agree to pay the full amount for all services rendered.</p>
  ${quote.commercial_type === 'purchase' ? `
  <div style="margin-top:20px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
    <div style="background:#f8fafc;padding:10px 16px;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e2e8f0;">Direct Transfer / ACH Details</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;">
      <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:9px 16px;font-weight:600;color:#374151;width:180px;">Bank Name</td><td style="padding:9px 16px;color:#64748b;">Old National Bank</td></tr>
      <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:9px 16px;font-weight:600;color:#374151;">ACH ABA Number</td><td style="padding:9px 16px;color:#64748b;">086300012</td></tr>
      <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:9px 16px;font-weight:600;color:#374151;">Account Number</td><td style="padding:9px 16px;color:#64748b;">0127726846</td></tr>
      <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:9px 16px;font-weight:600;color:#374151;">Account Name</td><td style="padding:9px 16px;color:#64748b;">ZENITH PURE SOLUTIONS LLC</td></tr>
      <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:9px 16px;font-weight:600;color:#374151;">Email</td><td style="padding:9px 16px;color:#64748b;">accounts@zenithpuresolutions.com</td></tr>
      <tr><td style="padding:9px 16px;font-weight:600;color:#374151;">Phone Number</td><td style="padding:9px 16px;color:#64748b;">+1 (317) 690-4172</td></tr>
    </table>
  </div>` : ''}
</div>

<!-- Signature block -->
<div style="border:2px solid #e2e8f0;border-radius:8px;padding:28px;margin-top:20px;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td width="48%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;">
        <div style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Zenith Pure Solutions LLC</div>
        <div style="font-size:20px;font-style:italic;font-family:Georgia,serif;color:#0a2540;border-bottom:1px solid #334155;padding-bottom:6px;margin-bottom:8px;">Kuldeep Singh</div>
        <div style="font-size:11px;color:#64748b;">Authorized Representative · ${today()}</div>
      </td>
      <td width="4%"></td>
      <td width="48%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;">
        <div style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Customer</div>
        <div style="font-size:20px;font-style:italic;font-family:Georgia,serif;color:#0a2540;border-bottom:1px solid #334155;padding-bottom:6px;margin-bottom:8px;">${quote.signed_name || customer?.full_name || ''}</div>
        <div style="font-size:11px;color:#64748b;">${customer?.full_name || ''} · Signed ${quote.signed_at ? new Date(quote.signed_at).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }) : today()}</div>
      </td>
    </tr>
  </table>
  <div style="text-align:right;font-size:10px;color:#94a3b8;margin-top:16px;">Quote Version: ${new Date().toLocaleString()}</div>
</div>

<!-- Footer -->
<div style="margin-top:24px;text-align:center;font-size:10px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:16px;">
  <p>Zenith Pure Solutions LLC · 6951 E 30th St, Suite B, Indianapolis, IN 46219</p>
  <p style="margin-top:3px;">(317) 690-4172 · info@zenithpuresolutions.com · zenithpuresolutions.com</p>
  <p style="margin-top:3px;font-style:italic;">Engineered for purity. Installed with care. Backed by Zenith Pure Solutions.</p>
</div>
</body></html>`
}

// ─── Agreement PDF generator ──────────────────────────────────────
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

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
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
  .no-print { margin-bottom: 20px; text-align: center; }
  @media print { body { padding: 20px; } .no-print { display: none !important; } }
</style>
</head><body>
  ${PDF_PRINT_BTN}
  <div class="header"><h1>ZENITH PURE SOLUTIONS LLC</h1><p>6951 E 30th St, Suite B · Indianapolis, IN 46219</p><p>(317) 690-4172 · zenithpuresolutions.com</p></div>
  <div class="subheader">
    <div style="font-size:10px;font-weight:bold;color:#94a3b8;text-transform:uppercase;letter-spacing:2px;margin-bottom:4px;">Legal Agreement</div>
    <h2>Residential Equipment Rental Agreement</h2>
    <div class="agnum">${agreement.agreement_number}</div>
  </div>
  <div class="parties">
    <div><div class="party-label">Company</div><div class="party-name">Zenith Pure Solutions LLC</div><div class="party-address">6951 E 30th St, Suite B<br/>Indianapolis, IN 46219</div></div>
    <div><div class="party-label">Customer</div><div class="party-name">${customer?.full_name || ''}</div><div class="party-address">${customer?.address || ''}<br/>${customer?.city || ''}, ${customer?.state || ''} ${customer?.zip || ''}</div></div>
  </div>
  <div class="financials">
    <div><div class="fin-label">Monthly Payment</div><div class="fin-value">${fmt(agreement.monthly_amount || 0)}/mo</div></div>
    <div><div class="fin-label">Setup Fee (one-time)</div><div class="fin-value">${fmt(agreement.install_fee || 0)}</div></div>
    <div><div class="fin-label">Initial Term</div><div class="fin-value">36 months</div></div>
  </div>
  <div class="notice">By signing, you agree to all terms including the binding arbitration clause in Article IX.</div>
  <div class="intro">This Agreement is entered into as of <strong>${today()}</strong> between <strong>Zenith Pure Solutions LLC</strong> ("Company") and <strong>${customer?.full_name || ''}</strong> ("Customer").</div>
  ${termBlocksHTML}
  <div class="signatures">
    <div style="font-weight:bold;font-size:13px;margin-bottom:4px;">IN WITNESS WHEREOF</div>
    <p style="font-size:11px;color:#64748b;margin-bottom:24px;">Executed as of ${today()}.</p>
    <div class="sig-grid">
      <div class="sig-box"><div class="sig-party-label">ZENITH PURE SOLUTIONS LLC</div><div class="sig-name">Kuldeep Singh</div><div class="sig-meta">Authorized Representative · ${today()}</div></div>
      <div class="sig-box"><div class="sig-party-label">CUSTOMER</div><div class="sig-name">${agreement.signed_name || customer?.full_name || ''}</div><div class="sig-meta">${customer?.full_name || ''} · Signed ${agreement.signed_at ? new Date(agreement.signed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : today()}</div></div>
    </div>
  </div>
  <div class="footer"><p>Zenith Pure Solutions LLC · 6951 E 30th St, Suite B, Indianapolis, IN 46219</p><p>(317) 690-4172 · info@zenithpuresolutions.com · zenithpuresolutions.com</p><p style="margin-top:6px;">Agreement ${agreement.agreement_number} · Generated ${today()}</p></div>
</body></html>`
}

// ─── Invoice PDF generator ────────────────────────────────────────
function generateInvoiceHTML(invoice: any, customer: any, lineItems: any[]): string {
  const items = lineItems.length > 0 ? lineItems : (invoice.line_items_snapshot || [])
  const rowsHTML = items.map((item: any) => `
    <tr style="border-bottom:1px solid #f1f5f9;">
      <td style="padding:12px 24px;font-size:13px;color:#1e293b;">${item.description}</td>
      <td style="padding:12px 16px;font-size:13px;color:#64748b;text-align:center;">${item.quantity || 1}</td>
      <td style="padding:12px 16px;font-size:13px;color:#64748b;text-align:right;">${fmt(parseFloat(item.unit_price) || 0)}</td>
      <td style="padding:12px 24px;font-size:13px;font-weight:600;color:#0f172a;text-align:right;">${fmt(parseFloat(item.total) || 0)}</td>
    </tr>`).join('')

  const subtotal  = parseFloat(invoice.subtotal) || (parseFloat(invoice.total) - parseFloat(invoice.tax_amount || 0)) || 0
  const taxAmount = parseFloat(invoice.tax_amount) || 0
  const total     = parseFloat(invoice.total) || 0

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>${invoice.invoice_number} — Zenith Pure Solutions</title>
<style>* { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: Georgia, serif; color: #1a1a2e; background: white; padding: 40px; max-width: 800px; margin: 0 auto; } @media print { body { padding: 20px; } .no-print { display: none !important; } }</style>
</head><body>
  ${PDF_PRINT_BTN}
  <div style="background:#0a2540;color:white;padding:32px;border-radius:8px 8px 0 0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><div style="font-size:28px;font-weight:900;letter-spacing:1px;">INVOICE</div><div style="color:#93c5fd;font-size:13px;margin-top:4px;">${invoice.invoice_number}</div><div style="color:#93c5fd;font-size:12px;margin-top:2px;">Zenith Pure Solutions LLC</div></td>
      <td style="text-align:right;"><div style="font-size:36px;font-weight:900;">${fmt(total)}</div><div style="color:#93c5fd;font-size:11px;margin-top:2px;">Total Amount Due</div></td>
    </tr></table>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;padding:20px 24px;border:1px solid #e2e8f0;border-top:none;">
    <div><div style="font-size:10px;font-weight:bold;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Bill To</div>
      <div style="font-weight:bold;font-size:14px;">${customer?.full_name || ''}</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px;">${customer?.address || ''}</div>
      <div style="font-size:12px;color:#64748b;">${customer?.city || ''}, ${customer?.state || ''} ${customer?.zip || ''}</div>
      <div style="font-size:12px;color:#64748b;">${customer?.phone || ''}</div>
    </div>
    <div style="text-align:right;"><div style="font-size:10px;font-weight:bold;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">From</div>
      <div style="font-weight:bold;font-size:14px;">Zenith Pure Solutions LLC</div>
      <div style="font-size:12px;color:#64748b;">6951 E 30th St, Suite B</div>
      <div style="font-size:12px;color:#64748b;">Indianapolis, IN 46219</div>
      <div style="font-size:12px;color:#64748b;margin-top:8px;">Invoice Date: ${today()}</div>
      <div style="font-size:12px;color:${invoice.paid_at ? '#16a34a' : '#dc2626'};font-weight:600;margin-top:4px;">${invoice.paid_at ? '✓ Paid ' + new Date(invoice.paid_at).toLocaleDateString() : 'Unpaid'}</div>
    </div>
  </div>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-top:none;">
    <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">
      <th style="padding:10px 24px;text-align:left;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Description</th>
      <th style="padding:10px 16px;text-align:center;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Qty</th>
      <th style="padding:10px 16px;text-align:right;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Unit Price</th>
      <th style="padding:10px 24px;text-align:right;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Amount</th>
    </tr></thead>
    <tbody>${rowsHTML}</tbody>
  </table>
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;padding:16px 24px;">
    <table width="240" cellpadding="0" cellspacing="0" style="margin-left:auto;">
      <tr><td style="font-size:13px;color:#64748b;padding:4px 0;">Subtotal</td><td style="text-align:right;font-weight:600;color:#0f172a;font-size:13px;padding:4px 0;">${fmt(subtotal)}</td></tr>
      <tr><td style="font-size:13px;color:#64748b;padding:4px 0 8px;">Tax (7% Indiana)</td><td style="text-align:right;font-weight:600;color:#0f172a;font-size:13px;padding:4px 0 8px;">${fmt(taxAmount)}</td></tr>
      <tr style="border-top:2px solid #cbd5e1;"><td style="font-size:16px;font-weight:bold;color:#0f172a;padding-top:8px;">Total</td><td style="text-align:right;font-size:17px;font-weight:bold;color:#0f172a;padding-top:8px;">${fmt(total)}</td></tr>
      ${invoice.amount_paid ? `<tr><td style="font-size:13px;color:#16a34a;font-weight:600;padding-top:6px;">Amount Paid</td><td style="text-align:right;font-size:13px;font-weight:600;color:#16a34a;padding-top:6px;">${fmt(parseFloat(invoice.amount_paid))}</td></tr>` : ''}
    </table>
  </div>
  <div style="border:2px solid #e2e8f0;border-radius:8px;padding:28px 24px;margin-top:20px;">
    <div style="font-weight:bold;font-size:13px;margin-bottom:4px;">Customer Authorization</div>
    <p style="font-size:11px;color:#64748b;margin-bottom:20px;">By signing, I authorize Zenith Pure Solutions to proceed and agree to the payment terms above.</p>
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="48%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;">
        <div style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">ZENITH PURE SOLUTIONS LLC</div>
        <div style="font-size:20px;font-style:italic;font-family:Georgia,serif;color:#0a2540;border-bottom:1px solid #334155;padding-bottom:6px;margin-bottom:8px;">Kuldeep Singh</div>
        <div style="font-size:11px;color:#64748b;">Authorized Representative · ${today()}</div>
      </td>
      <td width="4%"></td>
      <td width="48%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;">
        <div style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">CUSTOMER</div>
        <div style="font-size:20px;font-style:italic;font-family:Georgia,serif;color:#0a2540;border-bottom:1px solid #334155;padding-bottom:6px;margin-bottom:8px;">${invoice.signed_name || customer?.full_name || ''}</div>
        <div style="font-size:11px;color:#64748b;">${customer?.full_name || ''} · Signed ${invoice.signed_at ? new Date(invoice.signed_at).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }) : today()}</div>
      </td>
    </tr></table>
  </div>
  <div style="margin-top:28px;text-align:center;font-size:10px;color:#94a3b8;">
    <p>Zenith Pure Solutions LLC · 6951 E 30th St, Suite B, Indianapolis, IN 46219</p>
    <p>(317) 690-4172 · info@zenithpuresolutions.com · zenithpuresolutions.com</p>
    <p style="margin-top:4px;">Invoice ${invoice.invoice_number} · Generated ${today()}</p>
  </div>
</body></html>`
}

// ─── Drilling Consent PDF ─────────────────────────────────────────
function generateDrillingConsentHTML(form: any, signatureUrl: string | null): string {
  const rd = form.response_data || {}
  const customerName = rd.customer_name || rd.signed_name || '—'
  const consentDate  = rd.consent_date ? new Date(rd.consent_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : today()
  const jobRef       = rd.job_reference || rd.job_id || '—'
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>RO Drilling Consent — ${customerName}</title><style>${PDF_BASE_STYLES}</style></head><body>
  ${PDF_PRINT_BTN}${PDF_HEADER}
  <div class="subheader"><div style="font-size:10px;font-weight:bold;color:#94a3b8;text-transform:uppercase;letter-spacing:2px;margin-bottom:4px;">Customer Acknowledgement</div><h2>Reverse Osmosis Drilling Consent Form</h2><div class="sub">Completed ${consentDate}</div></div>
  <div class="body-section">
    <div class="info-grid">
      <div class="info-item"><div class="info-label">Customer Name</div><div class="info-value">${customerName}</div></div>
      <div class="info-item"><div class="info-label">Date Signed</div><div class="info-value">${consentDate}</div></div>
      ${jobRef !== '—' ? `<div class="info-item"><div class="info-label">Job Reference</div><div class="info-value">${jobRef}</div></div>` : ''}
    </div>
    <p>I authorize <strong>Zenith Pure Solutions</strong> to drill a hole for installation of the RO faucet when an existing opening is not available.</p>
    <p>I understand and acknowledge that:</p>
    <ul>
      <li>Final pricing may vary if unforeseen material conditions or installation complexities are identified on site.</li>
      <li>Natural and manufactured sink or countertop materials may contain hidden variations or stress points.</li>
      <li>Minor cosmetic variations may occur despite proper installation methods.</li>
      <li>Zenith Pure Solutions is not responsible for pre-existing conditions and does not include repair or replacement of sinks, countertops, or cabinetry.</li>
    </ul>
    <div class="confirm-box">✓ I confirm that I am the property owner or have authorization to approve this work.</div>
    <div class="confirm-box">✓ I have read and understand the above terms and agree to the conditions stated in this Reverse Osmosis Drilling Consent Form.</div>
  </div>
  <div class="sig-section">
    <div class="sig-label">Customer Signature</div>
    ${signatureUrl ? `<img src="${signatureUrl}" class="sig-img" alt="Customer signature" />` : '<div style="height:60px;border-bottom:1px solid #334155;"></div>'}
    <div class="sig-meta">${customerName} · Signed ${consentDate}</div>
  </div>
  ${PDF_FOOTER}
</body></html>`
}

// ─── Handover PDF ─────────────────────────────────────────────────
function generateHandoverHTML(form: any, signatureUrl: string | null, customer: any): string {
  const rd = form.response_data || {}
  const tdsReading  = rd.tds_reading || '—'
  const submittedAt = rd.submitted_at ? new Date(rd.submitted_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : today()
  const customerName = rd.customer_name || rd.signed_name || customer?.full_name || '—'
  const jobRef       = rd.job_reference || rd.job_id || '—'
  const tdsColor = Number(tdsReading) < 50 ? '#166534' : Number(tdsReading) < 150 ? '#1e3a8a' : '#7c2d12'
  const tdsNote  = Number(tdsReading) < 50 ? 'Excellent — pure water output' : Number(tdsReading) < 150 ? 'Good — within healthy range' : 'Elevated — system may need service'
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>RO Handover — ${customerName}</title><style>${PDF_BASE_STYLES}.tds-box{background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:20px;text-align:center;margin:16px 0;}.tds-label{font-size:11px;font-weight:bold;color:#3b82f6;text-transform:uppercase;letter-spacing:1px;}.tds-value{font-size:36px;font-weight:bold;margin-top:4px;}.tds-unit{font-size:14px;color:#64748b;margin-top:2px;}</style></head><body>
  ${PDF_PRINT_BTN}${PDF_HEADER}
  <div class="subheader"><div style="font-size:10px;font-weight:bold;color:#94a3b8;text-transform:uppercase;letter-spacing:2px;margin-bottom:4px;">Installation Record</div><h2>Reverse Osmosis System Handover</h2><div class="sub">Completed ${submittedAt}</div></div>
  <div class="body-section">
    <div class="info-grid">
      <div class="info-item"><div class="info-label">Customer</div><div class="info-value">${customerName}</div></div>
      <div class="info-item"><div class="info-label">Handover Date</div><div class="info-value">${submittedAt}</div></div>
      ${customer?.address ? `<div class="info-item"><div class="info-label">Service Address</div><div class="info-value">${customer.address}${customer.city ? ', ' + customer.city : ''}</div></div>` : ''}
      ${jobRef !== '—' ? `<div class="info-item"><div class="info-label">Job Reference</div><div class="info-value">${jobRef}</div></div>` : ''}
    </div>
    <div class="tds-box"><div class="tds-label">Post-Install TDS Reading</div><div class="tds-value" style="color:${tdsColor};">${tdsReading}</div><div class="tds-unit">ppm (parts per million)</div><div style="font-size:12px;color:#64748b;margin-top:6px;">${tdsNote}</div></div>
    <p style="margin-top:16px;"><strong>System Handover Checklist — Completed at Installation:</strong></p>
    <ul>
      <li>RO system installed and tested — all connections checked for leaks</li>
      <li>TDS meter reading taken and recorded (${tdsReading} ppm post-filter)</li>
      <li>Customer shown faucet operation, tank fill time, and daily output expectations</li>
      <li>Filter replacement schedule explained (annual — Zenith will contact you)</li>
      <li>Emergency shutoff valve location demonstrated</li>
      <li>Customer questions answered before technician departure</li>
    </ul>
    <div class="confirm-box" style="margin-top:20px;">✓ Customer confirms the system was demonstrated and is operating correctly at time of handover.</div>
  </div>
  <div class="sig-section">
    <div class="sig-label">Customer Signature</div>
    ${signatureUrl ? `<img src="${signatureUrl}" class="sig-img" alt="Customer signature" />` : '<div style="height:60px;border-bottom:1px solid #334155;"></div>'}
    <div class="sig-meta">${customerName} · Signed ${submittedAt}</div>
  </div>
  ${PDF_FOOTER}
</body></html>`
}

// ─── Open print window helper ─────────────────────────────────────
function openPrintWindow(html: string, filename: string) {
  const win = window.open('', '_blank')
  if (win) {
    win.document.write(html)
    win.document.close()
    setTimeout(() => win.print(), 600)
  } else {
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }
}

// ─── Data hooks ──────────────────────────────────────────────────

function useCustomerJobAndLead(customerId: string) {
  return useQuery({
    queryKey: ['customer_refs', customerId],
    queryFn: async () => {
      const { data } = await supabase.from('customers')
        .select('job_id, lead_id, full_name, address, city, state, zip, phone, email')
        .eq('id', customerId).single()
      return data || { job_id: null, lead_id: null, full_name: null, address: null, city: null, state: null, zip: null, phone: null, email: null }
    },
    enabled: !!customerId,
  })
}

async function mergeByIdDesc<T extends { id: string; created_at: string }>(
  queries: Promise<{ data: T[] | null }>[]
): Promise<T[]> {
  const seen = new Set<string>()
  const results: T[] = []
  const responses = await Promise.all(queries)
  for (const res of responses) {
    for (const row of (res.data || [])) {
      if (!seen.has(row.id)) { seen.add(row.id); results.push(row) }
    }
  }
  results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  return results
}

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

function useAcceptedQuotes(customerId: string, leadId: string | null) {
  return useQuery({
    queryKey: ['customer_accepted_quotes', customerId, leadId],
    queryFn: () => mergeByIdDesc([
      supabase.from('quotes').select('id, quote_number, lead_id, created_at, status, commercial_type, monthly_amount, total, install_fee, subtotal, tax_amount, signed_at, signed_name, valid_until').eq('customer_id', customerId).in('status', ['accepted', 'signed']).order('created_at', { ascending: false }) as any,
      ...(leadId ? [supabase.from('quotes').select('id, quote_number, lead_id, created_at, status, commercial_type, monthly_amount, total, install_fee, subtotal, tax_amount, signed_at, signed_name, valid_until').eq('lead_id', leadId).in('status', ['accepted', 'signed']).order('created_at', { ascending: false }) as any] : []),
    ]),
    enabled: !!customerId,
  })
}

function usePaidInvoices(customerId: string, leadId: string | null) {
  return useQuery({
    queryKey: ['customer_paid_invoices', customerId, leadId],
    queryFn: () => mergeByIdDesc([
      supabase.from('invoices').select('id, invoice_number, lead_id, created_at, paid_at, status, total, amount_paid, subtotal, tax_amount, signed_at, signed_name, line_items_snapshot').eq('customer_id', customerId).in('status', ['paid', 'partial']).order('paid_at', { ascending: false }) as any,
      ...(leadId ? [supabase.from('invoices').select('id, invoice_number, lead_id, created_at, paid_at, status, total, amount_paid, subtotal, tax_amount, signed_at, signed_name, line_items_snapshot').eq('lead_id', leadId).in('status', ['paid', 'partial']).order('paid_at', { ascending: false }) as any] : []),
    ]),
    enabled: !!customerId,
  })
}

function useJobFormResponses(jobId: string | null) {
  return useQuery({
    queryKey: ['customer_job_forms', jobId],
    queryFn: async () => {
      if (!jobId) return []
      const { data } = await supabase.from('job_form_responses').select('*').eq('job_id', jobId).order('submitted_at', { ascending: false })
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
      const { data } = await supabase.from('job_signatures').select('*').eq('job_id', jobId).order('signed_at', { ascending: false })
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
      const { data } = await supabase.from('job_photos').select('*').eq('job_id', jobId).eq('review_status', 'approved').order('created_at', { ascending: true })
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

  const [reviewModal, setReviewModal]     = useState<any>(null)
  const [lightboxUrl, setLightboxUrl]     = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  // ─── Agreement download ───────────────────────────────────────
  async function handleDownloadAgreement(agr: any) {
    setDownloadingId(agr.id)
    try {
      let terms: any[] = agr.terms_snapshot?.blocks || []
      if (!terms.length) {
        const { data: fetchedTerms } = await supabase.from('term_blocks')
          .select('slug, display_title, content, version')
          .like('slug', 'ra-%').eq('is_active', true).order('sort_order')
        terms = fetchedTerms || []
      }
      openPrintWindow(generateAgreementHTML(agr, refs, terms), `${agr.agreement_number}.html`)
    } catch (e: any) { console.error('Download failed:', e.message) }
    finally { setDownloadingId(null) }
  }

  // ─── Quote download ───────────────────────────────────────────
  async function handleDownloadQuote(q: any) {
    setDownloadingId(q.id)
    try {
      // Fetch full line items from document_line_items, fallback to quote_line_items
      let { data: lineItems } = await supabase.from('document_line_items')
        .select('*').eq('document_id', q.id).order('sort_order')
      if (!lineItems || lineItems.length === 0) {
        const { data: legacy } = await supabase.from('quote_line_items')
          .select('*').eq('quote_id', q.id).order('sort_order')
        lineItems = legacy || []
      }
      openPrintWindow(generateQuoteHTML(q, refs, lineItems || []), `${q.quote_number}.html`)
    } catch (e: any) { console.error('Download failed:', e.message) }
    finally { setDownloadingId(null) }
  }

  // ─── Invoice download ─────────────────────────────────────────
  async function handleDownloadInvoice(inv: any) {
    setDownloadingId(inv.id)
    try {
      // Fetch line items fresh from document_line_items via quote_id
      let lineItems: any[] = []
      if (inv.line_items_snapshot?.length) {
        lineItems = inv.line_items_snapshot
      } else {
        // Try to find the quote linked to this invoice
        const { data: quoteData } = await supabase.from('quotes')
          .select('id').eq('customer_id', customerId)
          .in('status', ['accepted', 'signed']).order('created_at', { ascending: false }).limit(5)
        if (quoteData?.length) {
          for (const qt of quoteData) {
            const { data: items } = await supabase.from('document_line_items')
              .select('*').eq('document_id', qt.id).order('sort_order')
            if (items?.length) { lineItems = items; break }
          }
        }
      }
      openPrintWindow(generateInvoiceHTML(inv, refs, lineItems), `${inv.invoice_number}.html`)
    } catch (e: any) { console.error('Download failed:', e.message) }
    finally { setDownloadingId(null) }
  }

  // ─── Form download ────────────────────────────────────────────
  function handleDownloadForm(form: any) {
    setDownloadingId(form.id)
    try {
      const signatureUrl = form.customer_signature_url || null
      if (form.form_type === 'ro_drilling_consent') {
        openPrintWindow(generateDrillingConsentHTML(form, signatureUrl), `RO-Drilling-Consent-${form.id}.html`)
      } else if (form.form_type === 'ro_handover') {
        openPrintWindow(generateHandoverHTML(form, signatureUrl, refs), `RO-Handover-${form.id}.html`)
      }
    } catch (e: any) { console.error('Download failed:', e) }
    finally { setDownloadingId(null) }
  }

  if (proofsLoading) return <p className="text-sm text-muted text-center py-8">Loading documents...</p>

  const allProofs      = (proofs || []) as any[]
  const pendingProofs  = allProofs.filter(p => p.review_status === 'pending')
  const reviewedProofs = allProofs.filter(p => p.review_status !== 'pending')

  const hasAgreements = agreements.length > 0
  const hasQuotes     = acceptedQuotes.length > 0
  const hasInvoices   = paidInvoices.length > 0
  const hasForms      = formResponses.length > 0
  const hasSignatures = signatures.length > 0
  const hasPhotos     = approvedPhotos.length > 0
  const hasAnything   = allProofs.length > 0 || hasAgreements || hasQuotes || hasInvoices || hasForms || hasSignatures || hasPhotos

  const FORM_LABELS: Record<string, string> = {
    ro_handover: 'RO System Handover',
    ro_drilling_consent: 'RO Drilling Consent',
  }

  const DownloadBtn = ({ id, label, onClick }: { id: string; label: string; onClick: () => void }) => (
    <button onClick={onClick} disabled={downloadingId === id}
      className="text-xs px-2 py-0.5 rounded-lg font-semibold disabled:opacity-50"
      style={{ backgroundColor: 'rgba(56,189,248,0.12)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.25)' }}>
      {downloadingId === id ? '…' : label}
    </button>
  )

  return (
    <div className="space-y-5">

      {/* ─── Agreements ──────────────────────────────── */}
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
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${agr.signed_at ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                    {agr.signed_at ? 'Signed' : 'Pending'}
                  </span>
                  {agr.signed_at && (
                    <DownloadBtn id={agr.id} label="⬇ Full PDF" onClick={() => handleDownloadAgreement(agr)} />
                  )}
                </div>
              </div>
              <div className="text-xs text-muted space-y-0.5">
                {agr.agreement_number && <div className="text-slate-400 font-medium">{agr.agreement_number}</div>}
                {agr.signed_at && <div>Signed: {formatDateTime(agr.signed_at)}</div>}
                {agr.monthly_amount && <div>Monthly: ${agr.monthly_amount}/mo</div>}
                {agr.rental_term_months && <div>Term: {agr.rental_term_months} months</div>}
                {agr.install_address && <div>Install: {agr.install_address}</div>}
              </div>
              {agr.customer_signature && (
                <div className="mt-2">
                  <div className="text-xs text-gray-500 mb-1">Customer signature:</div>
                  <img src={agr.customer_signature} alt="Signature" className="h-12 bg-white rounded px-2 py-1 cursor-pointer" onClick={() => setLightboxUrl(agr.customer_signature)} />
                </div>
              )}
            </DocCard>
          ))}
        </DocSection>
      )}

      {/* ─── Accepted Quotes ──────────────────────────── */}
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
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                    style={{ backgroundColor: 'rgba(56,189,248,0.15)', color: '#38bdf8' }}>
                    {q.status === 'signed' ? 'Signed' : 'Accepted'}
                  </span>
                  <DownloadBtn id={q.id} label="⬇ Full PDF" onClick={() => handleDownloadQuote(q)} />
                </div>
              </div>
              <div className="text-xs text-muted space-y-0.5">
                {q.quote_number && <div className="text-slate-400 font-medium">{q.quote_number}</div>}
                {q.created_at && <div>Date: {formatDateTime(q.created_at)}</div>}
                {q.signed_at && <div>Signed: {formatDateTime(q.signed_at)}</div>}
                {q.monthly_amount && <div>Monthly: ${q.monthly_amount}/mo</div>}
                {q.total && <div>Total: ${q.total}</div>}
                {q.install_fee && <div>Install fee: ${q.install_fee}</div>}
              </div>
            </DocCard>
          ))}
        </DocSection>
      )}

      {/* ─── Paid Invoices ────────────────────────────── */}
      {hasInvoices && (
        <DocSection title="Paid Invoices" icon="🧾" count={paidInvoices.length}>
          {(paidInvoices as any[]).map((inv: any) => (
            <DocCard key={inv.id}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm">🧾</span>
                  <span className="text-sm font-medium text-white">Invoice</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                    style={{ backgroundColor: 'rgba(74,222,128,0.15)', color: '#4ade80' }}>
                    {inv.status === 'partial' ? 'Partial' : 'Paid'}
                  </span>
                  <DownloadBtn id={inv.id} label="⬇ Full PDF" onClick={() => handleDownloadInvoice(inv)} />
                </div>
              </div>
              <div className="text-xs text-muted space-y-0.5">
                {inv.invoice_number && <div className="text-slate-400 font-medium">{inv.invoice_number}</div>}
                {inv.paid_at && <div>Paid: {formatDateTime(inv.paid_at)}</div>}
                {inv.signed_at && <div>Signed: {formatDateTime(inv.signed_at)}</div>}
                {inv.total && <div>Total: ${inv.total}</div>}
                {inv.amount_paid && <div>Amount paid: ${inv.amount_paid}</div>}
              </div>
            </DocCard>
          ))}
        </DocSection>
      )}

      {/* ─── Customer Handover Records ─────────────────── */}
      {hasForms && (
        <DocSection title="Customer Handover" icon="🤝" count={formResponses.length}>
          {formResponses.map((form: any) => {
            const rd = form.response_data || {}
            const canDownload = form.form_type === 'ro_drilling_consent' || form.form_type === 'ro_handover'
            return (
              <DocCard key={form.id}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">🤝</span>
                    <span className="text-sm font-medium text-white">
                      {FORM_LABELS[form.form_type] || form.form_type?.replace(/_/g, ' ') || 'Handover Form'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-green-500/20 text-green-400">Completed</span>
                    {canDownload && (
                      <DownloadBtn id={form.id} label="⬇ Full PDF" onClick={() => handleDownloadForm(form)} />
                    )}
                  </div>
                </div>
                <div className="text-xs text-muted space-y-0.5">
                  <div>Submitted: {formatDateTime(form.submitted_at)}</div>
                  {rd.customer_name && <div>Signed by: {rd.customer_name}</div>}
                  {rd.tds_reading && (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-blue-400 font-semibold">TDS: {rd.tds_reading} ppm</span>
                      <span className="text-gray-500">post-filter reading</span>
                    </div>
                  )}
                </div>
                {form.customer_signature_url && (
                  <div className="mt-2">
                    <div className="text-xs text-gray-500 mb-1">Customer signature:</div>
                    <img src={form.customer_signature_url} alt="Signature" className="h-12 bg-white rounded px-2 py-1 cursor-pointer" onClick={() => setLightboxUrl(form.customer_signature_url)} />
                  </div>
                )}
              </DocCard>
            )
          })}
        </DocSection>
      )}

      {/* ─── Consent Signatures ────────────────────────── */}
      {hasSignatures && (
        <DocSection title="Consent Signatures" icon="✍️" count={signatures.length}>
          {signatures.map((sig: any) => (
            <DocCard key={sig.id}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm">✍️</span>
                  <span className="text-sm font-medium text-white">Customer Consent</span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-green-500/20 text-green-400">Signed</span>
              </div>
              <div className="text-xs text-muted space-y-0.5">
                <div>Signed: {formatDateTime(sig.signed_at)}</div>
                {sig.signed_by_name && <div>Signed by: {sig.signed_by_name}</div>}
              </div>
              {sig.signature_url && (
                <div className="mt-2">
                  <img src={sig.signature_url} alt="Signature" className="h-12 bg-white rounded px-2 py-1 cursor-pointer" onClick={() => setLightboxUrl(sig.signature_url)} />
                </div>
              )}
            </DocCard>
          ))}
        </DocSection>
      )}

      {/* ─── Compliance Proofs — Pending ───────────────── */}
      {pendingProofs.length > 0 && (
        <DocSection title="Pending Review" icon="📋" count={pendingProofs.length} urgentColor>
          {pendingProofs.map(proof => (
            <ProofCard key={proof.id} proof={proof} canReview={role === 'admin'} onReview={() => setReviewModal(proof)} />
          ))}
        </DocSection>
      )}

      {/* ─── Compliance Proofs — Reviewed ──────────────── */}
      {reviewedProofs.length > 0 && (
        <DocSection title="Compliance Documents" icon="📄" count={reviewedProofs.length}>
          {reviewedProofs.map(proof => (
            <ProofCard key={proof.id} proof={proof} canReview={false} />
          ))}
        </DocSection>
      )}

      {/* ─── Approved Install Photos ───────────────────── */}
      {hasPhotos && (
        <DocSection title="Approved Install Photos" icon="📷" count={approvedPhotos.length}>
          <div className="grid grid-cols-3 gap-2 px-3 pb-3">
            {approvedPhotos.map((photo: any) => (
              <div key={photo.id} className="cursor-pointer" onClick={() => setLightboxUrl(photo.photo_url)}>
                <img src={photo.photo_url} alt={photo.caption || 'Install photo'} className="w-full aspect-square object-cover rounded-lg" />
                <div className="text-[10px] text-gray-500 mt-1 capitalize">{photo.category?.replace(/_/g, ' ')}</div>
              </div>
            ))}
          </div>
        </DocSection>
      )}

      {/* ─── Empty state ───────────────────────────────── */}
      {!hasAnything && (
        <div className="bg-card border border-border rounded-xl p-6 text-center">
          <div className="text-3xl mb-2">📎</div>
          <div className="text-sm text-muted">No documents on file yet.</div>
          <div className="text-xs text-muted mt-1">Agreements, quotes, invoices, handover records, and compliance proofs will appear here.</div>
        </div>
      )}

      {reviewModal && (
        <ProofReviewModal proof={reviewModal} customerId={customerId} onClose={() => setReviewModal(null)} onCompleted={() => setReviewModal(null)} />
      )}

      {lightboxUrl && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-8 cursor-pointer" onClick={() => setLightboxUrl(null)}>
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
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${urgentColor ? 'bg-amber-500/20 text-amber-400' : 'bg-gray-700 text-gray-300'}`}>{count}</span>
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
          <span className="text-sm font-medium text-white">{proof.proof_type?.replace(/_/g, ' ') || 'Compliance Proof'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${reviewStyle.color}20`, color: reviewStyle.color }}>
            {reviewStyle.label}
          </span>
          {canReview && proof.review_status === 'pending' && onReview && (
            <button onClick={onReview} className="text-xs px-2 py-0.5 rounded-lg font-semibold"
              style={{ backgroundColor: 'rgba(56,189,248,0.12)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.25)' }}>
              Review
            </button>
          )}
        </div>
      </div>
      <div className="text-xs text-muted space-y-0.5">
        <div>Submitted: {formatDate(proof.submitted_at)}</div>
        {proof.reviewed_at && <div>Reviewed: {formatDate(proof.reviewed_at)} {proof.reviewed_by ? `by ${proof.reviewed_by}` : ''}</div>}
        {proof.review_notes && <div className="text-slate-400 mt-1">Notes: {proof.review_notes}</div>}
      </div>
      {proof.proof_url && (
        <a href={proof.proof_url} target="_blank" rel="noopener noreferrer" className="text-xs mt-2 inline-block" style={{ color: '#38bdf8' }}>
          View document ↗
        </a>
      )}
    </DocCard>
  )
}
