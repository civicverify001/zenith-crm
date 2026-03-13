// api/google/sync-event.js
// Creates, updates, or deletes a Google Calendar event
// Called when a job or site visit is scheduled/changed/cancelled
//
// POST body: { entity_type: 'job' | 'site_visit', entity_id: string, action: 'upsert' | 'delete' }

import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET

// ── Token refresh ─────────────────────────────────────────────────
async function getValidAccessToken(conn) {
  const expiry = conn.token_expiry ? new Date(conn.token_expiry) : new Date(0)
  const isExpired = expiry.getTime() < Date.now() + 60_000 // refresh 1 min early

  if (!isExpired) return conn.access_token

  // Refresh
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: conn.refresh_token,
      grant_type:    'refresh_token',
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Token refresh failed: ${data.error}`)

  const newExpiry = new Date(Date.now() + data.expires_in * 1000).toISOString()

  // Update stored token
  await supabaseAdmin.from('google_calendar_connections').update({
    access_token: data.access_token,
    token_expiry: newExpiry,
    updated_at:   new Date().toISOString(),
  }).eq('user_id', conn.user_id)

  return data.access_token
}

// ── Resolve question UUIDs → human-readable labels ────────────────
// Queries qualifying_questions or site_visit_questions
// Returns: { [uuid]: "Question label text" }
async function buildQuestionLabelMap(tableName) {
  const { data, error } = await supabaseAdmin
    .from(tableName)
    .select('id, question')
  if (error || !data) return {}
  return data.reduce((map, row) => {
    map[row.id] = row.question || row.id
    return map
  }, {})
}

// Format { uuid: answer } JSONB into readable bullet lines using label map
// Skips empty/false values and photo URLs
function formatAnswersWithLabels(answersObj, labelMap) {
  if (!answersObj || typeof answersObj !== 'object') return []
  return Object.entries(answersObj)
    .filter(([, v]) => {
      if (v === null || v === undefined || v === '' || v === false) return false
      if (typeof v === 'string' && v.startsWith('http')) return false // skip photo URLs
      return true
    })
    .map(([id, val]) => {
      const label = labelMap[id] || id // fallback to UUID only if question was deleted
      const display = typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val)
      return `• ${label}: ${display}`
    })
}

// ── Build event for a JOB (install) ──────────────────────────────
async function buildJobEvent(job) {
  // Fetch full customer
  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('full_name, phone, email, service_address')
    .eq('id', job.customer_id)
    .maybeSingle()

  // Fetch products from quote line items
  let products = []
  if (job.source_quote_id) {
    const { data: lines } = await supabaseAdmin
      .from('quote_line_items')
      .select('description, quantity, unit_price')
      .eq('quote_id', job.source_quote_id)
    products = lines || []
  }

  // Fetch lead notes + answers
  let leadNotes = ''
  let qualifyingAnswers = {}
  let siteVisitAnswers = {}
  if (job.lead_id) {
    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('notes, qualifying_answers, site_visit_answers')
      .eq('id', job.lead_id)
      .maybeSingle()
    if (lead) {
      leadNotes = lead.notes || ''
      qualifyingAnswers = lead.qualifying_answers || {}
      siteVisitAnswers = lead.site_visit_answers || {}
    }
  }

  // Fetch install fee from contract
  let installFee = null
  if (job.customer_id) {
    const { data: contract } = await supabaseAdmin
      .from('contracts')
      .select('monthly_amount')
      .eq('customer_id', job.customer_id)
      .eq('status', 'active')
      .maybeSingle()
    installFee = contract?.monthly_amount || null
  }

  // Resolve question labels (parallel — no extra latency)
  const [qualifyingLabelMap, siteVisitLabelMap] = await Promise.all([
    buildQuestionLabelMap('qualifying_questions'),
    buildQuestionLabelMap('site_visit_questions'),
  ])

  const customerName = customer?.full_name || job.customer_name_snapshot || 'Customer'
  const address = customer?.service_address || job.service_address_snapshot || ''
  const phone   = customer?.phone || ''
  const email   = customer?.email || ''
  const mapsUrl = address ? `https://maps.google.com/?q=${encodeURIComponent(address)}` : null
  const crmUrl  = `https://zenith-crm-ten.vercel.app/installations/${job.id}`
  const custUrl = job.customer_id ? `https://zenith-crm-ten.vercel.app/customers/${job.customer_id}` : null

  // Build description
  const lines = [
    `🔧 INSTALLATION — ${customerName}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    '',
    `📍 ADDRESS`,
    address || '—',
    mapsUrl ? `📌 ${mapsUrl}` : '',
    '',
    `📞 PHONE`,
    phone || '—',
    email ? `📧 ${email}` : '',
    '',
  ]

  if (products.length > 0) {
    lines.push(`💧 PRODUCTS TO INSTALL`)
    for (const p of products) {
      lines.push(`• ${p.description}${p.quantity > 1 ? ` (x${p.quantity})` : ''}`)
    }
    lines.push('')
  }

  if (installFee) {
    lines.push(`💰 INSTALL FEE`)
    lines.push(`$${Number(installFee).toFixed(2)} — collect on site`)
    lines.push('')
  }

  if (leadNotes) {
    lines.push(`📋 LEAD NOTES`)
    lines.push(leadNotes)
    lines.push('')
  }

  // Qualifying answers — resolved labels
  const qaLines = formatAnswersWithLabels(qualifyingAnswers, qualifyingLabelMap)
  if (qaLines.length > 0) {
    lines.push(`✅ QUALIFYING INFO`)
    lines.push(...qaLines)
    lines.push('')
  }

  // Site visit answers — resolved labels
  const svLines = formatAnswersWithLabels(siteVisitAnswers, siteVisitLabelMap)
  if (svLines.length > 0) {
    lines.push(`🏠 SITE VISIT NOTES`)
    lines.push(...svLines)
    lines.push('')
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  lines.push(`🔗 Open Install: ${crmUrl}`)
  if (custUrl) lines.push(`👤 Customer Profile: ${custUrl}`)
  lines.push(``)
  lines.push(`Zenith Pure Solutions CRM`)

  // Event date/time — jobs store scheduled_date as DATE
  const dateStr = job.scheduled_date // 'YYYY-MM-DD'
  const start = { date: dateStr }     // all-day by default
  const end   = { date: dateStr }

  return {
    summary:  `🔧 Install — ${customerName}`,
    location: address,
    description: lines.filter(l => l !== null).join('\n'),
    start,
    end,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
        { method: 'popup', minutes: 15 },
        { method: 'email', minutes: 1440 }, // 1 day before
      ],
    },
  }
}

// ── Build event for a SITE VISIT ──────────────────────────────────
async function buildSiteVisitEvent(visit) {
  // Fetch lead
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('full_name, phone, email, address, city, state, zip, notes, qualifying_answers, site_visit_answers, source, water_concern')
    .eq('id', visit.lead_id)
    .maybeSingle()

  if (!lead) return null

  // Resolve question labels (parallel)
  const [qualifyingLabelMap, siteVisitLabelMap] = await Promise.all([
    buildQuestionLabelMap('qualifying_questions'),
    buildQuestionLabelMap('site_visit_questions'),
  ])

  const address = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')
  const mapsUrl = address ? `https://maps.google.com/?q=${encodeURIComponent(address)}` : null
  const crmUrl  = `https://zenith-crm-ten.vercel.app/leads?lead=${visit.lead_id}`

  const timeStr = visit.visit_hour === 0 ? '12:00 AM'
    : visit.visit_hour < 12 ? `${visit.visit_hour}:00 AM`
    : visit.visit_hour === 12 ? '12:00 PM'
    : `${visit.visit_hour - 12}:00 PM`

  const lines = [
    `📍 SITE VISIT — ${lead.full_name}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    '',
    `🕐 TIME`,
    timeStr,
    '',
    `📞 PHONE`,
    lead.phone || '—',
    lead.email ? `📧 ${lead.email}` : '',
    '',
  ]

  if (address) {
    lines.push(`📍 ADDRESS`)
    lines.push(address)
    if (mapsUrl) lines.push(`📌 ${mapsUrl}`)
    lines.push('')
  }

  if (lead.water_concern) {
    lines.push(`💧 WATER CONCERN`)
    lines.push(lead.water_concern)
    lines.push('')
  }

  if (lead.notes) {
    lines.push(`📋 LEAD NOTES`)
    lines.push(lead.notes)
    lines.push('')
  }

  // Qualifying answers — resolved labels
  const qaLines = formatAnswersWithLabels(lead.qualifying_answers || {}, qualifyingLabelMap)
  if (qaLines.length > 0) {
    lines.push(`✅ QUALIFYING INFO`)
    lines.push(...qaLines)
    lines.push('')
  }

  // Site visit answers — resolved labels (photo URLs already filtered by formatAnswersWithLabels)
  const svLines = formatAnswersWithLabels(lead.site_visit_answers || {}, siteVisitLabelMap)
  if (svLines.length > 0) {
    lines.push(`🏠 SITE VISIT NOTES`)
    lines.push(...svLines)
    lines.push('')
  }

  if (lead.source) {
    lines.push(`📣 SOURCE`)
    lines.push(lead.source.replace(/_/g, ' '))
    lines.push('')
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  lines.push(`🔗 Open Lead: ${crmUrl}`)
  lines.push(``)
  lines.push(`Zenith Pure Solutions CRM`)

  // Time-specific event
  const dateStr = visit.visit_date // 'YYYY-MM-DD'
  const hourPad = String(visit.visit_hour).padStart(2, '0')
  const startISO = `${dateStr}T${hourPad}:00:00`
  const endHour  = String(visit.visit_hour + 1).padStart(2, '0')
  const endISO   = `${dateStr}T${endHour}:00:00`

  return {
    summary:  `📍 Site Visit — ${lead.full_name}`,
    location: address,
    description: lines.filter(l => l !== null).join('\n'),
    start: { dateTime: startISO, timeZone: 'America/Indiana/Indianapolis' },
    end:   { dateTime: endISO,   timeZone: 'America/Indiana/Indianapolis' },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
        { method: 'popup', minutes: 15 },
        { method: 'email', minutes: 1440 },
      ],
    },
  }
}

// ── Google Calendar API call ──────────────────────────────────────
async function upsertGoogleEvent({ accessToken, calendarId, eventData, existingEventId }) {
  const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
  const url     = existingEventId ? `${baseUrl}/${existingEventId}` : baseUrl
  const method  = existingEventId ? 'PUT' : 'POST'

  const res = await fetch(url, {
    method,
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(eventData),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(`Google API error: ${JSON.stringify(data)}`)
  return data
}

async function deleteGoogleEvent({ accessToken, calendarId, googleEventId }) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${googleEventId}`
  await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

// ── Find which users should receive this event ────────────────────
async function findTargetUsers(entityType, entity) {
  const userIds = []

  if (entityType === 'job') {
    // Always try the assigned technician
    if (entity.assigned_technician_id) userIds.push(entity.assigned_technician_id)
    // Also push to all admins
    const { data: adminUsers } = await supabaseAdmin.auth.admin.listUsers()
    for (const u of (adminUsers?.users || [])) {
      const role = u.user_metadata?.role || u.app_metadata?.role
      if (role === 'admin' && !userIds.includes(u.id)) userIds.push(u.id)
    }
  } else if (entityType === 'site_visit') {
    // Assigned rep
    if (entity.assigned_rep_id) userIds.push(entity.assigned_rep_id)
    // Admins
    const { data: adminUsers } = await supabaseAdmin.auth.admin.listUsers()
    for (const u of (adminUsers?.users || [])) {
      const role = u.user_metadata?.role || u.app_metadata?.role
      if (role === 'admin' && !userIds.includes(u.id)) userIds.push(u.id)
    }
  }

  return [...new Set(userIds)]
}

// ── Main handler ──────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { entity_type, entity_id, action = 'upsert' } = req.body

  if (!entity_type || !entity_id) {
    return res.status(400).json({ error: 'entity_type and entity_id required' })
  }

  try {
    // Fetch the entity
    let entity = null
    if (entity_type === 'job') {
      const { data } = await supabaseAdmin
        .from('jobs')
        .select('*')
        .eq('id', entity_id)
        .maybeSingle()
      entity = data
    } else if (entity_type === 'site_visit') {
      const { data } = await supabaseAdmin
        .from('site_visits')
        .select('*')
        .eq('id', entity_id)
        .maybeSingle()
      entity = data
    }

    if (!entity) return res.status(404).json({ error: 'Entity not found' })

    // Find target users
    const userIds = await findTargetUsers(entity_type, entity)
    if (userIds.length === 0) return res.status(200).json({ message: 'No connected users to sync' })

    // Get connected users with enabled sync
    const { data: connections } = await supabaseAdmin
      .from('google_calendar_connections')
      .select('*')
      .in('user_id', userIds)
      .eq('is_enabled', true)

    if (!connections || connections.length === 0) {
      return res.status(200).json({ message: 'No Google Calendar connections found for assigned users' })
    }

    // Build event data
    let eventData = null
    if (action === 'upsert') {
      eventData = entity_type === 'job'
        ? await buildJobEvent(entity)
        : await buildSiteVisitEvent(entity)
      if (!eventData) return res.status(200).json({ message: 'Could not build event — missing data' })
    }

    const results = []

    for (const conn of connections) {
      try {
        const accessToken = await getValidAccessToken(conn)

        // Check for existing event record
        const { data: existing } = await supabaseAdmin
          .from('google_calendar_events')
          .select('google_event_id')
          .eq('user_id', conn.user_id)
          .eq('entity_type', entity_type)
          .eq('entity_id', entity_id)
          .maybeSingle()

        if (action === 'delete') {
          if (existing?.google_event_id) {
            await deleteGoogleEvent({ accessToken, calendarId: conn.calendar_id, googleEventId: existing.google_event_id })
            await supabaseAdmin.from('google_calendar_events').delete()
              .eq('user_id', conn.user_id).eq('entity_type', entity_type).eq('entity_id', entity_id)
          }
          results.push({ user_id: conn.user_id, status: 'deleted' })
        } else {
          const gcalEvent = await upsertGoogleEvent({
            accessToken,
            calendarId: conn.calendar_id,
            eventData,
            existingEventId: existing?.google_event_id || null,
          })

          // Store/update the mapping
          await supabaseAdmin.from('google_calendar_events').upsert({
            user_id:        conn.user_id,
            entity_type,
            entity_id,
            google_event_id: gcalEvent.id,
            updated_at:     new Date().toISOString(),
          }, { onConflict: 'user_id,entity_type,entity_id' })

          results.push({ user_id: conn.user_id, status: 'synced', google_event_id: gcalEvent.id })
        }
      } catch (err) {
        console.error(`Sync failed for user ${conn.user_id}:`, err.message)
        results.push({ user_id: conn.user_id, status: 'error', error: err.message })
      }
    }

    return res.status(200).json({ success: true, results })

  } catch (err) {
    console.error('sync-event error:', err)
    return res.status(500).json({ error: err.message })
  }
}
