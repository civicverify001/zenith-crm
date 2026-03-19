// api/email/send-buyout.js
// Sends branded buyout invoice email with payment link + terms & conditions link
// Matches send-quote.ts pattern exactly

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const RESEND_KEY = process.env.RESEND_API_KEY
const DOMAIN     = process.env.RESEND_DOMAIN || 'zenithpuresolutions.com'
const APP_URL    = process.env.VITE_APP_URL  || 'https://zenith-crm-ten.vercel.app'

const fmt     = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0)
const fmtDate = (s) => s ? new Date(s).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'

async function sendViaResend(to, subject, html, fromEmail, fromName) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, reply_to: fromEmail, to: [to], subject, html }),
  })
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`)
  return await r.json()
}

function buyoutHtml({ invoice, paymentLinkUrl, senderName, warrantyDetails, systemName }) {
  const lineItems = invoice.line_items_snapshot || []
  const total     = Number(invoice.total) || 0
  const termsUrl  = `${APP_URL}/terms`

  // Split line items into product lines and credit lines
  const productItems = lineItems.filter(li => !li.item_type || li.item_type === 'product' || li.item_type === 'buyout_product')
  const creditItems  = lineItems.filter(li => li.item_type === 'credit' || li.item_type === 'buyout_credit')
  const planItems    = lineItems.filter(li => li.item_type === 'service_plan')

  const productRows = productItems.map(li => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;color:#334155;font-size:14px">${li.description || '—'}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:center;color:#64748b;font-size:14px">${li.quantity || 1}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:right;color:#64748b;font-size:14px">${fmt(li.unit_price)}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;color:#0f172a;font-size:14px">${fmt(li.total)}</td>
    </tr>`).join('')

  const creditRows = creditItems.map(li => `
    <tr style="background:#f0fdf4;">
      <td style="padding:10px 16px;border-bottom:1px solid #dcfce7;color:#15803d;font-size:13px;font-style:italic">${li.description || '—'}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #dcfce7;text-align:center;color:#15803d;font-size:13px">—</td>
      <td style="padding:10px 16px;border-bottom:1px solid #dcfce7;text-align:right;color:#15803d;font-size:13px">—</td>
      <td style="padding:10px 16px;border-bottom:1px solid #dcfce7;text-align:right;font-weight:600;color:#16a34a;font-size:13px">${fmt(li.total)}</td>
    </tr>`).join('')

  const planSection = planItems.length > 0 ? `
    <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:16px;margin-bottom:24px;">
      <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.06em;">Continuing Service Plans</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${planItems.map(p => `
          <tr>
            <td style="font-size:13px;color:#78350f;padding:5px 0;">✓ ${p.description}</td>
            <td style="font-size:13px;color:#92400e;font-weight:600;text-align:right;padding:5px 0;">${fmt(p.unit_price)}/${p.billing_cycle || 'mo'}</td>
          </tr>`).join('')}
      </table>
    </div>` : ''

  const warrantySection = warrantyDetails ? `
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px;margin-bottom:24px;">
      <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:0.06em;">Remaining Warranty Coverage</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${warrantyDetails.parts_end_date ? `<tr><td style="font-size:13px;color:#0c4a6e;padding:4px 0;">Parts Warranty</td><td style="text-align:right;font-size:13px;font-weight:600;color:#0369a1;padding:4px 0;">Until ${fmtDate(warrantyDetails.parts_end_date)}</td></tr>` : ''}
        ${warrantyDetails.labor_end_date ? `<tr><td style="font-size:13px;color:#0c4a6e;padding:4px 0;">Labor Warranty</td><td style="text-align:right;font-size:13px;font-weight:600;color:#0369a1;padding:4px 0;">Until ${fmtDate(warrantyDetails.labor_end_date)}</td></tr>` : ''}
      </table>
      <p style="margin:10px 0 0;font-size:12px;color:#0369a1;">Warranty transfers with the equipment upon buyout completion.</p>
    </div>` : ''

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">

  <!-- Header -->
  <tr><td style="background:#0f1e2e;padding:32px;text-align:center;">
    <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">Zenith Pure Solutions</h1>
    <p style="color:#7fb3d0;margin:6px 0 0;font-size:13px;">Clean Water. Pure Simple.</p>
  </td></tr>

  <!-- Hero banner -->
  <tr><td style="background:linear-gradient(135deg,#0ea5e9,#0369a1);padding:24px 32px;text-align:center;">
    <p style="margin:0;font-size:13px;font-weight:700;color:#bae6fd;text-transform:uppercase;letter-spacing:0.1em;">Equipment Buyout Invoice</p>
    <p style="margin:8px 0 0;font-size:28px;font-weight:800;color:#ffffff;">${invoice.invoice_number}</p>
    <p style="margin:6px 0 0;font-size:13px;color:#bae6fd;">Make this equipment yours</p>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:32px;">

    <h2 style="color:#0f1e2e;margin:0 0 8px;font-size:18px;">Hi ${invoice.customer_name || 'Valued Customer'},</h2>
    <p style="color:#475569;font-size:14px;margin:0 0 24px;line-height:1.6;">
      Your buyout invoice for <strong>${systemName || 'your water system'}</strong> is ready.
      Once payment is received, the equipment transfers to your ownership and your rental agreement is complete.
    </p>

    <!-- Invoice reference -->
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:13px;color:#64748b;padding:3px 0;">Invoice #</td>
          <td style="text-align:right;font-size:13px;font-weight:700;color:#0f172a;font-family:monospace;padding:3px 0;">${invoice.invoice_number}</td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#64748b;padding:3px 0;">Contract</td>
          <td style="text-align:right;font-size:13px;font-weight:600;color:#0f172a;padding:3px 0;">${invoice.reference_number || '—'}</td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#64748b;padding:3px 0;">Payment Terms</td>
          <td style="text-align:right;font-size:13px;color:#0f172a;padding:3px 0;">Due upon receipt</td>
        </tr>
      </table>
    </div>

    <!-- Line items -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="padding:10px 16px;text-align:left;font-size:11px;color:#94a3b8;font-weight:700;border-bottom:2px solid #e2e8f0;text-transform:uppercase;">Description</th>
          <th style="padding:10px 16px;text-align:center;font-size:11px;color:#94a3b8;font-weight:700;border-bottom:2px solid #e2e8f0;text-transform:uppercase;">Qty</th>
          <th style="padding:10px 16px;text-align:right;font-size:11px;color:#94a3b8;font-weight:700;border-bottom:2px solid #e2e8f0;text-transform:uppercase;">Unit Price</th>
          <th style="padding:10px 16px;text-align:right;font-size:11px;color:#94a3b8;font-weight:700;border-bottom:2px solid #e2e8f0;text-transform:uppercase;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${productRows}
        ${creditRows}
      </tbody>
    </table>

    <!-- Totals -->
    <div style="background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:28px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="color:#64748b;font-size:14px;padding:4px 0;">Credits Applied</td>
          <td style="text-align:right;font-weight:600;color:#16a34a;font-size:14px;padding:4px 0;">${fmt(creditItems.reduce((s, li) => s + Number(li.total), 0))}</td>
        </tr>
        <tr style="border-top:2px solid #e2e8f0;">
          <td style="font-size:18px;font-weight:700;color:#0f1e2e;padding-top:10px;">Balance Due</td>
          <td style="text-align:right;font-size:24px;font-weight:800;color:#0ea5e9;padding-top:10px;">${fmt(total)}</td>
        </tr>
      </table>
    </div>

    ${warrantySection}
    ${planSection}

    <!-- Payment button -->
    <div style="text-align:center;margin-bottom:28px;">
      <a href="${paymentLinkUrl}" style="display:inline-block;background:#0ea5e9;color:#ffffff;text-decoration:none;padding:18px 48px;border-radius:12px;font-size:17px;font-weight:700;">
        Pay ${fmt(total)} &rarr;
      </a>
      <p style="margin:12px 0 0;font-size:12px;color:#94a3b8;">Secure payment powered by Stripe</p>
    </div>

    <!-- What happens next -->
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;margin-bottom:24px;">
      <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#15803d;">What happens after payment:</p>
      <table cellpadding="0" cellspacing="0">
        <tr><td style="font-size:13px;color:#166534;padding:3px 0;">✓&nbsp;</td><td style="font-size:13px;color:#166534;padding:3px 0;">Your rental agreement is marked complete</td></tr>
        <tr><td style="font-size:13px;color:#166534;padding:3px 0;">✓&nbsp;</td><td style="font-size:13px;color:#166534;padding:3px 0;">Equipment ownership transfers to you</td></tr>
        <tr><td style="font-size:13px;color:#166534;padding:3px 0;">✓&nbsp;</td><td style="font-size:13px;color:#166534;padding:3px 0;">Remaining warranty coverage continues</td></tr>
        <tr><td style="font-size:13px;color:#166534;padding:3px 0;">✓&nbsp;</td><td style="font-size:13px;color:#166534;padding:3px 0;">You receive a paid invoice confirmation</td></tr>
      </table>
    </div>

    <!-- Questions -->
    <div style="background:#fff8ed;border:1px solid #fed7aa;border-radius:10px;padding:16px;margin-bottom:20px;">
      <p style="margin:0;color:#92400e;font-size:14px;font-weight:600;">Questions about your buyout?</p>
      <p style="margin:6px 0 0;color:#b45309;font-size:13px;">Reply to this email or call <strong>(317) 690-4172</strong> — ${senderName} will get back to you.</p>
    </div>

    <!-- Terms link -->
    <p style="text-align:center;margin:0;font-size:12px;color:#94a3b8;">
      By completing this payment you agree to our
      <a href="${termsUrl}" style="color:#0ea5e9;text-decoration:underline;">Terms &amp; Conditions</a>.
    </p>

  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#94a3b8;">Zenith Pure Solutions LLC &middot; 6951 E 30th St, Suite B &middot; Indianapolis, IN 46219</p>
    <p style="margin:4px 0 0;font-size:12px;color:#94a3b8;">info@zenithpuresolutions.com &middot; (317) 690-4172</p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { invoiceId, senderEmail, senderName, paymentLinkUrl, warrantyDetails, systemName } = req.body
  if (!invoiceId) return res.status(400).json({ error: 'invoiceId required' })

  const fromEmail = senderEmail || `invoices@${DOMAIN}`
  const fromName  = senderName  || 'Zenith Pure Solutions'

  try {
    // Load invoice
    const { data: invoice } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .single()

    if (!invoice) return res.status(404).json({ error: 'Invoice not found' })
    if (!invoice.customer_email) return res.status(400).json({ error: 'Customer has no email on invoice' })

    const link = paymentLinkUrl || invoice.stripe_invoice_id // fallback if already stored

    await sendViaResend(
      invoice.customer_email,
      `Buyout Invoice ${invoice.invoice_number} — Zenith Pure Solutions`,
      buyoutHtml({ invoice, paymentLinkUrl: link, senderName: fromName, warrantyDetails, systemName }),
      fromEmail,
      fromName,
    )

    // Update sent_at
    await supabase.from('invoices').update({
      sent_at: new Date().toISOString(),
      status: 'sent',
    }).eq('id', invoiceId)

    // Log to email_log
    await supabase.from('email_log').insert({
      customer_id:  invoice.customer_id,
      email_type:   'buyout_invoice',
      to_address:   invoice.customer_email,
      subject:      `Buyout Invoice ${invoice.invoice_number} — Zenith Pure Solutions`,
      status:       'sent',
      document_id:  invoiceId,
      sent_at:      new Date().toISOString(),
      created_at:   new Date().toISOString(),
    }).then(() => {}).catch(() => {})

    return res.status(200).json({ ok: true, to: invoice.customer_email })

  } catch (err) {
    console.error('send-buyout error:', err)
    return res.status(500).json({ error: err.message })
  }
}
