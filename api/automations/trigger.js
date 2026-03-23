// api/automations/trigger.js
// Generic automation trigger endpoint
// Checks automation_settings.enabled before sending any SMS
// Called fire-and-forget from frontend on key events
// Usage: POST /api/automations/trigger
//   { key, to, variables, entity_type, entity_id }

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const APP_URL = process.env.VITE_APP_URL || 'https://zenith-crm-ten.vercel.app'

function applyTemplate(template, variables) {
  return template.replace(/{{(\w+)}}/g, (_, k) => variables[k] || '')
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { key, to, variables = {}, entity_type, entity_id } = req.body

  if (!key) return res.status(400).json({ error: 'key is required' })
  if (!to)  return res.status(400).json({ error: 'to (phone number) is required' })

  try {
    // ── 1. Load automation setting ─────────────────────────────
    const { data: setting, error: settingErr } = await supabase
      .from('automation_settings')
      .select('key, enabled, sms_template, channel')
      .eq('key', key)
      .single()

    if (settingErr || !setting) {
      console.warn(`[trigger] No automation setting found for key: ${key}`)
      return res.status(200).json({ skipped: true, reason: 'setting_not_found' })
    }

    // ── 2. Check enabled ───────────────────────────────────────
    if (!setting.enabled) {
      console.log(`[trigger] Automation disabled: ${key}`)
      return res.status(200).json({ skipped: true, reason: 'disabled' })
    }

    // ── 3. Check channel — only SMS supported here ─────────────
    if (setting.channel !== 'sms') {
      console.log(`[trigger] Non-SMS channel (${setting.channel}) for key: ${key} — skipping`)
      return res.status(200).json({ skipped: true, reason: 'non_sms_channel' })
    }

    // ── 4. Build message from template ────────────────────────
    if (!setting.sms_template) {
      console.warn(`[trigger] No SMS template for key: ${key}`)
      return res.status(200).json({ skipped: true, reason: 'no_template' })
    }

    const message = applyTemplate(setting.sms_template, variables)

    if (!message.trim()) {
      console.warn(`[trigger] Empty message after template apply for key: ${key}`)
      return res.status(200).json({ skipped: true, reason: 'empty_message' })
    }

    // ── 5. Send SMS via send-sms.js ────────────────────────────
    const sendRes = await fetch(`${APP_URL}/api/openphone/send-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to,
        body: message,
        entity_type: entity_type || 'unknown',
        entity_id: entity_id || null,
        metadata: { automation_key: key },
      }),
    })

    const sendData = await sendRes.json()

    if (!sendRes.ok) {
      console.error(`[trigger] SMS send failed for key ${key}:`, sendData.error || sendData.detail)
      return res.status(200).json({
        sent: false,
        key,
        reason: sendData.error || 'send_failed',
      })
    }

    console.log(`[trigger] SMS sent for key: ${key} → ${to}`)
    return res.status(200).json({
      sent: true,
      key,
      message_id: sendData.message_id || null,
    })

  } catch (err) {
    console.error(`[trigger] Error for key ${key}:`, err.message)
    // Always return 200 — callers are fire-and-forget
    return res.status(200).json({ sent: false, error: err.message })
  }
}
