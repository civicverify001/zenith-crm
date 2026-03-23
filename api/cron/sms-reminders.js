// api/cron/sms-reminders.js
// Vercel Cron — runs every 30 minutes
// Section 1a: Install 1hr reminders
// Section 1b: Install 24hr advance reminders
// Section 2a: Site visit 1hr reminders
// Section 2b: Site visit 24hr advance reminders
//
// All sends gated by automation_settings.enabled check
//
// vercel.json cron: { "path": "/api/cron/sms-reminders", "schedule": "*/30 * * * *" }

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const APP_URL = process.env.VITE_APP_URL || 'https://zenith-crm-ten.vercel.app'

// ── Automation settings cache (per request) ──────────────────────
let _settingsCache = null

async function getAutomationSettings() {
  if (_settingsCache) return _settingsCache
  const { data } = await supabase
    .from('automation_settings')
    .select('key, enabled, sms_template, timing_hours')
  _settingsCache = {}
  for (const row of (data || [])) {
    _settingsCache[row.key] = row
  }
  return _settingsCache
}

function isEnabled(settings, key) {
  return settings[key]?.enabled !== false
}

function getTemplate(settings, key, fallback) {
  return settings[key]?.sms_template || fallback
}

function applyTemplate(template, vars) {
  return template.replace(/{{(\w+)}}/g, (_, k) => vars[k] || '')
}

