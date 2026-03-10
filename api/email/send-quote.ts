// api/email/send-quote.ts
import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const RESEND_KEY = process.env.RESEND_API_KEY!
const DOMAIN     = process.env.RESEND_DOMAIN || 'zenithpuresolutions.com'
const APP_URL    = process.env.VITE_APP_URL  || 'https://zenith-crm-ten.vercel.app'

const fmt     = (n: number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n)
const fmtDate = (s: string|null) => s ? new Date(s).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : '—'

async function sendViaResend(to: string, subject: string, html: string, fromEmail: string, fromName: string) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, reply_to: fromEmail, to: [to], subject, html }),
  })
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`)
}

function quoteHtml(quote: any, customer: any, items: any[], senderName: string) {
  const total = parseFloat(quote.total)||0
  const tax   = parseFloat(quote.tax_amount)||0
  const sub   = parseFloat(quote.subtotal)||0
  const acceptUrl = `${APP_URL}/quotes/accept/${quote.accept_token}`
  const rows = items.map(li=>`<tr>
    <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;color:#334155">${li.description}</td>
    <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:center;color:#64748b">${li.quantity}</td>
    <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:right;color:#64748b">${fmt(parseFloat(li.unit_price))}</td>
    <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;color:#0f172a">${fmt(parseFloat(li.total))}</td>
  </tr>`).join('')

  return `<!DOCTYPE html><html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07)">
    <div style="background:#0f1e2e;padding:32px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:22px">Zenith Pure Solutions</h1>
      <p style="color:#7fb3d0;margin:6px 0 0;font-size:13px">Clean Water. Pure Simple.</p>
    </div>
    <div style="padding:32px">
      <h2 style="color:#0f1e2e;margin:0 0 16px">Your Quote is Ready, ${customer.full_name||''}</h2>
      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:20px;margin-bottom:24px">
        <p style="margin:0;font-size:11px;color:#0ea5e9;font-weight:600;text-transform:uppercase">Quote Number</p>
        <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#0f1e2e;font-family:monospace">${quote.quote_number}</p>
        <p style="margin:8px 0 0;font-size:12px;color:#dc2626;font-weight:600">Valid until ${fmtDate(quote.valid_until)}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <thead><tr style="background:#f8fafc">
          <th style="padding:10px 16px;text-align:left;font-size:11px;color:#94a3b8;border-bottom:2px solid #e2e8f0">Item</th>
          <th style="padding:10px 16px;text-align:center;font-size:11px;color:#94a3b8;border-bottom:2px solid #e2e8f0">Qty</th>
          <th style="padding:10px 16px;text-align:right;font-size:11px;color:#94a3b8;border-bottom:2px solid #e2e8f0">Unit</th>
          <th style="padding:10px 16px;text-align:right;font-size:11px;color:#94a3b8;border-bottom:2px solid #e2e8f0">Total</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:28px">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:#64748b">Subtotal</span><span style="font-weight:600">${fmt(sub)}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:10px"><span style="color:#64748b">Tax (7% Indiana)</span><span style="font-weight:600">${fmt(tax)}</span></div>
        <div style="display:flex;justify-content:space-between;padding-top:10px;border-top:2px solid #e2e8f0">
          <span style="font-size:18px;font-weight:700;color:#0f1e2e">Total</span>
          <span style="font-size:22px;font-weight:700;color:#0f1e2e">${fmt(total)}</span>
        </div>
      </div>
      <div style="text-align:center;margin-bottom:28px">
        <a href="${acceptUrl}" style="display:inline-block;background:#0ea5e9;color:#fff;text-decoration:none;padding:16px 40px;border-radius:12px;font-size:16px;font-weight:700">
          Review &amp; Accept Quote &rarr;
        </a>
      </div>
      <div style="background:#fff8ed;border:1px solid #fed7aa;border-radius:10px;padding:16px">
        <p style="margin:0;color:#92400e;font-size:14px;font-weight:600">Questions?</p>
        <p style="margin:6px 0 0;color:#b45309;font-size:13px">Reply directly to this email — ${senderName} will get back to you.</p>
      </div>
    </div>
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px;text-align:center">
      <p style="margin:0;font-size:12px;color:#94a3b8">Zenith Pure Solutions LLC &middot; Indianapolis, IN</p>
    </div>
  </div>
</body></html>`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const { quoteId, senderEmail, senderName } = req.body
  if (!quoteId) return res.status(400).json({ error: 'quoteId required' })

  const fromEmail = senderEmail || `quotes@${DOMAIN}`
  const fromName  = senderName  || 'Zenith Pure Solutions'

  try {
    const { data: quote } = await supabase.from('quotes').select('*,quote_line_items(*)').eq('id',quoteId).single()
    if (!quote) return res.status(404).json({ error: 'Quote not found' })

    const { data: customer } = await supabase.from('customers').select('full_name,email').eq('id',quote.customer_id).single()
    if (!customer?.email) return res.status(400).json({ error: 'Customer has no email' })

    await sendViaResend(
      customer.email,
      `Your Quote from ${fromName} — ${quote.quote_number}`,
      quoteHtml(quote, customer, quote.quote_line_items||[], fromName),
      fromEmail, fromName,
    )

    await supabase.from('quotes').update({ status:'sent', sent_at: new Date().toISOString() }).eq('id',quoteId)
    await supabase.from('document_audit_log').insert({
      entity_type:'quote', entity_id:quoteId, event:'sent', actor_type:'staff',
      metadata:{ email:customer.email, sent_by:fromEmail },
    })

    return res.status(200).json({ ok:true, to:customer.email, from:fromEmail })
  } catch(err:any) {
    console.error(err)
    return res.status(500).json({ error:err.message })
  }
}
