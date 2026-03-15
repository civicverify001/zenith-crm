// api/test-email.js
// TEMPORARY — delete after testing

export default async function handler(req, res) {
  const to = req.query.to || 'info@zenithpuresolutions.com'

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#f3f4f6;font-family:system-ui,-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td style="background:#0a2540;padding:28px 32px;text-align:center;">
    <div style="display:inline-block;width:40px;height:40px;background:#0d7ea3;border-radius:10px;line-height:40px;text-align:center;font-weight:700;font-size:18px;color:white;">Z</div>
    <p style="color:white;font-weight:600;font-size:15px;margin:10px 0 2px;">Zenith Pure Solutions</p>
    <p style="color:#93c5fd;font-size:12px;margin:0;">Indianapolis, IN · (317) 690-4172</p>
  </td></tr>
  <tr><td style="background:#f0fdf4;border-bottom:1px solid #bbf7d0;padding:20px 32px;text-align:center;">
    <div style="width:36px;height:36px;background:#dcfce7;border-radius:50%;display:inline-block;line-height:36px;font-size:20px;margin-bottom:8px;">✓</div>
    <p style="color:#15803d;font-weight:600;font-size:16px;margin:0;">Payment received</p>
    <p style="color:#16a34a;font-size:13px;margin:4px 0 0;">Your autopay was processed successfully</p>
  </td></tr>
  <tr><td style="padding:28px 32px;">
    <p style="font-size:14px;color:#374151;margin:0 0 20px;">Hi Kuldeep,</p>
    <p style="font-size:14px;color:#374151;margin:0 0 24px;line-height:1.6;">This is a test receipt email from Zenith CRM. If you're reading this, Resend is fully working. Here's what a real receipt looks like:</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;padding:16px 20px;">
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Amount charged</td><td style="text-align:right;font-weight:700;color:#111827;padding:6px 0;font-size:15px;">$29.99</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Description</td><td style="text-align:right;font-weight:600;color:#111827;padding:6px 0;font-size:13px;">Monthly rental — Contract RA-2026-0003</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Payment method</td><td style="text-align:right;font-weight:600;color:#111827;padding:6px 0;font-size:13px;">Card ending 4242</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0;font-size:13px;">Date</td><td style="text-align:right;font-weight:600;color:#111827;padding:6px 0;font-size:13px;">March 15, 2026</td></tr>
      <tr style="border-top:1px solid #e5e7eb;"><td style="color:#6b7280;padding:10px 0 6px;font-size:13px;">Next payment</td><td style="text-align:right;font-weight:600;color:#111827;padding:10px 0 6px;font-size:13px;">April 15, 2026</td></tr>
    </table>
    <p style="font-size:13px;color:#6b7280;margin:20px 0 0;line-height:1.6;">Questions? Reply to this email or call <a href="tel:3176904172" style="color:#0d7ea3;">(317) 690-4172</a>.</p>
  </td></tr>
  <tr><td style="border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
    <p style="font-size:11px;color:#9ca3af;margin:0;">Zenith Pure Solutions LLC · 6951 E 30th St, Suite B · Indianapolis, IN 46219</p>
    <p style="font-size:11px;color:#9ca3af;margin:4px 0 0;">info@zenithpuresolutions.com · zenithpuresolutions.com</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Zenith Pure Solutions <info@zenithpuresolutions.com>',
      to: [to],
      subject: 'Test — Payment received — $29.99 — Zenith Pure Solutions',
      html,
    }),
  })

  const data = await r.json()
  return res.status(r.ok ? 200 : 400).json({
    success: r.ok,
    sent_to: to,
    resend_id: data?.id || null,
    error: data?.message || null,
  })
}
