// api/email/send-quote.ts
import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const RESEND_KEY = process.env.RESEND_API_KEY!
const DOMAIN     = process.env.RESEND_DOMAIN || 'zenithpuresolutions.com'
const APP_URL    = process.env.VITE_APP_URL  || 'https://zenith-crm-ten.vercel.app'
const OPENPHONE_KEY = process.env.OPENPHONE_API_KEY || ''
const OPENPHONE_NUM = process.env.OPENPHONE_NUMBER  || '+14633005100'

const fmt     = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'

async function sendViaResend(to: string, subject: string, html: string, fromEmail: string, fromName: string) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, reply_to: fromEmail, to: [to], subject, html }),
  })
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`)
}

// ── SMS: fire-and-forget via OpenPhone ────────────────────────────
async function sendSms(to: string, message: string, customerId: string) {
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
    await supabase.from('communications_log').insert({
      entity_type: 'customer', entity_id: customerId, customer_id: customerId,
      direction: 'outbound', channel: 'sms', body: message,
      status: resp.ok ? 'sent' : 'failed',
      external_id: data?.data?.id || null,
      created_at: new Date().toISOString(),
    })
  } catch (e: any) { console.error('[send-quote] sendSms error:', e.message) }
}

function quoteHtml(quote: any, customer: any, items: any[], senderName: string) {
  const total = parseFloat(quote.total) || 0
  const tax   = parseFloat(quote.tax_amount) || 0
  const sub   = parseFloat(quote.subtotal) || 0
  const reviewUrl = `${APP_URL}/q/${quote.public_token || quote.accept_token}`

  const displayItems = items.filter((li: any) => li.item_type !== 'service_plan')
  const rows = displayItems.map((li: any) => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;color:#334155;font-size:14px">${li.description || '—'}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:center;color:#64748b;font-size:14px">${li.quantity || 1}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:right;color:#64748b;font-size:14px">${fmt(parseFloat(li.unit_price) || 0)}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;color:#0f172a;font-size:14px">${fmt(parseFloat(li.total) || 0)}</td>
    </tr>`).join('')

  const emptyRow = displayItems.length === 0
    ? `<tr><td colspan="4" style="padding:20px 16px;text-align:center;color:#94a3b8;font-size:13px">No line items</td></tr>`
    : ''

  const planItems = items.filter((li: any) => li.item_type === 'service_plan')
  const planSection = planItems.length > 0 ? `
    <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:16px;margin-bottom:24px">
      <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.06em">Included Service Plans</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${planItems.map((p: any) => `
          <tr>
            <td style="font-size:13px;color:#78350f;padding:4px 0">${p.description}</td>
            <td style="font-size:13px;color:#92400e;font-weight:600;text-align:right;padding:4px 0">${fmt(parseFloat(p.unit_price) || 0)}/${p.billing_cycle || 'mo'}</td>
          </tr>`).join('')}
      </table>
    </div>` : ''

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">

  <tr><td style="background:#0f1e2e;padding:32px;text-align:center;">
    <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">Zenith Pure Solutions</h1>
    <p style="color:#7fb3d0;margin:6px 0 0;font-size:13px;">Clean Water. Pure Simple.</p>
  </td></tr>

  <tr><td style="padding:32px;">

    <h2 style="color:#0f1e2e;margin:0 0 16px;font-size:20px;">Your Quote is Ready, ${customer.full_name || ''}</h2>

    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:20px;margin-bottom:24px;">
      <p style="margin:0;font-size:11px;color:#0ea5e9;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Quote Number</p>
      <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#0f1e2e;font-family:monospace;">${quote.quote_number}</p>
      <p style="margin:8px 0 0;font-size:12px;color:#dc2626;font-weight:600;">Valid until ${fmtDate(quote.valid_until)}</p>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="padding:10px 16px;text-align:left;font-size:11px;color:#94a3b8;font-weight:700;border-bottom:2px solid #e2e8f0;text-transform:uppercase;">Item</th>
          <th style="padding:10px 16px;text-align:center;font-size:11px;color:#94a3b8;font-weight:700;border-bottom:2px solid #e2e8f0;text-transform:uppercase;">Qty</th>
          <th style="padding:10px 16px;text-align:right;font-size:11px;color:#94a3b8;font-weight:700;border-bottom:2px solid #e2e8f0;text-transform:uppercase;">Unit</th>
          <th style="padding:10px 16px;text-align:right;font-size:11px;color:#94a3b8;font-weight:700;border-bottom:2px solid #e2e8f0;text-transform:uppercase;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        ${emptyRow}
      </tbody>
    </table>

    <div style="background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:28px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="color:#64748b;font-size:14px;padding:4px 0;">Subtotal</td>
          <td style="text-align:right;font-weight:600;color:#0f172a;font-size:14px;padding:4px 0;">${fmt(sub)}</td>
        </tr>
        <tr>
          <td style="color:#64748b;font-size:14px;padding:4px 0 10px;">Tax (7% Indiana)</td>
          <td style="text-align:right;font-weight:600;color:#0f172a;font-size:14px;padding:4px 0 10px;">${fmt(tax)}</td>
        </tr>
        <tr style="border-top:2px solid #e2e8f0;">
          <td style="font-size:18px;font-weight:700;color:#0f1e2e;padding-top:10px;">Total</td>
          <td style="text-align:right;font-size:22px;font-weight:700;color:#0f1e2e;padding-top:10px;">${fmt(total)}</td>
        </tr>
      </table>
    </div>

    ${planSection}

    <div style="text-align:center;margin-bottom:28px;">
      <a href="${reviewUrl}" style="display:inline-block;background:#0ea5e9;color:#ffffff;text-decoration:none;padding:16px 40px;border-radius:12px;font-size:16px;font-weight:700;">
        Review &amp; Accept Quote &rarr;
      </a>
    </div>

    <div style="background:#fff8ed;border:1px solid #fed7aa;border-radius:10px;padding:16px;">
      <p style="margin:0;color:#92400e;font-size:14px;font-weight:600;">Questions?</p>
      <p style="margin:6px 0 0;color:#b45309;font-size:13px;">Reply directly to this email — ${senderName} will get back to you.</p>
    </div>

  </td></tr>

  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#94a3b8;">Zenith Pure Solutions LLC &middot; 6951 E 30th St, Suite B &middot; Indianapolis, IN 46219</p>
    <p style="margin:4px 0 0;font-size:12px;color:#94a3b8;">info@zenithpuresolutions.com &middot; (317) 690-4172</p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const { quoteId, senderEmail, senderName } = req.body
  if (!quoteId) return res.status(400).json({ error: 'quoteId required' })

  const fromEmail = senderEmail || `quotes@${DOMAIN}`
  const fromName  = senderName  || 'Zenith Pure Solutions'

  try {
    const { data: quote } = await supabase
      .from('quotes').select('*').eq('id', quoteId).single()
    if (!quote) return res.status(404).json({ error: 'Quote not found' })

    const { data: customer } = await supabase
      .from('customers').select('full_name, email, phone, lead_id').eq('id', quote.customer_id).single()
    if (!customer?.email) return res.status(400).json({ error: 'Customer has no email' })

    // ── DND check — block all comms if lead is DND ───────────────
    const leadId = quote.lead_id || customer.lead_id
    if (leadId) {
      const { data: lead } = await supabase
        .from('leads').select('stage, full_name').eq('id', leadId).single()
      if (lead?.stage === 'dnd') {
        console.warn(`[send-quote] Blocked — lead is DND: ${lead.full_name}`)
        return res.status(403).json({
          error: 'Cannot send quote — this contact is marked Do Not Disturb.',
          lead_name: lead.full_name,
        })
      }
    }

    let { data: lineItems } = await supabase
      .from('document_line_items')
      .select('*')
      .eq('document_id', quoteId)
      .order('sort_order')

    if (!lineItems || lineItems.length === 0) {
      const { data: legacy } = await supabase
        .from('quote_line_items')
        .select('*')
        .eq('quote_id', quoteId)
        .order('sort_order')
      lineItems = legacy || []
    }

    await sendViaResend(
      customer.email,
      `Your Quote from ${fromName} — ${quote.quote_number}`,
      quoteHtml(quote, customer, lineItems, fromName),
      fromEmail,
      fromName,
    )

    const updates: any = {
      status: 'sent',
      sent_at: new Date().toISOString(),
    }
    if (!quote.accept_token) updates.accept_token = crypto.randomUUID()
    if (!quote.public_token) updates.public_token = updates.accept_token || quote.accept_token

    await supabase.from('quotes').update(updates).eq('id', quoteId)

    await supabase.from('document_audit_log').insert({
      entity_type: 'quote', entity_id: quoteId, event: 'sent', actor_type: 'staff',
      metadata: { email: customer.email, sent_by: fromEmail },
    })

    await supabase.from('email_log').insert({
      customer_id: quote.customer_id,
      email_type: 'quote_sent',
      to_address: customer.email,
      subject: `Your Quote from ${fromName} — ${quote.quote_number}`,
      status: 'sent',
      sent_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    })

    // ── SMS: Quote sent notification (fire-and-forget) ────────────
try {
  if (customer.phone) {
    const firstName   = (customer.full_name || 'there').split(' ')[0]
    const publicToken = updates.public_token || quote.public_token || updates.accept_token || quote.accept_token
    const quoteUrl    = `${APP_URL}/q/${publicToken}`
    fetch(`${APP_URL}/api/openphone/send-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: customer.phone,
        body: `Hi ${firstName}, your quote from Zenith Pure Solutions is ready! Review it here: ${quoteUrl}`,
        entity_type: 'customer',
        entity_id: quote.customer_id,
      }),
    }).catch(() => {})
  }
} catch (_) { /* fire-and-forget */ }

    // ── GAP 14: Auto-create follow-up 2 days after quote sent ────
    try {
      const followUpDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
      await supabase.from('follow_up_tasks').insert({
        entity_type: 'customer',
        entity_id: quote.customer_id,
        title: `Follow up on quote: ${customer.full_name} — ${quote.quote_number}`,
        description: `Quote ${quote.quote_number} was sent on ${new Date().toLocaleDateString()}. Follow up to check interest.`,
        due_date: followUpDate.toISOString().split('T')[0],
        status: 'pending',
        priority: 'normal',
      })
    } catch (_) { /* fire-and-forget */ }

    return res.status(200).json({ ok: true, to: customer.email, from: fromEmail })
  } catch (err: any) {
    console.error(err)
    return res.status(500).json({ error: err.message })
  }
}
