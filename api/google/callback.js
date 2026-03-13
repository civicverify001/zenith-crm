// api/google/callback.js
// Google redirects here after user approves
// Exchanges code for tokens and stores in DB

import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI || 'https://zenith-crm-ten.vercel.app/api/google/callback'

export default async function handler(req, res) {
  const { code, state: user_id, error } = req.query

  if (error) {
    return res.redirect(302, `/connect-calendar?status=denied`)
  }

  if (!code || !user_id) {
    return res.redirect(302, `/connect-calendar?status=error`)
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri:  GOOGLE_REDIRECT_URI,
        grant_type:    'authorization_code',
      }),
    })

    const tokens = await tokenRes.json()
    if (tokens.error) {
      console.error('Token exchange error:', tokens)
      return res.redirect(302, `/connect-calendar?status=error`)
    }

    // Get user's Google email
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const profile = await profileRes.json()

    // Calculate expiry
    const expiry = new Date(Date.now() + (tokens.expires_in * 1000)).toISOString()

    // Upsert into google_calendar_connections
    const { error: dbErr } = await supabaseAdmin
      .from('google_calendar_connections')
      .upsert({
        user_id,
        email:         profile.email || null,
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expiry:  expiry,
        calendar_id:   'primary',
        is_enabled:    true,
        connected_at:  new Date().toISOString(),
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (dbErr) {
      console.error('DB error:', dbErr)
      return res.redirect(302, `/connect-calendar?status=error`)
    }

    return res.redirect(302, `/connect-calendar?status=success&email=${encodeURIComponent(profile.email || '')}`)

  } catch (err) {
    console.error('Callback error:', err)
    return res.redirect(302, `/connect-calendar?status=error`)
  }
}
