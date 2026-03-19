// api/openphone/webhook.js
// Receives OpenPhone (Quo) webhook events for SMS
// Matches phone numbers to leads/customers and logs to communications_log
//
// Events handled:
//   message.received  — inbound SMS from customer/lead
//   message.delivered  — outbound SMS confirmation

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const config = { api: { bodyParser: false } }

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function verifySignature(rawBody, signatureHeader, signingKey) {
  if (!signatureHeader || !signingKey) return false
  try {
    const fields = signatureHeader.split(';')
    const timestamp = fields[2]
    const providedDigest = fields[3]
    const signedData = timestamp + '.' + rawBody.toString()
    const signingKeyBinary = Buffer.from(signingKey, 'base64')
    const computedDigest = crypto
      .createHmac('sha256', signingKeyBinary)
      .update(signedData)
      .digest('base64')
    return computedDigest === providedDigest
  } catch (e) {
    console.error('[openphone-webhook] Signature verification error:', e.message)
    return false
  }
}

function cleanPhone(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  if (digits.length === 10) return digits
  return digits
}

async function findEntityByPhone(phone) {
  const clean = cleanPhone(phone)
  if (!clean) return null

  // Try leads first (more likely to receive SMS)
  const { data: lead } = await supabase
    .from('leads')
    .select('id, full_name, stage, phone')
    .eq('phone', clean)
    .not('stage', 'in', '(won,lost)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lead) return { entity_type: 'lead', entity_id: lead.id, name: lead.full_name }

  // Try customers
  const { data: customer } = await supabase
    .from('customers')
    .select('id, full_name, phone')
    .eq('phone', clean)
    .limit(1)
    .maybeSingle()

  if (customer) return { entity_type: 'customer', entity_id: customer.id, name: customer.full_name }

  // Try won leads (converted)
  const { data: wonLead } = await supabase
    .from('leads')
    .select('id, full_name, phone')
    .eq('phone', clean)
    .eq('stage', 'won')
    .limit(1)
    .maybeSingle()

  if (wonLead) return { entity_type: 'lead', entity_id: wonLead.id, name: wonLead.full_name }

  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const rawBody = await getRawBody(req)
  const webhookSecret = process.env.OPENPHONE_WEBHOOK_SECRET

  // Verify signature
  const signature = req.headers['openphone-signature']
  if (webhookSecret && signature) {
    const valid = verifySignature(rawBody, signature, webhookSecret)
    if (!valid) {
      console.error('[openphone-webhook] Invalid signature')
      return res.status(401).json({ error: 'Invalid signature' })
    }
  }

  let event
  try {
    event = JSON.parse(rawBody.toString())
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' })
  }

  const eventType = event.type
  const data = event.data?.object

  if (!data) {
    return res.status(200).json({ received: true, skipped: 'no data object' })
  }

  console.log(`[openphone-webhook] Event: ${eventType}`, {
    id: data.id,
    direction: data.direction,
    from: data.from,
    to: data.to,
  })

  try {
    // ── Handle message events ──────────────────────────────────
    if (eventType === 'message.received' || eventType === 'message.delivered') {
      const direction = eventType === 'message.received' ? 'inbound' : 'outbound'
      const contactPhone = direction === 'inbound' ? data.from : data.to
      const body = data.body || data.text || ''

      // Find matching lead or customer by phone
      const entity = await findEntityByPhone(contactPhone)

      // Prevent duplicate logging (check external_id)
      if (data.id) {
        const { data: existing } = await supabase
          .from('communications_log')
          .select('id')
          .eq('external_id', data.id)
          .limit(1)
          .maybeSingle()

        if (existing) {
          console.log('[openphone-webhook] Duplicate event, skipping:', data.id)
          return res.status(200).json({ received: true, duplicate: true })
        }
      }

      // Insert into communications_log
      const { error: insertErr } = await supabase.from('communications_log').insert({
        entity_type: entity?.entity_type || 'unknown',
        entity_id: entity?.entity_id || null,
        direction,
        channel: 'sms',
        from_number: cleanPhone(data.from) || data.from,
        to_number: cleanPhone(data.to) || data.to,
        body,
        status: eventType === 'message.delivered' ? 'delivered' : 'received',
        external_id: data.id || null,
        metadata: {
          openphone_event: eventType,
          phone_number_id: data.phoneNumberId || null,
          user_id: data.userId || null,
          media: data.media || null,
          created_at_openphone: data.createdAt || null,
        },
      })

      if (insertErr) {
        console.error('[openphone-webhook] Insert error:', insertErr.message)
      }

      // Also log to lead_activity_log or customer_activity_log for timeline
      if (entity) {
        const activityTable = entity.entity_type === 'lead' ? 'lead_activity_log' : 'customer_activity_log'
        const idField = entity.entity_type === 'lead' ? 'lead_id' : 'customer_id'

        const title = direction === 'inbound'
          ? `SMS received: "${body.slice(0, 80)}${body.length > 80 ? '...' : ''}"`
          : `SMS sent: "${body.slice(0, 80)}${body.length > 80 ? '...' : ''}"`

        await supabase.from(activityTable).insert({
          [idField]: entity.entity_id,
          event_type: direction === 'inbound' ? 'sms_received' : 'sms_sent',
          title,
          actor_name: direction === 'inbound' ? (entity.name || 'Customer') : 'Zenith (SMS)',
          metadata: {
            channel: 'sms',
            direction,
            from: data.from,
            to: data.to,
            body,
            external_id: data.id,
          },
        }).then(() => {}).catch(() => {})

        // For inbound SMS on leads: count as contact attempt (Gap 2 contact gate)
        if (direction === 'inbound' && entity.entity_type === 'lead') {
          await supabase.from('lead_activity_log').insert({
            lead_id: entity.entity_id,
            event_type: 'contact_attempt',
            title: 'Customer replied via SMS',
            actor_name: entity.name || 'Customer',
            metadata: { source: 'openphone_sms', direction: 'inbound' },
          }).then(() => {}).catch(() => {})
        }

        // ── Smart reply handling: CONFIRM / RESCHEDULE / STOP ────
        if (direction === 'inbound' && body && entity) {
          const upper = body.trim().toUpperCase()
          const today = new Date().toISOString().split('T')[0]

          if (upper === 'CONFIRM' || upper === 'YES' || upper === 'CONFIRMED') {
            const confirmTable = entity.entity_type === 'lead' ? 'lead_activity_log' : 'customer_activity_log'
            const confirmField = entity.entity_type === 'lead' ? 'lead_id' : 'customer_id'
            await supabase.from(confirmTable).insert({
              [confirmField]: entity.entity_id,
              event_type: 'appointment_confirmed',
              title: 'Appointment confirmed via SMS by ' + (entity.name || 'customer'),
              actor_name: entity.name || 'Customer',
              metadata: { source: 'sms_reply', reply_text: body },
            }).then(() => {}).catch(() => {})
            console.log('[openphone-webhook] CONFIRM received from ' + entity.name)
          }

          else if (upper === 'RESCHEDULE' || upper === 'CANCEL' || upper.includes('RESCHEDULE')) {
            await supabase.from('follow_up_tasks').insert({
              entity_type: entity.entity_type,
              entity_id: entity.entity_id,
              title: 'Reschedule requested via SMS: ' + (entity.name || 'Unknown'),
              description: 'Customer replied "' + body + '" to appointment reminder. Call to reschedule ASAP.',
              due_date: today,
              status: 'pending',
              priority: 'urgent',
            }).then(() => {}).catch(() => {})
            console.log('[openphone-webhook] RESCHEDULE requested by ' + entity.name)
          }

          else if (upper === 'STOP' || upper === 'UNSUBSCRIBE' || upper === 'OPT OUT') {
            if (entity.entity_type === 'lead') {
              await supabase.from('leads').update({
                stage: 'dnd',
                stage_changed_at: new Date().toISOString(),
              }).eq('id', entity.entity_id).then(() => {}).catch(() => {})
              await supabase.from('lead_activity_log').insert({
                lead_id: entity.entity_id,
                event_type: 'dnd_requested',
                title: 'DND requested via SMS — lead marked Do Not Disturb',
                actor_name: entity.name || 'Customer',
                metadata: { source: 'sms_reply', reply_text: body },
              }).then(() => {}).catch(() => {})
            } else if (entity.entity_type === 'customer') {
              await supabase.from('customers').update({
                sms_opt_in: false,
              }).eq('id', entity.entity_id).then(() => {}).catch(() => {})
              await supabase.from('customer_activity_log').insert({
                customer_id: entity.entity_id,
                event_type: 'sms_opt_out',
                title: 'SMS opt-out requested — customer replied STOP',
                actor_name: entity.name || 'Customer',
                metadata: { source: 'sms_reply', reply_text: body },
              }).then(() => {}).catch(() => {})
            }
            console.log('[openphone-webhook] STOP received from ' + entity.name + ' — marked DND')
          }

          else {
            // Smart time reply — check if message looks like a preferred time
            var timeMatch = body.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|morning|afternoon|evening|\d{1,2}\s*(am|pm|:\d{2}))\b/i)
            if (timeMatch) {
              await supabase.from('follow_up_tasks').insert({
                entity_type: entity.entity_type,
                entity_id: entity.entity_id,
                title: 'Customer suggested time: ' + (entity.name || 'Unknown'),
                description: 'Customer replied with preferred time: "' + body + '". Call to confirm and schedule.',
                due_date: today,
                status: 'pending',
                priority: 'high',
              }).then(() => {}).catch(() => {})
              console.log('[openphone-webhook] Time suggestion from ' + entity.name + ': ' + body)
            }
          }
        }
      }
      console.log(`[openphone-webhook] Logged ${direction} SMS ${entity ? `→ ${entity.entity_type} ${entity.name}` : '(unmatched)'}`)
    }

    return res.status(200).json({ received: true })

  } catch (err) {
    console.error('[openphone-webhook] Error:', err.message)
    return res.status(200).json({ received: true, warning: err.message })
  }
}
