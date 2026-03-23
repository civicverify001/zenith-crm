// api/cron/quote-followup.js
// Vercel Cron — runs daily at 9 AM UTC
// Section 1: Day 2 follow-up email for sent quotes (48-72hrs ago)
// Section 2: Day 10 final follow-up email for sent quotes (240-264hrs ago)
// Both gated by automation_settings.enabled
// Skips DND leads/customers
//
// vercel.json: { "path": "/api/cron/quote-followup", "schedule": "0 9 * * *" }

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const RESEND_KEY  = process.env.RESEND_API_KEY
const DOMAIN      = process.env.RESEND_DOMAIN || 'zenithpuresolutions.com'
const APP_URL     = process.env.VITE_APP_URL  || 'https://zenith-crm-ten.vercel.app'
const FROM_EMAIL  = `quotes@${DOMAIN}`
const FROM_NAME   = 'Zenith Pure Solutions'

// ── Automation settings loader ────────────────────────────────
async function getSettings() {
  const { data } = await supabase
    .from('automation_settings')
    .select('key, enabled, email_subject, email_template, timing_hours')
    .in('key', ['quote_day2_followup', 'quote_day10_followup'])
  const map = {}
  for (const row of (data || [])) map[row.key] = row
  return map
}

// ── Send via Resend ───────────────────────────────────────────
async function sendEmail(to, subject, html) {
  if (!RESEND_KEY) {
    console.warn('[quote-followup] No RESEND_API_KEY — skipping email')
    return false
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to: [to], subject, html }),
  })
  if (!r.ok) {
    const txt = await r.text()
    console.error('[quote-followup] Resend error:', r.status, txt)
    return false
  }
  return true
}

// ── Email HTML builders ───────────────────────────────────────
function day2Html(quote, customerName, firstName, quoteUrl) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr><td style="background:#0f1e2e;padding:32px;text-align:center;">
    <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">Zenith Pure Solutions</h1>
    <p style="color:#7fb3d0;margin:6px 0 0;font-size:13px;">Clean Water. Pure Simple.</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <h2 style="color:#0f1e2e;margin:0 0 16px;font-size:20px;">Just checking in, ${firstName}!</h2>
    <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 20px;">
      We sent you a quote a couple of days ago and wanted to make sure you had a chance to look it over.
      Your quote number is <strong>${quote.quote_number}</strong>.
    </p>
    <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 28px;">
      If you have any questions about the pricing, system options, or anything else, we are happy to help —
      just reply to this email or give us a call.
    </p>
    <div style="text-align:center;margin-bottom:28px;">
      <a href="${quoteUrl}" style="display:inline-block;background:#0ea5e9;color:#ffffff;text-decoration:none;padding:16px 40px;border-radius:12px;font-size:16px;font-weight:700;">
        View Your Quote &rarr;
      </a>
    </div>
    <div style="background:#fff8ed;border:1px solid #fed7aa;border-radius:10px;padding:16px;margin-bottom:20px;">
      <p style="margin:0;color:#92400e;font-size:14px;font-weight:600;">Questions? We are here to help.</p>
      <p style="margin:6px 0 0;color:#b45309;font-size:13px;">Call us at (317) 690-4172 or reply to this email.</p>
    </div>
    <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">
      You are receiving this because you requested a quote from Zenith Pure Solutions.
      <br/>To unsubscribe from follow-up emails, reply with UNSUBSCRIBE.
    </p>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#94a3b8;">Zenith Pure Solutions LLC &middot; 6951 E 30th St, Suite B &middot; Indianapolis, IN 46219</p>
    <p style="margin:4px 0 0;font-size:12px;color:#94a3b8;">info@zenithpuresolutions.com &middot; (317) 690-4172</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`
}

function day10Html(quote, customerName, firstName, quoteUrl) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr><td style="background:#0f1e2e;padding:32px;text-align:center;">
    <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">Zenith Pure Solutions</h1>
    <p style="color:#7fb3d0;margin:6px 0 0;font-size:13px;">Clean Water. Pure Simple.</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <h2 style="color:#0f1e2e;margin:0 0 16px;font-size:20px;">Final follow-up on your quote, ${firstName}</h2>
    <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 20px;">
      We sent quote <strong>${quote.quote_number}</strong> about 10 days ago and we want to make sure
      it did not get lost. This is our final follow-up — we do not want to overwhelm your inbox.
    </p>
    <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 28px;">
      If the timing is not right, no problem at all. We will be here whenever you are ready.
      Just reply to this email or call us and we can pick up right where we left off.
    </p>
    <div style="text-align:center;margin-bottom:28px;">
      <a href="${quoteUrl}" style="display:inline-block;background:#0ea5e9;color:#ffffff;text-decoration:none;padding:16px 40px;border-radius:12px;font-size:16px;font-weight:700;">
        View Your Quote &rarr;
      </a>
    </div>
    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:16px;margin-bottom:20px;">
      <p style="margin:0;color:#166534;font-size:14px;font-weight:600;">Ready to move forward?</p>
      <p style="margin:6px 0 0;color:#15803d;font-size:13px;">Call us at (317) 690-4172 — we can have your system installed within days.</p>
    </div>
    <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">
      You are receiving this because you requested a quote from Zenith Pure Solutions.
      <br/>To unsubscribe from follow-up emails, reply with UNSUBSCRIBE.
    </p>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#94a3b8;">Zenith Pure Solutions LLC &middot; 6951 E 30th St, Suite B &middot; Indianapolis, IN 46219</p>
    <p style="margin:4px 0 0;font-size:12px;color:#94a3b8;">info@zenithpuresolutions.com &middot; (317) 690-4172</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`
}

