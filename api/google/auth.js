// api/google/auth.js
// Generates Google OAuth URL and redirects user
// Called when admin clicks "Send Connect Link" or user clicks the link

import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI || 'https://zenith-crm-ten.vercel.app/api/google/callback'

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

export default async function handler(req, res) {
  // Accepts ?user_id=xxx  — passed in the connect link sent to the user
  const { user_id } = req.query

  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' })
  }

  // Verify this user exists
  const { data: user, error } = await supabaseAdmin.auth.admin.getUserById(user_id)
  if (error || !user?.user) {
    return res.status(404).json({ error: 'User not found' })
  }

  // Build OAuth URL — state carries the user_id so callback knows who it is
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',   // gets refresh_token
    prompt:        'consent',   // always show consent to ensure refresh_token
    state:         user_id,
  })

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  return res.redirect(302, authUrl)
}
