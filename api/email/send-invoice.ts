// api/email/send-invoice.ts
import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const supabase   = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const RESEND_KEY = process.env.RESEND_API_KEY!
const DOMAIN     = process.env.RESEND_DOMAIN || 'zenithpuresolutions.com'

const fmt = (n: number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n)
const fmtDate = (s: string|null) => s ? new Date(s).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : '—'

async function sendViaResend(to: string, subject: string, html: string, fromEmail: string, fromName: string) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, reply_to: fromEmail, to: [to], subject, html }),
  })
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`)
}

function invoiceHtml(invoice: any, customer: any) {
  const total   = parseFloat(invoice.total)||0
  const paid    = parseFloat(invoice.amount_paid)||0
  const balance = Math.max(0,total-paid)
  const items   = invoice.line_items_snapshot||[]
  const rows = items.map((li:any)=>`<tr>
    <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;color:#334155">${li.description}</td>
    <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600">${fmt(parseFloat(li.total))}</td>
  </tr>`).join('')

  return `<!DOCTYPE html><html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07)">
    <div style="background:#0f1e2e;padding:32px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:22px">Zenith Pure Solutions</h1>
      <p style="color:#7fb3d0;margin:6px 0 0;font-size:13px">Invoice ${invoice.invoice_number}</p>
    </div>
    <div style="padding:32px">
      <p style="color:#475569;margin:0 0 20px">Hi ${customer.full_name||''}, your invoice is ready.</p>
      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:20px;margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><p style="margin:0;font-size:11px;color:#0ea5e9;font-weight:600">Amount Due</p><p style="margin:4px 0 0;font-size:26px;font-weight:700;color:#0f1e2e">${fmt(balance)}</p></div>
          <div style="text-align:right"><p style="margin:0;font-size:11px;color:#64748b">Due Date</p><p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#dc2626">${fmtDate(invoice.due_date)}</p></div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <thead><tr style="background:#f8fafc">
          <th style="padding:10px 16px;text-align:left;font-size:11px;color:#94a3b8;border-bottom:2px solid #e2e8f0">Description</th>
          <th style="padding:10px 16px;text-align:right;font-size:11px;color:#94a3b8;border-bottom:2px solid #e2e8f0">Amount</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:28px">
        <div style="display:flex;justify-content:space-between;padding-top:10px;border-top:2px solid #e2e8f0">
          <span style="font-size:18px;font-weight:700;color:#0f1e2e">Total Due</span>
          <span style="font-size:22px;font-weight:700;color:#0f1e2e">${fmt(balance)}</span>
        </div>
      </div>
      ${invoice.notes ? `<div style="background:#fff8ed;border:1px solid #fed7aa;border-radius:10px;padding:16px;margin-bottom:20px"><p style="margin:0;color:#92400e;font-size:13px">${invoice.notes}</p></div>` : ''}
    </div>
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px;text-align:center">
      <p style="margin:0;font-size:12px;color:#94a3b8">Zenith Pure Solutions LLC &middot; Indianapolis, IN</p>
    </div>
  </div>
</body></html>`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const { invoiceId, senderEmail, senderName } = req.body
  if (!invoiceId) return res.status(400).json({ error: 'invoiceId required' })

  const fromEmail = senderEmail || `billing@${DOMAIN}`
  const fromName  = senderName  || 'Zenith Pure Solutions'

  try {
    const { data: invoice } = await supabase.from('invoices').select('*').eq('id',invoiceId).single()
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' })
    const { data: customer } = await supabase.from('customers').select('full_name,email').eq('id',invoice.customer_id).single()
    if (!customer?.email) return res.status(400).json({ error: 'Customer has no email' })
    await sendViaResend(
      customer.email,
      `Invoice ${invoice.invoice_number} from ${fromName}`,
      invoiceHtml(invoice, customer),
      fromEmail, fromName,
    )
    await supabase.from('invoices').update({ status:'sent', sent_at: new Date().toISOString() }).eq('id',invoiceId)
    await supabase.from('document_audit_log').insert({
      entity_type:'invoice', entity_id:invoiceId, event:'sent', actor_type:'staff',
      metadata:{ email:customer.email, sent_by:fromEmail },
    })
    return res.status(200).json({ ok:true, to:customer.email, from:fromEmail })
  } catch(err:any) {
    console.error(err)
    return res.status(500).json({ error:err.message })
  }
}
