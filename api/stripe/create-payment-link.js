// api/stripe/create-payment-link.js
// Creates a Stripe Payment Link for manual/ad-hoc invoices
// Sends link via SMS (OpenPhone) + email (Resend)
// Logs invoice to Supabase invoices table

import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe    = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' })
const supabase  = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const OPENPHONE_KEY = process.env.OPENPHONE_API_KEY || ''
const OPENPHONE_NUM = process.env.OPENPHONE_NUMBER  || '+14633005100'
const RESEND_KEY    = process.env.RESEND_API_KEY    || ''
const APP_URL       = process.env.VITE_APP_URL      || 'https://zenith-crm-ten.vercel.app'

function generateInvoiceNumber() {
  const year = new Date().getFullYear()
  const rand = String(Math.floor(Math.random() * 9000) + 1000)
  return `INV-${year}-${rand}`
}

async function sendSms(to, message, customerId) {
  if (!OPENPHONE_KEY || !to) return
  try {
    const digits = to.replace(/\D/g, '')
    const e164   = digits.length === 10 ? `+1${digits}` : `+${digits}`
    const resp   = await fetch('https://api.openphone.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': OPENPHONE_KEY },
      body: JSON.stringify({ content: message, from: OPENPHONE_NUM, to: [e164] }),
    })
    const data = await resp.json()
    if (customerId) {
      await supabase.from('communications_log').insert({
        entity_type: 'customer', entity_id: customerId, customer_id: customerId,
        direction: 'outbound', channel: 'sms', body: message,
        status: resp.ok ? 'sent' : 'failed',
        external_id: data?.data?.id || null,
        created_at: new Date().toISOString(),
      }).then(() => {}).catch(() => {})
    }
  } catch (e) { console.error('[create-payment-link] sendSms error:', e.message) }
}

