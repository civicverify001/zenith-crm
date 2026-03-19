// api/openphone/send-sms.js
// Sends SMS via OpenPhone (Quo) API
// Called from CRM UI — Send SMS button on lead/customer pages
//
// POST body: { to, body, entity_type, entity_id, sent_by }
// - to: phone number (10 digits or +1XXXXXXXXXX)
// - body: message text
// - entity_type: 'lead' or 'customer'
// - entity_id: UUID of the lead or customer
// - sent_by: UUID of the CRM user sending

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const OPENPHONE_API_KEY = process.env.OPENPHONE_API_KEY
const OPENPHONE_NUMBER = process.env.OPENPHONE_NUMBER || '+14633005100'

function formatPhone(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
  if (digits.startsWith('+')) return phone
  return '+1' + digits
}

function cleanPhone(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  if (digits.length === 10) return digits
  return digits
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { to, body, entity_type, entity_id, sent_by } = req.body

  if (!to) return res.status(400).json({ error: 'to (phone number) is required' })
  if (!body) return res.status(400).json({ error: 'body (message text) is required' })

  const toFormatted = formatPhone(to)
  if (!toFormatted) return res.status(400).json({ error: 'Invalid phone number' })

  // ── DND Check: block SMS to DND leads ────────────────────────
  if (entity_type === 'lead' && entity_id) {
    const { data: lead } = await supabase
      .from('leads')
      .select('stage, full_name')
      .eq('id', entity_id)
      .single()

    if (lead?.stage === 'dnd') {
      return res.status(403).json({
        error: 'Cannot send SMS — this lead is marked Do Not Disturb',
        lead_name: lead.full_name,
      })
    }
  }

  // ── Send via OpenPhone API ───────────────────────────────────
  try {
    // First, get the phone number ID for our OpenPhone number
    const phoneNumbersRes = await fetch('https://api.openphone.com/v1/phone-numbers', {
      headers: { 'Authorization': OPENPHONE_API_KEY },
    })

    if (!phoneNumbersRes.ok) {
      const errText = await phoneNumbersRes.text()
      console.error('[send-sms] Failed to fetch phone numbers:', errText)
      return res.status(500).json({ error: 'Failed to connect to OpenPhone', detail: errText })
    }

    const phoneNumbers = await phoneNumbersRes.json()
    const opDigits = OPENPHONE_NUMBER.replace(/\D/g, '')
    const ourNumber = (phoneNumbers.data || []).find(pn => {
      const pnDigits = (pn.formattedNumber || pn.number || pn.phoneNumber || '').replace(/\D/g, '')
      return pnDigits === opDigits || pnDigits.endsWith(opDigits) || opDigits.endsWith(pnDigits)
    })

    if (!ourNumber) {
      console.error('[send-sms] Phone number not found. Looking for:', opDigits, 'Available:', JSON.stringify((phoneNumbers.data || []).map((p: any) => ({ id: p.id, num: p.formattedNumber || p.number || p.phoneNumber }))))
      return res.status(500).json({ error: 'OpenPhone number not found in account' })
    }
    // Send the message
    const sendRes = await fetch('https://api.openphone.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': OPENPHONE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: ourNumber.id,
        to: [toFormatted],
        content: body,
      }),
    })

    const sendData = await sendRes.json()

    if (!sendRes.ok) {
      console.error('[send-sms] OpenPhone API error:', JSON.stringify(sendData))
      return res.status(sendRes.status).json({
        error: 'Failed to send SMS',
        detail: sendData.message || sendData.error || 'Unknown error',
      })
    }

    const messageId = sendData.data?.id || sendData.id || null

    // ── Log to communications_log ────────────────────────────────
    await supabase.from('communications_log').insert({
      entity_type: entity_type || 'unknown',
      entity_id: entity_id || null,
      direction: 'outbound',
      channel: 'sms',
      from_number: cleanPhone(OPENPHONE_NUMBER),
      to_number: cleanPhone(to),
      body,
      status: 'sent',
      external_id: messageId,
      sent_by: sent_by || null,
      metadata: {
        source: 'crm_send_button',
        openphone_response: sendData.data || null,
      },
    }).then(() => {}).catch(err => {
      console.error('[send-sms] Log insert error:', err.message)
    })

    // ── Log to activity timeline ─────────────────────────────────
    if (entity_type && entity_id) {
      const activityTable = entity_type === 'lead' ? 'lead_activity_log' : 'customer_activity_log'
      const idField = entity_type === 'lead' ? 'lead_id' : 'customer_id'

      await supabase.from(activityTable).insert({
        [idField]: entity_id,
        event_type: 'sms_sent',
        title: `SMS sent: "${body.slice(0, 80)}${body.length > 80 ? '...' : ''}"`,
        actor_id: sent_by || null,
        actor_name: 'Zenith (SMS)',
        metadata: { channel: 'sms', direction: 'outbound', to: toFormatted, body, external_id: messageId },
      }).then(() => {}).catch(() => {})

      // Count as contact attempt for leads (contact gate)
      if (entity_type === 'lead') {
        await supabase.from('lead_activity_log').insert({
          lead_id: entity_id,
          event_type: 'contact_attempt',
          title: 'SMS sent to lead',
          actor_id: sent_by || null,
          actor_name: 'Zenith Rep',
          metadata: { source: 'openphone_sms', direction: 'outbound' },
        }).then(() => {}).catch(() => {})
      }
    }

    console.log('[send-sms] Sent successfully:', { to: toFormatted, messageId, entity_type, entity_id })

    return res.status(200).json({
      success: true,
      message_id: messageId,
      to: toFormatted,
    })

  } catch (err) {
    console.error('[send-sms] Error:', err.message)
    return res.status(500).json({ error: 'Internal server error', message: err.message })
  }
}
