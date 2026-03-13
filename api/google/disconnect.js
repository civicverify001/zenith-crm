// api/google/disconnect.js
// Admin can disconnect a user's Google Calendar
// PATCH { user_id, action: 'disconnect' | 'toggle' }

import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })

  // Verify caller is admin
  const authHeader = req.headers.authorization
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' })

  const callerRole = user.user_metadata?.role || user.app_metadata?.role
  if (callerRole !== 'admin') return res.status(403).json({ error: 'Admin only' })

  const { user_id, action } = req.body
  if (!user_id) return res.status(400).json({ error: 'user_id required' })

  if (action === 'disconnect') {
    // Fetch the connection to get access token for revocation
    const { data: conn } = await supabaseAdmin
      .from('google_calendar_connections')
      .select('access_token')
      .eq('user_id', user_id)
      .maybeSingle()

    if (conn?.access_token) {
      // Revoke with Google (best effort — don't fail if this errors)
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${conn.access_token}`, { method: 'POST' })
      } catch (e) {
        console.warn('Token revocation failed (non-fatal):', e.message)
      }
    }

    // Delete from our DB
    await supabaseAdmin.from('google_calendar_connections').delete().eq('user_id', user_id)
    await supabaseAdmin.from('google_calendar_events').delete().eq('user_id', user_id)

    return res.status(200).json({ success: true, action: 'disconnected' })
  }

  if (action === 'toggle') {
    // Toggle is_enabled without removing tokens
    const { data: conn } = await supabaseAdmin
      .from('google_calendar_connections')
      .select('is_enabled')
      .eq('user_id', user_id)
      .maybeSingle()

    if (!conn) return res.status(404).json({ error: 'No connection found for this user' })

    const { error } = await supabaseAdmin
      .from('google_calendar_connections')
      .update({ is_enabled: !conn.is_enabled, updated_at: new Date().toISOString() })
      .eq('user_id', user_id)

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true, is_enabled: !conn.is_enabled })
  }

  return res.status(400).json({ error: 'Invalid action. Use disconnect or toggle.' })
}
