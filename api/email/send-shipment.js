// ============================================================
// ZENITH CRM OS — SHIPMENT NOTIFICATION EMAIL + SMS
// api/email/send-shipment.js
// Sends email + SMS when a shipment is marked as shipped
// ============================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY  = process.env.RESEND_API_KEY;
const OPENPHONE_KEY   = process.env.OPENPHONE_API_KEY || '';
const OPENPHONE_NUM   = process.env.OPENPHONE_NUMBER  || '+14633005100';
const FROM_EMAIL      = 'info@zenithpuresolutions.com';

// ── SMS: fire-and-forget via OpenPhone ────────────────────────────
async function sendSms(supabase, to, message, customerId) {
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
  } catch (e) { console.error('[send-shipment] sendSms error:', e.message) }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { shipment_id } = req.body;
  if (!shipment_id) return res.status(400).json({ error: 'shipment_id required' });

  if (!RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  if (!supabaseUrl || !supabaseServiceKey) return res.status(500).json({ error: 'Missing Supabase env vars' });

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // 1. Fetch shipment + customer + product
    const { data: shipment, error: shipErr } = await supabase
      .from('shipments')
      .select('*, customers!inner(full_name, email, phone), products(name)')
      .eq('id', shipment_id)
      .single();

    if (shipErr || !shipment) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    const customerEmail = shipment.customers?.email;
    const customerPhone = shipment.customers?.phone;

    if (!customerEmail && !customerPhone) {
      console.log(`[send-shipment] No contact info for customer on shipment ${shipment_id} — skipping`);
      return res.status(200).json({ success: true, skipped: true, reason: 'No customer contact info' });
    }

    // 2. Fetch brand settings
    const { data: brand } = await supabase.from('brand_settings').select('*').limit(1).single();
    const companyName = brand?.company_name || 'Zenith Pure Solutions';
    const companyPhone = brand?.phone || '(317) 555-1234';

    // 3. Fetch email template
    const { data: template } = await supabase
      .from('email_templates')
      .select('*')
      .eq('template_type', 'shipment_shipped')
      .eq('is_active', true)
      .limit(1)
      .single();

    const customerName = shipment.customers?.full_name || 'Valued Customer';
    const productName = shipment.products?.name || 'your order';
    const trackingNumber = shipment.tracking_number || '';
    const carrier = (shipment.carrier || 'FedEx').toUpperCase();
    const shipToCity = shipment.ship_to_city || '';
    const shipToState = shipment.ship_to_state || '';

    const trackingUrl = carrier === 'FEDEX'
      ? `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`
      : carrier === 'UPS'
        ? `https://www.ups.com/track?tracknum=${trackingNumber}`
        : carrier === 'USPS'
          ? `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`
          : '';

    const subject = template?.subject_override
      || `Your ${productName} has shipped! — ${companyName}`;

    const greeting = template?.greeting || `Hi ${customerName},`;
    const bodyText = template?.body_text
      || `Great news! Your ${productName} has been shipped and is on its way to you.`;

    // 4. Build HTML email
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#0d7ea3,#0891b2);padding:28px 32px;text-align:center;">
    <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.02em;">${companyName}</div>
    <div style="color:rgba(255,255,255,0.8);font-size:12px;margin-top:4px;">Indianapolis, IN</div>
  </td></tr>

  <!-- Shipped banner -->
  <tr><td style="background:#ecfdf5;padding:20px 32px;text-align:center;border-bottom:1px solid #d1fae5;">
    <div style="font-size:28px;margin-bottom:6px;">📦</div>
    <div style="color:#059669;font-size:18px;font-weight:700;">Your Order Has Shipped!</div>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:28px 32px;">
    <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 16px;">${greeting}</p>
    <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 20px;">${bodyText}</p>

    <!-- Shipment details card -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:20px;">
      <tr><td style="padding:16px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;padding:4px 0;">Item</td>
            <td style="color:#1e293b;font-size:14px;font-weight:600;text-align:right;padding:4px 0;">${productName}</td>
          </tr>
          <tr>
            <td style="color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;padding:4px 0;">Carrier</td>
            <td style="color:#1e293b;font-size:14px;font-weight:600;text-align:right;padding:4px 0;">${carrier}</td>
          </tr>
          ${trackingNumber ? `
          <tr>
            <td style="color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;padding:4px 0;">Tracking #</td>
            <td style="color:#0d7ea3;font-size:14px;font-weight:600;text-align:right;padding:4px 0;font-family:monospace;">${trackingNumber}</td>
          </tr>
          ` : ''}
          ${shipToCity ? `
          <tr>
            <td style="color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;padding:4px 0;">Shipping to</td>
            <td style="color:#1e293b;font-size:14px;text-align:right;padding:4px 0;">${shipToCity}, ${shipToState}</td>
          </tr>
          ` : ''}
        </table>
      </td></tr>
    </table>

    ${trackingNumber && trackingUrl ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr><td align="center">
        <a href="${trackingUrl}" target="_blank"
          style="display:inline-block;background:#0d7ea3;color:#ffffff;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;text-decoration:none;">
          Track Your Package →
        </a>
      </td></tr>
    </table>
    ` : ''}

    <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0;">
      If you have any questions about your shipment, please don't hesitate to reach out at <strong>${companyPhone}</strong>.
    </p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center;">
    <div style="color:#94a3b8;font-size:11px;">${companyName} · Indianapolis, IN</div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

    // 5. Send email via Resend (if customer has email)
    let emailSent = false;
    if (customerEmail) {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: `${companyName} <${FROM_EMAIL}>`,
          to: customerEmail,
          subject,
          html,
        }),
      });

      const emailData = await emailRes.json();
      emailSent = emailRes.ok;

      // 6. Log email to email_log
      try {
        await supabase.from('email_log').insert({
          customer_id: shipment.customer_id,
          email_type: 'shipment_shipped',
          to_address: customerEmail,
          subject,
          template_used: 'shipment_shipped',
          status: emailRes.ok ? 'sent' : 'failed',
          external_id: emailData.id || null,
          sent_at: emailRes.ok ? new Date().toISOString() : null,
        });
      } catch (logErr) {
        console.error('[send-shipment] email_log error:', logErr);
      }

      if (!emailRes.ok) {
        console.error('[send-shipment] Resend error:', emailData);
      } else {
        console.log(`[send-shipment] Email sent to ${customerEmail} for shipment ${shipment_id}`);
      }
    }

    // 7. SMS: Shipment notification (fire-and-forget)
    if (customerPhone) {
      const firstName  = (customerName).split(' ')[0]
      const smsMsg     = trackingNumber
        ? `Hi ${firstName}, your ${productName} has shipped via ${carrier}! Tracking: ${trackingNumber}${trackingUrl ? ` — ${trackingUrl}` : ''} — Zenith Pure Solutions`
        : `Hi ${firstName}, your ${productName} has shipped via ${carrier} and is on its way! — Zenith Pure Solutions`
      await sendSms(supabase, customerPhone, smsMsg, shipment.customer_id)
      console.log(`[send-shipment] SMS sent to ${customerPhone} for shipment ${shipment_id}`)
    }

    return res.status(200).json({
      success: true,
      email_sent: emailSent,
      sms_sent: !!customerPhone,
    });

  } catch (err) {
    console.error('[send-shipment] error:', err);
    return res.status(500).json({ error: 'Failed to send shipment notification', detail: err.message });
  }
}
