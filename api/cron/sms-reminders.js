// api/cron/sms-reminders.js
// Vercel Cron — runs every 30 minutes
// Sends SMS reminders 1 hour before scheduled installs and site visits
//
// Add to vercel.json crons:
// { "path": "/api/cron/sms-reminders", "schedule": "*/30 * * * *" }

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const APP_URL = process.env.VITE_APP_URL || 'https://zenith-crm-ten.vercel.app'

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

module.exports = async function handler(req, res) {
  const isCron = req.headers['x-vercel-cron'] === '1'
  const cronSecret = process.env.CRON_SECRET
  const isManual = cronSecret && req.headers.authorization === `Bearer ${cronSecret}`

  if (!isCron && !isManual) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const results = { installs_reminded: 0, visits_reminded: 0, errors: [] }

  try {
    const now = new Date()
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000)
    const todayStr = now.toISOString().split('T')[0]
    const currentHour = now.getHours()
    const reminderHour = oneHourFromNow.getHours()

    // ══════════════════════════════════════════════════════════
    // 1. INSTALLATION REMINDERS
    // Jobs scheduled today, within the next ~1 hour, not yet reminded
    // ══════════════════════════════════════════════════════════

    const { data: upcomingJobs } = await supabase
      .from('jobs')
      .select('id, customer_name_snapshot, phone_snapshot, email_snapshot, scheduled_date, system_type, status, reminder_sent, lead_id')
      .eq('reminder_sent', false)
      .in('status', ['scheduled', 'ready_to_schedule'])
      .gte('scheduled_date', todayStr + 'T00:00:00')
      .lte('scheduled_date', todayStr + 'T23:59:59')

    for (const job of (upcomingJobs || [])) {
      try {
        // Parse the scheduled time
        const scheduledTime = new Date(job.scheduled_date)
        const timeDiffMinutes = (scheduledTime.getTime() - now.getTime()) / 60000

        // Send reminder if appointment is 30-90 minutes away
        if (timeDiffMinutes > 0 && timeDiffMinutes <= 90) {
          const phone = job.phone_snapshot
          if (!phone) {
            results.errors.push({ job_id: job.id, reason: 'No phone number' })
            continue
          }

          const timeStr = scheduledTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
          const name = job.customer_name_snapshot || 'Valued Customer'
          const message = `Hi ${name}, this is Zenith Pure Solutions. Reminder: your water system installation is today at ${timeStr}. Reply CONFIRM to confirm, or RESCHEDULE to request a new time. Questions? Call (317) 690-4172.`

          const sent = await sendSMS(phone, message, 'lead', job.lead_id)

          if (sent) {
            await supabase.from('jobs').update({ reminder_sent: true }).eq('id', job.id)
            results.installs_reminded++
            console.log(`[sms-reminders] Install reminder sent: ${name} at ${timeStr}`)
          }
        }
      } catch (err) {
        results.errors.push({ job_id: job.id, reason: err.message })
      }
    }

    // ══════════════════════════════════════════════════════════
    // 2. SITE VISIT REMINDERS
    // Visits scheduled today, within the next ~1 hour, not yet reminded
    // ══════════════════════════════════════════════════════════

    const { data: upcomingVisits } = await supabase
      .from('site_visits')
      .select('id, lead_id, visit_date, visit_hour, status, reminder_sent, assigned_rep_id')
      .eq('reminder_sent', false)
      .eq('visit_date', todayStr)
      .eq('status', 'scheduled')

    for (const visit of (upcomingVisits || [])) {
      try {
        const visitHour = visit.visit_hour
        // Send if visit is 1 hour from now (current hour matches visitHour - 1)
        if (visitHour >= currentHour && visitHour <= reminderHour) {
          // Get lead info for phone + name
          if (!visit.lead_id) continue

          const { data: lead } = await supabase
            .from('leads')
            .select('id, full_name, phone, stage')
            .eq('id', visit.lead_id)
            .single()

          if (!lead || !lead.phone) {
            results.errors.push({ visit_id: visit.id, reason: 'No lead phone' })
            continue
          }

          // Don't send to DND leads
          if (lead.stage === 'dnd') continue

          const timeStr = formatHour(visitHour)
          const message = `Hi ${lead.full_name}, this is Zenith Pure Solutions. Reminder: your water consultation visit is today at ${timeStr}. Reply CONFIRM to confirm, or RESCHEDULE to request a new time. Questions? Call (317) 690-4172.`

          const sent = await sendSMS(lead.phone, message, 'lead', lead.id)

          if (sent) {
            await supabase.from('site_visits').update({ reminder_sent: true }).eq('id', visit.id)
            results.visits_reminded++
            console.log(`[sms-reminders] Visit reminder sent: ${lead.full_name} at ${timeStr}`)
          }
        }
      } catch (err) {
        results.errors.push({ visit_id: visit.id, reason: err.message })
      }
    }

    // ── Summary log ──────────────────────────────────────────
    const total = results.installs_reminded + results.visits_reminded
    if (total > 0) {
      console.log(`[sms-reminders] Done: ${results.installs_reminded} install + ${results.visits_reminded} visit reminders sent`)
      await supabase.from('email_log').insert({
        customer_id: '00000000-0000-0000-0000-000000000000',
        email_type: 'sms_reminder_summary',
        to_address: 'system@zenithpuresolutions.com',
        subject: `SMS reminders: ${total} sent (${results.installs_reminded} install, ${results.visits_reminded} visit)`,
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