// ── Main handler ──────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const isCron   = req.headers['x-vercel-cron'] === '1'
  const cronSecret = process.env.CRON_SECRET
  const isManual = cronSecret && req.headers.authorization === `Bearer ${cronSecret}`

  if (!isCron && !isManual) return res.status(401).json({ error: 'Unauthorized' })

  const results = {
    day2_sent: 0, day2_skipped: 0,
    day10_sent: 0, day10_skipped: 0,
    errors: [],
  }

  const settings = await getSettings()
  const now = new Date()

  try {

    // ══════════════════════════════════════════════════════════
    // SECTION 1 — DAY 2 FOLLOW-UP (48-72 hrs after sent_at)
    // ══════════════════════════════════════════════════════════

    if (settings['quote_day2_followup']?.enabled !== false) {
      const day2Start = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString()
      const day2End   = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()

      const { data: day2Quotes, error: d2Err } = await supabase
        .from('quotes')
        .select('id, quote_number, customer_id, status, sent_at, accept_token, public_token, lead_id')
        .eq('status', 'sent')
        .gte('sent_at', day2Start)
        .lte('sent_at', day2End)
        .is('followup_day2_sent_at', null)

      if (d2Err) {
        console.error('[quote-followup] Day 2 query error:', d2Err.message)
        results.errors.push({ section: 'day2_query', reason: d2Err.message })
      } else {
        console.log(`[quote-followup] Day 2: ${day2Quotes?.length || 0} quotes eligible`)

        for (const quote of (day2Quotes || [])) {
          try {
            // Load customer
            const { data: customer } = await supabase
              .from('customers')
              .select('full_name, email, phone, lead_id')
              .eq('id', quote.customer_id)
              .single()

            if (!customer?.email) {
              results.day2_skipped++
              continue
            }

            // DND check via lead stage
            const leadId = quote.lead_id || customer.lead_id
            if (leadId) {
              const { data: lead } = await supabase
                .from('leads').select('stage').eq('id', leadId).single()
              if (lead?.stage === 'dnd') {
                console.log(`[quote-followup] Day 2 skipped (DND): ${customer.full_name}`)
                results.day2_skipped++
                continue
              }
            }

            const firstName = (customer.full_name || 'there').split(' ')[0]
            const token = quote.public_token || quote.accept_token
            const quoteUrl = `${APP_URL}/q/${token}`
            const subject = `Quick follow-up on your Zenith quote — ${quote.quote_number}`

            const sent = await sendEmail(
              customer.email,
              subject,
              day2Html(quote, customer.full_name, firstName, quoteUrl)
            )

            if (sent) {
              // Mark sent
              await supabase
                .from('quotes')
                .update({ followup_day2_sent_at: now.toISOString() })
                .eq('id', quote.id)

              // Log to email_log
              await supabase.from('email_log').insert({
                customer_id: quote.customer_id,
                email_type: 'quote_followup_day2',
                to_address: customer.email,
                subject,
                status: 'sent',
                sent_at: now.toISOString(),
                document_id: quote.id,
                created_at: now.toISOString(),
              }).then(() => {}).catch(() => {})

              results.day2_sent++
              console.log(`[quote-followup] Day 2 sent: ${customer.full_name} (${quote.quote_number})`)
            } else {
              results.day2_skipped++
            }
          } catch (err) {
            console.error('[quote-followup] Day 2 error:', err.message)
            results.errors.push({ section: 'day2', quote_id: quote.id, reason: err.message })
          }
        }
      }
    } else {
      console.log('[quote-followup] quote_day2_followup disabled — skipping')
    }

    // ══════════════════════════════════════════════════════════
    // SECTION 2 — DAY 10 FOLLOW-UP (240-264 hrs after sent_at)
    // ══════════════════════════════════════════════════════════

    if (settings['quote_day10_followup']?.enabled !== false) {
      const day10Start = new Date(now.getTime() - 264 * 60 * 60 * 1000).toISOString()
      const day10End   = new Date(now.getTime() - 240 * 60 * 60 * 1000).toISOString()

      const { data: day10Quotes, error: d10Err } = await supabase
        .from('quotes')
        .select('id, quote_number, customer_id, status, sent_at, accept_token, public_token, lead_id')
        .eq('status', 'sent')
        .gte('sent_at', day10Start)
        .lte('sent_at', day10End)
        .is('followup_day10_sent_at', null)

      if (d10Err) {
        console.error('[quote-followup] Day 10 query error:', d10Err.message)
        results.errors.push({ section: 'day10_query', reason: d10Err.message })
      } else {
        console.log(`[quote-followup] Day 10: ${day10Quotes?.length || 0} quotes eligible`)

        for (const quote of (day10Quotes || [])) {
          try {
            const { data: customer } = await supabase
              .from('customers')
              .select('full_name, email, phone, lead_id')
              .eq('id', quote.customer_id)
              .single()

            if (!customer?.email) {
              results.day10_skipped++
              continue
            }

            // DND check
            const leadId = quote.lead_id || customer.lead_id
            if (leadId) {
              const { data: lead } = await supabase
                .from('leads').select('stage').eq('id', leadId).single()
              if (lead?.stage === 'dnd') {
                console.log(`[quote-followup] Day 10 skipped (DND): ${customer.full_name}`)
                results.day10_skipped++
                continue
              }
            }

            const firstName = (customer.full_name || 'there').split(' ')[0]
            const token = quote.public_token || quote.accept_token
            const quoteUrl = `${APP_URL}/q/${token}`
            const subject = `Final follow-up on your Zenith quote — ${quote.quote_number}`

            const sent = await sendEmail(
              customer.email,
              subject,
              day10Html(quote, customer.full_name, firstName, quoteUrl)
            )

            if (sent) {
              await supabase
                .from('quotes')
                .update({ followup_day10_sent_at: now.toISOString() })
                .eq('id', quote.id)

              await supabase.from('email_log').insert({
                customer_id: quote.customer_id,
                email_type: 'quote_followup_day10',
                to_address: customer.email,
                subject,
                status: 'sent',
                sent_at: now.toISOString(),
                document_id: quote.id,
                created_at: now.toISOString(),
              }).then(() => {}).catch(() => {})

              results.day10_sent++
              console.log(`[quote-followup] Day 10 sent: ${customer.full_name} (${quote.quote_number})`)
            } else {
              results.day10_skipped++
            }
          } catch (err) {
            console.error('[quote-followup] Day 10 error:', err.message)
            results.errors.push({ section: 'day10', quote_id: quote.id, reason: err.message })
          }
        }
      }
    } else {
      console.log('[quote-followup] quote_day10_followup disabled — skipping')
    }

    // ══════════════════════════════════════════════════════════
    // SECTION 3 — POST-INSTALL REVIEW EMAIL (24hr delay)
    // Jobs where review_email_send_after <= NOW and review_email_sent_at IS NULL
    // ══════════════════════════════════════════════════════════

    if (settings['install_complete_review_email']?.enabled !== false) {
      const { data: reviewJobs, error: rjErr } = await supabase
        .from('jobs')
        .select('id, lead_id, customer_name_snapshot, email_snapshot, phone_snapshot')
        .eq('status', 'complete')
        .lte('review_email_send_after', now.toISOString())
        .is('review_email_sent_at', null)
        .not('review_email_send_after', 'is', null)

      if (rjErr) {
        console.error('[quote-followup] Section 3 query error:', rjErr.message)
      } else {
        console.log(`[quote-followup] Section 3: ${reviewJobs?.length || 0} review emails due`)

        for (const rjob of (reviewJobs || [])) {
          try {
            // Get customer email — prefer customers table, fall back to job snapshot
            let email = rjob.email_snapshot || null
            let customerName = rjob.customer_name_snapshot || 'there'
            let customerId = null
            let leadStage = null

            if (rjob.lead_id) {
              const { data: lead } = await supabase
                .from('leads').select('stage, customer_id').eq('id', rjob.lead_id).single()
              leadStage = lead?.stage
              if (lead?.customer_id) {
                const { data: cust } = await supabase
                  .from('customers').select('id, full_name, email').eq('id', lead.customer_id).single()
                if (cust) {
                  customerId = cust.id
                  customerName = cust.full_name || customerName
                  email = cust.email || email
                }
              }
            }

            // DND check
            if (leadStage === 'dnd') {
              console.log(`[quote-followup] S3 skipped DND: ${customerName}`)
              // Mark sent so we don't retry
              await supabase.from('jobs').update({ review_email_sent_at: now.toISOString() }).eq('id', rjob.id)
              continue
            }

            if (!email) {
              console.log(`[quote-followup] S3 skipped no email: ${customerName}`)
              await supabase.from('jobs').update({ review_email_sent_at: now.toISOString() }).eq('id', rjob.id)
              continue
            }

            const firstName = customerName.split(' ')[0]
            const googleReviewUrl = process.env.GOOGLE_REVIEW_URL || 'https://g.page/r/zenithpuresolutions/review'
            const subject = `How's your new water system? — Zenith Pure Solutions`

            const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr><td style="background:#0f1e2e;padding:32px;text-align:center;">
    <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">Zenith Pure Solutions</h1>
    <p style="color:#7fb3d0;margin:6px 0 0;font-size:13px;">Clean Water. Pure Simple.</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <h2 style="color:#0f1e2e;margin:0 0 16px;font-size:20px;">Welcome to the Zenith family, ${firstName}! 💧</h2>
    <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 20px;">
      It has been about a day since your installation and we want to make sure everything is working perfectly.
      Your water should already be noticeably cleaner — if you have any questions or anything at all,
      just reply to this email or call us at (317) 690-4172.
    </p>
    <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 28px;">
      If you are happy with your new system, we would really appreciate a quick Google review.
      It helps other families find clean water too!
    </p>
    <div style="text-align:center;margin-bottom:28px;">
      <a href="${googleReviewUrl}" style="display:inline-block;background:#0ea5e9;color:#ffffff;text-decoration:none;padding:16px 40px;border-radius:12px;font-size:16px;font-weight:700;">
        Leave a Google Review ⭐
      </a>
    </div>
    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:16px;">
      <p style="margin:0;color:#166534;font-size:14px;font-weight:600;">Need anything?</p>
      <p style="margin:6px 0 0;color:#15803d;font-size:13px;">Call (317) 690-4172 or reply to this email — we are here to help.</p>
    </div>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#94a3b8;">Zenith Pure Solutions LLC &middot; 6951 E 30th St, Suite B &middot; Indianapolis, IN 46219</p>
    <p style="margin:4px 0 0;font-size:12px;color:#94a3b8;">info@zenithpuresolutions.com &middot; (317) 690-4172</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`

            const sent = await sendEmail(email, subject, html)

            if (sent) {
              await supabase.from('jobs')
                .update({ review_email_sent_at: now.toISOString() })
                .eq('id', rjob.id)

              if (customerId) {
                await supabase.from('email_log').insert({
                  customer_id: customerId,
                  email_type: 'install_review_request',
                  to_address: email,
                  subject,
                  status: 'sent',
                  sent_at: now.toISOString(),
                  created_at: now.toISOString(),
                }).then(() => {}).catch(() => {})
              }

              results.day2_sent++ // reuse counter for summary
              console.log(`[quote-followup] S3 review email sent: ${customerName}`)
            } else {
              // Don't retry failed sends indefinitely — mark after 3 cron runs would be ideal
              // For now mark sent to avoid infinite retry
              await supabase.from('jobs').update({ review_email_sent_at: now.toISOString() }).eq('id', rjob.id)
            }
          } catch (err) {
            console.error('[quote-followup] S3 error:', err.message)
            results.errors.push({ section: 'review', job_id: rjob.id, reason: err.message })
          }
        }
      }
    } else {
      console.log('[quote-followup] install_complete_review_email disabled — skipping')
    }

    // ══════════════════════════════════════════════════════════
    // SECTION 4 — 30-DAY REFERRAL SMS
    // Jobs completed 29–31 days ago, referral_sms_sent_at IS NULL
    // ══════════════════════════════════════════════════════════

    if (settings['referral_30day_sms']?.enabled !== false) {
      const day29 = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString()
      const day31 = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString()

      const { data: referralJobs, error: rjErr } = await supabase
        .from('jobs')
        .select('id, lead_id, customer_name_snapshot, phone_snapshot, email_snapshot')
        .eq('status', 'complete')
        .gte('completed_at', day29)
        .lte('completed_at', day31)
        .is('referral_sms_sent_at', null)

      if (rjErr) {
        console.error('[quote-followup] Section 4 query error:', rjErr.message)
      } else {
        console.log(`[quote-followup] Section 4: ${referralJobs?.length || 0} referral SMS due`)

        for (const rjob of (referralJobs || [])) {
          try {
            let phone = rjob.phone_snapshot || null
            let customerName = rjob.customer_name_snapshot || 'there'
            let isDnd = false

            // DND check via lead
            if (rjob.lead_id) {
              const { data: lead } = await supabase
                .from('leads').select('stage, full_name').eq('id', rjob.lead_id).single()
              if (lead?.stage === 'dnd') isDnd = true
              if (lead?.full_name) customerName = lead.full_name
            }

            if (isDnd) {
              await supabase.from('jobs').update({ referral_sms_sent_at: now.toISOString() }).eq('id', rjob.id)
              continue
            }

            if (!phone) {
              // Try customer record
              if (rjob.lead_id) {
                const { data: cust } = await supabase
                  .from('customers').select('phone, full_name').eq('lead_id', rjob.lead_id).single()
                if (cust?.phone) phone = cust.phone
                if (cust?.full_name) customerName = cust.full_name
              }
            }

            if (!phone) {
              await supabase.from('jobs').update({ referral_sms_sent_at: now.toISOString() }).eq('id', rjob.id)
              continue
            }

            const firstName = customerName.split(' ')[0]

            // Call trigger endpoint (fire-and-forget)
            const triggerRes = await fetch(`${APP_URL}/api/automations/trigger`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                key: 'referral_30day_sms',
                to: phone,
                entity_type: 'lead',
                entity_id: rjob.lead_id,
                variables: { name: firstName },
              }),
            })

            const triggerData = await triggerRes.json()
            if (triggerData.sent || triggerData.skipped) {
              await supabase.from('jobs').update({ referral_sms_sent_at: now.toISOString() }).eq('id', rjob.id)
              if (triggerData.sent) {
                results.day2_sent++ // reuse counter for summary
                console.log(`[quote-followup] S4 referral SMS sent: ${customerName}`)
              }
            }
          } catch (err) {
            console.error('[quote-followup] S4 error:', err.message)
            results.errors.push({ section: 'referral', job_id: rjob.id, reason: err.message })
          }
        }
      }
    } else {
      console.log('[quote-followup] referral_30day_sms disabled — skipping')
    }

    // ══════════════════════════════════════════════════════════
    // SECTION 4 — 30-DAY REFERRAL SMS
    // Jobs completed 29–31 days ago, referral_sms_sent_at IS NULL
    // ══════════════════════════════════════════════════════════

    if (settings['referral_30day_sms']?.enabled !== false) {
      const day29ago = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString()
      const day31ago = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString()

      const { data: referralJobs, error: rjErr } = await supabase
        .from('jobs')
        .select('id, lead_id, customer_name_snapshot, phone_snapshot, email_snapshot, completed_at')
        .eq('status', 'complete')
        .gte('completed_at', day29ago)
        .lte('completed_at', day31ago)
        .is('referral_sms_sent_at', null)

      if (rjErr) {
        console.error('[quote-followup] Section 4 query error:', rjErr.message)
        results.errors.push({ section: 'referral_query', reason: rjErr.message })
      } else {
        console.log(`[quote-followup] Section 4: ${referralJobs?.length || 0} referral SMS due`)

        for (const job of (referralJobs || [])) {
          try {
            // Get phone — prefer customer record
            let phone = job.phone_snapshot || null
            let customerId = null
            let leadStage = null

            if (job.lead_id) {
              const { data: lead } = await supabase
                .from('leads').select('stage, customer_id').eq('id', job.lead_id).single()
              leadStage = lead?.stage
              if (lead?.customer_id) {
                const { data: cust } = await supabase
                  .from('customers').select('id, phone').eq('id', lead.customer_id).single()
                if (cust) { customerId = cust.id; phone = cust.phone || phone }
              }
            }

            // Mark sent regardless (avoid infinite retry on no-phone)
            if (!phone) {
              await supabase.from('jobs').update({ referral_sms_sent_at: now.toISOString() }).eq('id', job.id)
              results.day2_skipped++
              continue
            }

            // DND check
            if (leadStage === 'dnd') {
              await supabase.from('jobs').update({ referral_sms_sent_at: now.toISOString() }).eq('id', job.id)
              results.day2_skipped++
              continue
            }

            const firstName = (job.customer_name_snapshot || 'there').split(' ')[0]

            const sendRes = await fetch(`${APP_URL}/api/automations/trigger`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                key: 'referral_30day_sms',
                to: phone,
                entity_type: customerId ? 'customer' : 'lead',
                entity_id: customerId || job.lead_id,
                variables: { name: firstName },
              }),
            })

            const sendData = await sendRes.json()
            await supabase.from('jobs').update({ referral_sms_sent_at: now.toISOString() }).eq('id', job.id)

            if (sendData.sent) {
              results.day2_sent++
              console.log(`[quote-followup] S4 referral SMS sent: ${job.customer_name_snapshot}`)
            } else {
              results.day2_skipped++
            }
          } catch (err) {
            console.error('[quote-followup] S4 error:', err.message)
            results.errors.push({ section: 'referral', job_id: job.id, reason: err.message })
            // Mark to avoid retry loop
            await supabase.from('jobs').update({ referral_sms_sent_at: now.toISOString() }).eq('id', job.id).then(() => {}).catch(() => {})
          }
        }
      }
    } else {
      console.log('[quote-followup] referral_30day_sms disabled — skipping')
    }

    // ── Summary log ──────────────────────────────────────────
    const total = results.day2_sent + results.day10_sent
    if (total > 0) {
      await supabase.from('email_log').insert({
        customer_id: '00000000-0000-0000-0000-000000000000',
        email_type: 'quote_followup_summary',
        to_address: 'system@zenithpuresolutions.com',
        subject: `Quote follow-up cron: ${results.day2_sent} day-2, ${results.day10_sent} day-10 sent`,
        status: 'sent',
        sent_at: now.toISOString(),
      }).then(() => {}).catch(() => {})
    }

    console.log(`[quote-followup] Done: day2=${results.day2_sent} sent / ${results.day2_skipped} skipped | day10=${results.day10_sent} sent / ${results.day10_skipped} skipped`)
    return res.status(200).json({ message: 'Quote follow-up cron complete', ...results })

  } catch (err) {
    console.error('[quote-followup] Fatal error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