// ── Send SMS via internal endpoint ───────────────────────────────
async function sendSMS(to, body, entityType, entityId) {
  try {
    const res = await fetch(`${APP_URL}/api/openphone/send-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, body, entity_type: entityType, entity_id: entityId }),
    })
    const data = await res.json()
    if (!res.ok) {
      console.error('[sms-reminders] Send failed:', data.error || data.detail)
      return false
    }
    return true
  } catch (e) {
    console.error('[sms-reminders] Send error:', e.message)
    return false
  }
}

function formatHour(h) {
  if (h === 0) return '12:00 AM'
  if (h < 12) return h + ':00 AM'
  if (h === 12) return '12:00 PM'
  return (h - 12) + ':00 PM'
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

module.exports = async function handler(req, res) {
  const isCron = req.headers['x-vercel-cron'] === '1'
  const cronSecret = process.env.CRON_SECRET
  const isManual = cronSecret && req.headers.authorization === `Bearer ${cronSecret}`

  if (!isCron && !isManual) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const results = {
    installs_1hr_reminded: 0,
    installs_24hr_reminded: 0,
    visits_1hr_reminded: 0,
    visits_24hr_reminded: 0,
    errors: [],
  }

  // Load automation settings once for entire run
  const settings = await getAutomationSettings()

  try {
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]
    const currentHour = now.getHours()

    // Tomorrow's date string for 24hr checks
    const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const tomorrowStr = tomorrowDate.toISOString().split('T')[0]

    // Window boundaries for 1hr check (30-90 min from now)
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000)
    const reminderHour = oneHourFromNow.getHours()

    // Window boundaries for 24hr check (23-25 hrs from now)
    const twentyThreeHrs = new Date(now.getTime() + 23 * 60 * 60 * 1000)
    const twentyFiveHrs  = new Date(now.getTime() + 25 * 60 * 60 * 1000)

    // ══════════════════════════════════════════════════════════
    // SECTION 1a — INSTALL 1HR REMINDERS
    // ══════════════════════════════════════════════════════════

    if (isEnabled(settings, 'install_1hr_reminder')) {
      const { data: upcomingJobs } = await supabase
        .from('jobs')
        .select('id, customer_name_snapshot, phone_snapshot, scheduled_date, status, reminder_sent, lead_id')
        .eq('reminder_sent', false)
        .in('status', ['scheduled', 'ready_to_schedule'])
        .gte('scheduled_date', todayStr + 'T00:00:00')
        .lte('scheduled_date', todayStr + 'T23:59:59')

      for (const job of (upcomingJobs || [])) {
        try {
          const scheduledTime = new Date(job.scheduled_date)
          const timeDiffMinutes = (scheduledTime.getTime() - now.getTime()) / 60000

          if (timeDiffMinutes > 0 && timeDiffMinutes <= 90) {
            const phone = job.phone_snapshot
            if (!phone) { results.errors.push({ job_id: job.id, reason: 'No phone' }); continue }

            const timeStr = scheduledTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
            const name = (job.customer_name_snapshot || 'there').split(' ')[0]

            const template = getTemplate(settings, 'install_1hr_reminder',
              'Hi {{name}}, your Zenith water system installation is in about 1 hour at {{time}}. Our technician is on the way. Questions? Call (317) 690-4172.')
            const message = applyTemplate(template, { name, time: timeStr })

            const sent = await sendSMS(phone, message, 'lead', job.lead_id)
            if (sent) {
              await supabase.from('jobs').update({ reminder_sent: true }).eq('id', job.id)
              results.installs_1hr_reminded++
              console.log(`[sms-reminders] Install 1hr reminder sent: ${name} at ${timeStr}`)
            }
          }
        } catch (err) {
          results.errors.push({ job_id: job.id, section: '1a', reason: err.message })
        }
      }
    } else {
      console.log('[sms-reminders] install_1hr_reminder disabled — skipping')
    }

    // ══════════════════════════════════════════════════════════
    // SECTION 1b — INSTALL 24HR ADVANCE REMINDERS
    // Jobs scheduled tomorrow, not yet sent 24hr reminder
    // ══════════════════════════════════════════════════════════

    if (isEnabled(settings, 'install_24hr_reminder')) {
      const { data: tomorrowJobs } = await supabase
        .from('jobs')
        .select('id, customer_name_snapshot, phone_snapshot, scheduled_date, status, reminder_sent_24hr, lead_id')
        .eq('reminder_sent_24hr', false)
        .in('status', ['scheduled', 'ready_to_schedule'])
        .gte('scheduled_date', tomorrowStr + 'T00:00:00')
        .lte('scheduled_date', tomorrowStr + 'T23:59:59')

      for (const job of (tomorrowJobs || [])) {
        try {
          const scheduledTime = new Date(job.scheduled_date)
          const timeDiffMs = scheduledTime.getTime() - now.getTime()
          const timeDiffHrs = timeDiffMs / (60 * 60 * 1000)

          // Only send in 23-25hr window to avoid double-sends
          if (timeDiffHrs >= 23 && timeDiffHrs <= 25) {
            const phone = job.phone_snapshot
            if (!phone) { results.errors.push({ job_id: job.id, reason: 'No phone (24hr)' }); continue }

            const timeStr = scheduledTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
            const name = (job.customer_name_snapshot || 'there').split(' ')[0]
            const dateStr = formatDateShort(job.scheduled_date)

            const template = getTemplate(settings, 'install_24hr_reminder',
              'Hi {{name}}, reminder: your Zenith water system installation is tomorrow at {{time}}. Please ensure access to your water supply. Questions? Call (317) 690-4172.')
            const message = applyTemplate(template, { name, time: timeStr, date: dateStr })

            const sent = await sendSMS(phone, message, 'lead', job.lead_id)
            if (sent) {
              await supabase.from('jobs').update({ reminder_sent_24hr: true }).eq('id', job.id)
              results.installs_24hr_reminded++
              console.log(`[sms-reminders] Install 24hr reminder sent: ${name} for ${dateStr} at ${timeStr}`)
            }
          }
        } catch (err) {
          results.errors.push({ job_id: job.id, section: '1b', reason: err.message })
        }
      }
    } else {
      console.log('[sms-reminders] install_24hr_reminder disabled — skipping')
    }

    // ══════════════════════════════════════════════════════════
    // SECTION 2a — SITE VISIT 1HR REMINDERS
    // ══════════════════════════════════════════════════════════

    if (isEnabled(settings, 'consult_1hr_reminder')) {
      const { data: upcomingVisits } = await supabase
        .from('site_visits')
        .select('id, lead_id, visit_date, visit_hour, status, reminder_sent, assigned_rep_id')
        .eq('reminder_sent', false)
        .eq('visit_date', todayStr)
        .eq('status', 'scheduled')

      for (const visit of (upcomingVisits || [])) {
        try {
          const visitHour = visit.visit_hour
          if (visitHour >= currentHour && visitHour <= reminderHour) {
            if (!visit.lead_id) continue

            const { data: lead } = await supabase
              .from('leads')
              .select('id, full_name, phone, stage')
              .eq('id', visit.lead_id)
              .single()

            if (!lead?.phone) { results.errors.push({ visit_id: visit.id, reason: 'No lead phone' }); continue }
            if (lead.stage === 'dnd') continue

            const timeStr = formatHour(visitHour)
            const name = (lead.full_name || 'there').split(' ')[0]

            const template = getTemplate(settings, 'consult_1hr_reminder',
              'Hi {{name}}, your Zenith water consultation is in about 1 hour at {{time}}. Reply CONFIRM to confirm or call (317) 690-4172.')
            const message = applyTemplate(template, { name, time: timeStr })

            const sent = await sendSMS(lead.phone, message, 'lead', lead.id)
            if (sent) {
              await supabase.from('site_visits').update({ reminder_sent: true }).eq('id', visit.id)
              results.visits_1hr_reminded++
              console.log(`[sms-reminders] Visit 1hr reminder sent: ${lead.full_name} at ${timeStr}`)
            }
          }
        } catch (err) {
          results.errors.push({ visit_id: visit.id, section: '2a', reason: err.message })
        }
      }
    } else {
      console.log('[sms-reminders] consult_1hr_reminder disabled — skipping')
    }

    // ══════════════════════════════════════════════════════════
    // SECTION 2b — SITE VISIT 24HR ADVANCE REMINDERS
    // Visits scheduled tomorrow, not yet sent 24hr reminder
    // ══════════════════════════════════════════════════════════

    if (isEnabled(settings, 'consult_24hr_reminder')) {
      const { data: tomorrowVisits } = await supabase
        .from('site_visits')
        .select('id, lead_id, visit_date, visit_hour, status, reminder_sent_24hr')
        .eq('reminder_sent_24hr', false)
        .eq('visit_date', tomorrowStr)
        .eq('status', 'scheduled')

      for (const visit of (tomorrowVisits || [])) {
        try {
          if (!visit.lead_id) continue

          // Check if this visit hour falls within 23-25hr window
          const visitTime = new Date(tomorrowStr + 'T' + String(visit.visit_hour).padStart(2, '0') + ':00:00')
          const timeDiffHrs = (visitTime.getTime() - now.getTime()) / (60 * 60 * 1000)

          if (timeDiffHrs >= 23 && timeDiffHrs <= 25) {
            const { data: lead } = await supabase
              .from('leads')
              .select('id, full_name, phone, stage')
              .eq('id', visit.lead_id)
              .single()

            if (!lead?.phone) { results.errors.push({ visit_id: visit.id, reason: 'No lead phone (24hr)' }); continue }
            if (lead.stage === 'dnd') continue

            const timeStr = formatHour(visit.visit_hour)
            const name = (lead.full_name || 'there').split(' ')[0]
            const dateStr = formatDateShort(tomorrowStr)

            const template = getTemplate(settings, 'consult_24hr_reminder',
              'Hi {{name}}, reminder: your Zenith water consultation is tomorrow at {{time}}. Reply CONFIRM to confirm or RESCHEDULE to request a new time.')
            const message = applyTemplate(template, { name, time: timeStr, date: dateStr })

            const sent = await sendSMS(lead.phone, message, 'lead', lead.id)
            if (sent) {
              await supabase.from('site_visits').update({ reminder_sent_24hr: true }).eq('id', visit.id)
              results.visits_24hr_reminded++
              console.log(`[sms-reminders] Visit 24hr reminder sent: ${lead.full_name} for ${dateStr} at ${timeStr}`)
            }
          }
        } catch (err) {
          results.errors.push({ visit_id: visit.id, section: '2b', reason: err.message })
        }
      }
    } else {
      console.log('[sms-reminders] consult_24hr_reminder disabled — skipping')
    }

    // ── Summary ──────────────────────────────────────────────
    const total = results.installs_1hr_reminded + results.installs_24hr_reminded
      + results.visits_1hr_reminded + results.visits_24hr_reminded

    if (total > 0) {
      console.log(`[sms-reminders] Done: ${results.installs_1hr_reminded} install 1hr, ${results.installs_24hr_reminded} install 24hr, ${results.visits_1hr_reminded} visit 1hr, ${results.visits_24hr_reminded} visit 24hr`)
      await supabase.from('email_log').insert({
        customer_id: '00000000-0000-0000-0000-000000000000',
        email_type: 'sms_reminder_summary',
        to_address: 'system@zenithpuresolutions.com',
        subject: `SMS reminders: ${total} sent (installs: ${results.installs_1hr_reminded}×1hr + ${results.installs_24hr_reminded}×24hr | visits: ${results.visits_1hr_reminded}×1hr + ${results.visits_24hr_reminded}×24hr)`,
        status: 'sent',
        sent_at: new Date().toISOString(),
      }).then(function() {}).catch(function() {})
    }

    return res.status(200).json({ message: 'SMS reminders check complete', ...results })

  } catch (err) {
    console.error('[sms-reminders] Cron error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
