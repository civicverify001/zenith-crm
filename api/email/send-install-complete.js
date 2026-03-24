// api/email/send-install-complete.js
// Sends branded install completion email to customer after job is marked complete.
// Called fire-and-forget from api/installations/complete.js
// Logs to email_log table.

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const RESEND_KEY = process.env.RESEND_API_KEY
const DOMAIN     = process.env.RESEND_DOMAIN || 'zenithpuresolutions.com'

function installCompleteHtml({ customerName, productName, ownershipType, activatedPlans }) {
  const isRental = ownershipType === 'rented'
  const firstName = (customerName || 'Valued Customer').split(' ')[0]
  const planRows = (activatedPlans || []).map(name => `
    <tr>
      <td style="padding:6px 0;font-size:13px;color:#374151;">✓ ${name}</td>
    </tr>
  `).join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:system-ui,-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">

  <!-- Header -->
  <tr><td style="background:#0a2540;padding:28px 32px;text-align:center;">
    <div style="display:inline-block;width:44px;height:44px;background:#0d7ea3;border-radius:12px;line-height:44px;text-align:center;font-weight:900;font-size:20px;color:white;">Z</div>
    <p style="color:white;font-weight:700;font-size:16px;margin:10px 0 2px;">Zenith Pure Solutions</p>
    <p style="color:#93c5fd;font-size:12px;margin:0;">Indianapolis, IN · (317) 690-4172</p>
  </td></tr>

  <!-- Hero banner -->
  <tr><td style="background:#f0fdf4;border-bottom:1px solid #bbf7d0;padding:24px 32px;text-align:center;">
    <div style="font-size:40px;margin-bottom:8px;">💧</div>
    <p style="color:#15803d;font-weight:700;font-size:18px;margin:0;">Installation Complete!</p>
    <p style="color:#16a34a;font-size:13px;margin:6px 0 0;">Your new water system is up and running</p>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:28px 32px;">
    <p style="font-size:14px;color:#374151;margin:0 0 16px;">Hi ${firstName},</p>
    <p style="font-size:14px;color:#374151;margin:0 0 20px;line-height:1.7;">
      Your Zenith water system has been successfully installed and is ready to use.
      Welcome to the Zenith family — you're now enjoying cleaner, better water throughout your home.
    </p>

    <!-- System info card -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:10px;padding:18px 20px;margin-bottom:20px;">
      <tr>
        <td style="color:#6b7280;padding:5px 0;font-size:13px;font-weight:600;">System Installed</td>
        <td style="text-align:right;font-weight:700;color:#111827;padding:5px 0;font-size:13px;">${productName || 'Water Treatment System'}</td>
      </tr>
      <tr>
        <td style="color:#6b7280;padding:5px 0;font-size:13px;font-weight:600;">Ownership</td>
        <td style="text-align:right;font-weight:600;color:#111827;padding:5px 0;font-size:13px;">${isRental ? 'Rental Agreement' : 'Purchased'}</td>
      </tr>
      <tr>
        <td style="color:#6b7280;padding:5px 0;font-size:13px;font-weight:600;">Install Date</td>
        <td style="text-align:right;font-weight:600;color:#111827;padding:5px 0;font-size:13px;">${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</td>
      </tr>
      ${isRental ? `
      <tr>
        <td style="color:#6b7280;padding:5px 0;font-size:13px;font-weight:600;">First Autopay</td>
        <td style="text-align:right;font-weight:600;color:#16a34a;padding:5px 0;font-size:13px;">Begins today</td>
      </tr>` : ''}
    </table>

    ${activatedPlans && activatedPlans.length > 0 ? `
    <!-- Service plans -->
    <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
      <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.06em;">Active Service Plans</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${planRows}
      </table>
      <p style="margin:10px 0 0;font-size:11px;color:#b45309;">Your service plans are now active. We'll be in touch when service is due.</p>
    </div>` : ''}

    <!-- What's next -->
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#1d4ed8;">What happens next?</p>
      <p style="margin:0 0 6px;font-size:13px;color:#1e40af;">• Your system is ready to use immediately</p>
      ${isRental ? '<p style="margin:0 0 6px;font-size:13px;color:#1e40af;">• Monthly autopay begins on your billing date</p>' : ''}
      <p style="margin:0 0 6px;font-size:13px;color:#1e40af;">• We'll schedule any required maintenance automatically</p>
      <p style="margin:0;font-size:13px;color:#1e40af;">• Call or text us anytime with questions</p>
    </div>

    <p style="font-size:14px;color:#374151;margin:0;line-height:1.7;">
      Questions about your system? Call us at
      <a href="tel:3176904172" style="color:#0d7ea3;font-weight:600;">(317) 690-4172</a>
      or reply to this email. We're always happy to help.
    </p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
    <p style="font-size:11px;color:#9ca3af;margin:0;">Zenith Pure Solutions LLC · 6951 E 30th St, Suite B · Indianapolis, IN 46219</p>
    <p style="font-size:11px;color:#9ca3af;margin:4px 0 0;">info@zenithpuresolutions.com · zenithpuresolutions.com</p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { customerId, jobId, productName, ownershipType, activatedPlans } = req.body
  if (!customerId) return res.status(400).json({ error: 'customerId required' })

  try {
    // Load customer
    const { data: customer, error: custErr } = await supabase
      .from('customers')
      .select('full_name, email, phone')
      .eq('id', customerId)
      .single()

    if (custErr || !customer?.email) {
      console.log('[send-install-complete] No email for customer', customerId)
      return res.status(200).json({ ok: true, skipped: true, reason: 'No email address' })
    }

    const subject = `Your Zenith water system is installed! 💧`
    const html = installCompleteHtml({
      customerName: customer.full_name,
      productName:  productName || 'Water Treatment System',
      ownershipType: ownershipType || 'purchased',
      activatedPlans: activatedPlans || [],
    })

    const now = new Date().toISOString()

    // Send via Resend
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Zenith Pure Solutions <info@${DOMAIN}>`,
        to: [customer.email],
        subject,
        html,
      }),
    })

    const data = await r.json()
    const sent = r.ok

    // Log to email_log
    await supabase.from('email_log').insert({
      customer_id:   customerId,
      email_type:    'install_complete',
      to_address:    customer.email,
      subject,
      status:        sent ? 'sent' : 'failed',
      external_id:   data?.id || null,
      sent_at:       sent ? now : null,
      created_at:    now,
    }).then(() => {}).catch(() => {})

    console.log(`[send-install-complete] ${sent ? '✓ Sent' : '✗ Failed'} to ${customer.email} for job ${jobId}`)

    return res.status(200).json({ ok: true, sent, to: customer.email })

  } catch (err) {
    console.error('[send-install-complete] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
