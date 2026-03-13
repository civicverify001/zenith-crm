// src/services/googleCalService.ts
// Frontend helpers for Google Calendar management

import { supabase } from '../lib/supabase'

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token
}

// Get all connections (admin only)
export async function fetchCalConnections(): Promise<Record<string, { email: string; is_enabled: boolean; connected_at: string }>> {
  const { data, error } = await supabase
    .from('google_calendar_connections')
    .select('user_id, email, is_enabled, connected_at')

  if (error || !data) return {}
  return Object.fromEntries(data.map(c => [c.user_id, c]))
}

// Send connect link to a user (opens in new tab)
export function sendConnectLink(userId: string) {
  window.open(`/api/google/auth?user_id=${userId}`, '_blank')
}

// Toggle enabled/disabled
export async function toggleCalSync(userId: string) {
  const token = await getToken()
  const res = await fetch('/api/google/disconnect', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ user_id: userId, action: 'toggle' }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error)
  return data
}

// Disconnect completely
export async function disconnectCal(userId: string) {
  const token = await getToken()
  const res = await fetch('/api/google/disconnect', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ user_id: userId, action: 'disconnect' }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error)
  return data
}

// Push a job or site visit to Google Calendar
export async function syncToCalendar(entityType: 'job' | 'site_visit', entityId: string) {
  const token = await getToken()
  const res = await fetch('/api/google/sync-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ entity_type: entityType, entity_id: entityId, action: 'upsert' }),
  })
  if (!res.ok) {
    const data = await res.json()
    console.warn('Cal sync failed (non-fatal):', data.error)
  }
}

// Delete a calendar event
export async function deleteFromCalendar(entityType: 'job' | 'site_visit', entityId: string) {
  const token = await getToken()
  await fetch('/api/google/sync-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ entity_type: entityType, entity_id: entityId, action: 'delete' }),
  })
}
