import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  const to = req.query.to || 'info@zenithpuresolutions.com'

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Zenith Pure Solutions <info@zenithpuresolutions.com>',
      to: [to],
      subject: 'Test — Payment received — $29.99',
      html: `<p>Hi Kuldeep,</p><p>This is a test receipt email from Zenith CRM. If you see this, Resend is working correctly.</p><p>Amount: $29.99 · Card ending 4242 · Contract RA-2026-0003</p>`,
    }),
  })

  const data = await r.json()
  return res.status(r.ok ? 200 : 400).json(data)
}