async function sendInvoiceEmail({ to, recipientName, invoiceNumber, total, paymentLink, lineItems, notes, customerId }) {
  if (!RESEND_KEY || !to) return
  const rows = lineItems.map(l =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#334155;font-size:14px">${l.description}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:center;color:#64748b;font-size:14px">${l.qty}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;color:#64748b;font-size:14px">$${Number(l.unit_price).toFixed(2)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;color:#0f172a;font-size:14px">$${(l.qty * l.unit_price).toFixed(2)}</td>
    </tr>`
  ).join('')

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr><td style="background:#0f1e2e;padding:28px 32px;text-align:center;">
    <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:700;">Zenith Pure Solutions</h1>
    <p style="color:#7fb3d0;margin:4px 0 0;font-size:12px;">Invoice — Action Required</p>
  </td></tr>
  <tr><td style="padding:28px 32px;">
    <h2 style="color:#0f1e2e;margin:0 0 8px;font-size:18px;">Hi ${recipientName},</h2>
    <p style="color:#475569;font-size:14px;margin:0 0 20px;line-height:1.6;">Please find your invoice below. Click the button to pay securely online.</p>
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:14px 18px;margin-bottom:20px;">
      <span style="font-size:11px;color:#0ea5e9;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Invoice</span>
      <div style="font-size:20px;font-weight:800;color:#0f1e2e;font-family:monospace;">${invoiceNumber}</div>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;">
      <thead><tr style="background:#f8fafc;">
        <th style="padding:8px 12px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;border-bottom:2px solid #e2e8f0;text-transform:uppercase;">Item</th>
        <th style="padding:8px 12px;text-align:center;font-size:10px;color:#94a3b8;font-weight:700;border-bottom:2px solid #e2e8f0;text-transform:uppercase;">Qty</th>
        <th style="padding:8px 12px;text-align:right;font-size:10px;color:#94a3b8;font-weight:700;border-bottom:2px solid #e2e8f0;text-transform:uppercase;">Unit</th>
        <th style="padding:8px 12px;text-align:right;font-size:10px;color:#94a3b8;font-weight:700;border-bottom:2px solid #e2e8f0;text-transform:uppercase;">Total</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:24px;text-align:right;">
      <span style="font-size:18px;font-weight:800;color:#0f1e2e;">Total: $${total}</span>
    </div>
    ${notes ? `<p style="color:#64748b;font-size:13px;margin:0 0 20px;padding:12px;background:#f8fafc;border-radius:8px;">${notes}</p>` : ''}
    <div style="text-align:center;">
      <a href="${paymentLink}" style="display:inline-block;background:#0d7ea3;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:15px;font-weight:700;">
        Pay Now →
      </a>
    </div>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#94a3b8;">Zenith Pure Solutions LLC · 6951 E 30th St, Suite B · Indianapolis, IN 46219</p>
    <p style="margin:4px 0 0;font-size:11px;color:#94a3b8;">info@zenithpuresolutions.com · (317) 690-4172</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Zenith Pure Solutions <info@zenithpuresolutions.com>',
        to: [to],
        subject: `Invoice ${invoiceNumber} — $${total} — Zenith Pure Solutions`,
        html,
      }),
    })
    const data = await res.json()
    if (customerId) {
      await supabase.from('email_log').insert({
        customer_id: customerId,
        email_type: 'invoice_sent',
        to_address: to,
        subject: `Invoice ${invoiceNumber} — $${total} — Zenith Pure Solutions`,
        status: res.ok ? 'sent' : 'failed',
        external_id: data?.id || null,
        sent_at: res.ok ? new Date().toISOString() : null,
        created_at: new Date().toISOString(),
      }).then(() => {}).catch(() => {})
    }
  } catch (e) { console.error('[create-payment-link] sendInvoiceEmail error:', e.message) }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const {
    customer_id,
    recipient_name,
    recipient_phone,
    recipient_email,
    line_items,
    notes,
  } = req.body

  if (!line_items?.length)   return res.status(400).json({ error: 'line_items required' })
  if (!recipient_name)       return res.status(400).json({ error: 'recipient_name required' })
  if (!recipient_phone && !recipient_email) return res.status(400).json({ error: 'phone or email required' })

  // ── Filter out empty/placeholder line items ───────────────────
  const validItems = line_items.filter(l => {
    const desc = (l.description || '').trim()
    return desc && desc !== 'Item description' && Number(l.unit_price) > 0
  })
  if (!validItems.length) {
    return res.status(400).json({ error: 'Add at least one item with a description and price greater than $0' })
  }

  try {
    // ── 1. Build Stripe line items ───────────────────────────────
    const stripePriceData = validItems.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: { name: item.description.trim() },
        unit_amount: Math.round(Number(item.unit_price) * 100),
      },
      quantity: Math.max(1, parseInt(item.qty) || 1),
    }))

    // ── 2. Create Stripe Payment Link ────────────────────────────
    const paymentLink = await stripe.paymentLinks.create({
      line_items: stripePriceData,
      after_completion: { type: 'redirect', redirect: { url: `${APP_URL}/invoice/thank-you` } },
      metadata: {
        customer_id:    customer_id || '',
        recipient_name,
        source:         'quick_invoice',
      },
    })

    // ── 3. Calculate totals ──────────────────────────────────────
    const subtotal = validItems.reduce((s, l) => s + (Math.max(1, parseInt(l.qty) || 1)) * Number(l.unit_price), 0)
    const tax      = subtotal * 0.07
    const total    = (subtotal + tax).toFixed(2)
    const invoiceNumber = generateInvoiceNumber()

    // ── 4. Log invoice to Supabase ───────────────────────────────
    try {
      await supabase.from('invoices').insert({
        customer_id:            customer_id || null,
        invoice_number:         invoiceNumber,
        status:                 'sent',
        subtotal,
        tax_amount:             tax,
        total:                  parseFloat(total),
        notes:                  notes || null,
        payment_link:           paymentLink.url,
        stripe_payment_link_id: paymentLink.id,
        recipient_name,
        recipient_phone:        recipient_phone || null,
        recipient_email:        recipient_email || null,
        sent_at:                new Date().toISOString(),
        created_at:             new Date().toISOString(),
      })
    } catch (dbErr) {
      console.error('[create-payment-link] invoice insert error:', dbErr.message)
    }

    // ── 5. Send SMS (fire-and-forget) ────────────────────────────
    if (recipient_phone) {
      const firstName = recipient_name.split(' ')[0]
      await sendSms(
        recipient_phone,
        `Hi ${firstName}, Zenith Pure Solutions sent you invoice ${invoiceNumber} for $${total}. Pay here: ${paymentLink.url}`,
        customer_id || null
      )
    }

    // ── 6. Send email (fire-and-forget) ──────────────────────────
    if (recipient_email) {
      await sendInvoiceEmail({
        to:            recipient_email,
        recipientName: recipient_name,
        invoiceNumber,
        total,
        paymentLink:   paymentLink.url,
        lineItems:     validItems,
        notes:         notes || '',
        customerId:    customer_id || null,
      })
    }

    return res.status(200).json({
      ok:             true,
      payment_link:   paymentLink.url,
      invoice_number: invoiceNumber,
      total,
    })

  } catch (err) {
    console.error('[create-payment-link] error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
