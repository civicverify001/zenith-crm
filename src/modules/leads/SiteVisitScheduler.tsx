// src/modules/leads/SiteVisitScheduler.tsx
// Site visit calendar picker — shows reps, week view, busy/open 1-hour slots
// Mon-Sun, 9am-5pm, weekends flagged

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

interface SiteVisit {
  id: string
  lead_id: string
  assigned_rep_id: string
  visit_date: string
  visit_hour: number
  status: string
  customer_name_snapshot: string | null
}

interface Rep {
  id: string
  full_name: string
}

interface Props {
  leadId: string
  leadName: string
  leadPhone: string
  leadAddress: string
  onScheduled: (visit: { rep_name: string; date: string; hour: number }) => void
  onCancel: () => void
}

const HOURS = [9, 10, 11, 12, 13, 14, 15, 16]
const HOUR_LABELS: Record<number, string> = {
  9: '9:00 AM', 10: '10:00 AM', 11: '11:00 AM', 12: '12:00 PM',
  13: '1:00 PM', 14: '2:00 PM', 15: '3:00 PM', 16: '4:00 PM',
}

function getWeekDates(offset: number): Date[] {
  const today = new Date()
  const start = new Date(today)
  start.setDate(today.getDate() + (offset * 7) - today.getDay() + 1) // Monday
  const dates: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    dates.push(d)
  }
  return dates
}

function formatDateKey(d: Date): string {
  return d.toISOString().split('T')[0]
}

function formatDayLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function isWeekend(d: Date): boolean {
  return d.getDay() === 0 || d.getDay() === 6
}

function isPast(d: Date, hour: number): boolean {
  const now = new Date()
  const slotTime = new Date(d)
  slotTime.setHours(hour, 0, 0, 0)
  return slotTime < now
}

export default function SiteVisitScheduler({ leadId, leadName, leadPhone, leadAddress, onScheduled, onCancel }: Props) {
  const { user, profile } = useAuth()
  const [reps, setReps] = useState<Rep[]>([])
  const [visits, setVisits] = useState<SiteVisit[]>([])
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedRep, setSelectedRep] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedHour, setSelectedHour] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeRepId, setActiveRepId] = useState<string | null>(null)

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset])
  const weekStart = formatDateKey(weekDates[0])
  const weekEnd = formatDateKey(weekDates[6])

  // Load reps
  useEffect(() => {
    async function loadReps() {
      // Fetch ALL user profiles — filter in JS to avoid any Supabase query issues
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, full_name, role')
        .order('full_name')

      if (error) {
        console.error('Failed to load reps:', error)
        return
      }

      // Include salesrep and admin roles
      const filtered = (data || []).filter(r =>
        r.role === 'salesrep' || r.role === 'admin'
      )
      console.log('Site visit reps loaded:', filtered.map(r => `${r.full_name} (${r.role})`))
      setReps(filtered)
      if (filtered.length > 0) setActiveRepId(filtered[0].id)
    }
    loadReps()
  }, [])

  // Load visits for visible week
  useEffect(() => {
    async function loadVisits() {
      setLoading(true)
      const { data } = await supabase
        .from('site_visits')
        .select('id, lead_id, assigned_rep_id, visit_date, visit_hour, status, customer_name_snapshot')
        .gte('visit_date', weekStart)
        .lte('visit_date', weekEnd)
        .neq('status', 'cancelled')

      if (data) setVisits(data)
      setLoading(false)
    }
    loadVisits()
  }, [weekStart, weekEnd])

  // Build busy map: { "repId-date-hour": visit }
  const busyMap = useMemo(() => {
    const map: Record<string, SiteVisit> = {}
    for (const v of visits) {
      map[`${v.assigned_rep_id}-${v.visit_date}-${v.visit_hour}`] = v
    }
    return map
  }, [visits])

  function isSlotBusy(repId: string, date: string, hour: number): SiteVisit | null {
    return busyMap[`${repId}-${date}-${hour}`] || null
  }

  function handleSlotClick(repId: string, date: string, hour: number) {
    if (isSlotBusy(repId, date, hour)) return
    const d = new Date(date + 'T12:00:00')
    if (isPast(d, hour)) return
    setSelectedRep(repId)
    setSelectedDate(date)
    setSelectedHour(hour)
  }

  async function handleConfirm() {
    if (!selectedRep || !selectedDate || selectedHour === null || !user) return
    setSubmitting(true)

    try {
      // Insert site visit
      const { error: visitError } = await supabase
        .from('site_visits')
        .insert({
          lead_id: leadId,
          assigned_rep_id: selectedRep,
          visit_date: selectedDate,
          visit_hour: selectedHour,
          status: 'scheduled',
          notes: notes || null,
          address_snapshot: leadAddress || null,
          customer_name_snapshot: leadName,
          phone_snapshot: leadPhone || null,
          created_by: user.id,
        })

      if (visitError) throw visitError

      const repName = reps.find(r => r.id === selectedRep)?.full_name || 'Rep'
      onScheduled({ rep_name: repName, date: selectedDate, hour: selectedHour })
    } catch (e: any) {
      alert('Failed to schedule: ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const selectedRepName = reps.find(r => r.id === selectedRep)?.full_name
  const isSelected = (repId: string, date: string, hour: number) =>
    selectedRep === repId && selectedDate === date && selectedHour === hour

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-5xl max-h-[90vh] rounded-2xl overflow-hidden flex flex-col" style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid #334155' }}>
          <div>
            <h2 className="text-lg font-bold text-white">Schedule Site Visit</h2>
            <p className="text-sm text-slate-400 mt-0.5">{leadName} · {leadAddress || 'No address'}</p>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-white text-xl leading-none">✕</button>
        </div>

        {/* Week nav */}
        <div className="flex items-center justify-between px-6 py-3 flex-shrink-0" style={{ borderBottom: '1px solid #334155' }}>
          <button
            onClick={() => setWeekOffset(o => o - 1)}
            className="px-3 py-1.5 text-sm font-medium rounded-lg text-slate-300 hover:text-white"
            style={{ backgroundColor: '#334155' }}
          >
            ← Prev Week
          </button>
          <div className="text-sm font-semibold text-white">
            {weekDates[0].toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} — {weekDates[6].toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
          <button
            onClick={() => setWeekOffset(o => o + 1)}
            className="px-3 py-1.5 text-sm font-medium rounded-lg text-slate-300 hover:text-white"
            style={{ backgroundColor: '#334155' }}
          >
            Next Week →
          </button>
        </div>

        {/* Calendar grid */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {loading ? (
            <div className="text-center text-slate-400 py-12">Loading calendar...</div>
          ) : reps.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-3xl mb-3">👤</div>
              <p className="text-slate-400">No sales reps found. Add reps in Team & Users first.</p>
            </div>
          ) : (
            <div>
              {/* Rep tabs */}
              <div className="flex gap-2 mb-4">
                {reps.map(rep => {
                  const isActive = activeRepId === rep.id
                  return (
                    <button
                      key={rep.id}
                      onClick={() => setActiveRepId(rep.id)}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                      style={{
                        backgroundColor: isActive ? '#1d4ed8' : '#1e293b',
                        color: isActive ? '#ffffff' : '#94a3b8',
                        border: isActive ? '2px solid #3b82f6' : '1px solid #334155',
                      }}
                    >
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: isActive ? '#2563eb' : '#475569' }}>
                        {rep.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      {rep.full_name}
                    </button>
                  )
                })}
              </div>

              {/* Active rep's calendar */}
              {activeRepId && (
                <div className="grid grid-cols-7 gap-1.5">
                  {weekDates.map(date => {
                    const dateKey = formatDateKey(date)
                    const weekend = isWeekend(date)
                    const isToday = formatDateKey(new Date()) === dateKey

                    return (
                      <div key={dateKey} className="rounded-lg overflow-hidden" style={{ backgroundColor: '#0f172a', border: isToday ? '2px solid #3b82f6' : '1px solid #1e293b' }}>
                        {/* Day header */}
                        <div className="px-2 py-1.5 text-center" style={{ backgroundColor: weekend ? '#451a03' : '#1e293b', borderBottom: '1px solid #334155' }}>
                          <div className="text-xs font-semibold" style={{ color: isToday ? '#60a5fa' : weekend ? '#fbbf24' : '#94a3b8' }}>
                            {formatDayLabel(date)}
                          </div>
                          {weekend && (
                            <div className="text-xs mt-0.5" style={{ color: '#f59e0b' }}>⚡ Confirm w/ rep</div>
                          )}
                        </div>

                        {/* Time slots */}
                        <div className="p-1 space-y-0.5">
                          {HOURS.map(hour => {
                            const busy = isSlotBusy(activeRepId, dateKey, hour)
                            const past = isPast(date, hour)
                            const selected = isSelected(activeRepId, dateKey, hour)

                            if (past) {
                              return (
                                <div key={hour} className="px-1.5 py-1 rounded text-center" style={{ backgroundColor: '#1e293b' }}>
                                  <div className="text-xs" style={{ color: '#475569' }}>{HOUR_LABELS[hour]}</div>
                                </div>
                              )
                            }

                            if (busy) {
                              return (
                                <div key={hour} className="px-1.5 py-1 rounded text-center" style={{ backgroundColor: '#7f1d1d', border: '1px solid #991b1b' }}>
                                  <div className="text-xs font-medium" style={{ color: '#fca5a5' }}>{HOUR_LABELS[hour]}</div>
                                  <div className="text-xs truncate" style={{ color: '#f87171' }}>{busy.customer_name_snapshot || 'Booked'}</div>
                                </div>
                              )
                            }

                            return (
                              <button
                                key={hour}
                                onClick={() => handleSlotClick(activeRepId, dateKey, hour)}
                                className="w-full px-1.5 py-1 rounded text-center transition-all"
                                style={{
                                  backgroundColor: selected ? '#166534' : '#0f2a1a',
                                  border: selected ? '2px solid #22c55e' : '1px solid #1a3a2a',
                                  cursor: 'pointer',
                                }}
                              >
                                <div className="text-xs font-medium" style={{ color: selected ? '#4ade80' : '#86efac' }}>
                                  {HOUR_LABELS[hour]}
                                </div>
                                {selected && <div className="text-xs" style={{ color: '#4ade80' }}>✓ Selected</div>}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer — confirmation bar */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ backgroundColor: '#0f172a', borderTop: '1px solid #334155' }}>
          <div>
            {selectedRep && selectedDate && selectedHour !== null ? (
              <div className="text-sm text-white">
                <span className="font-bold" style={{ color: '#4ade80' }}>✓ Selected: </span>
                {selectedRepName} · {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · {HOUR_LABELS[selectedHour]}
                {isWeekend(new Date(selectedDate + 'T12:00:00')) && (
                  <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded" style={{ backgroundColor: '#451a03', color: '#fbbf24' }}>⚡ Weekend</span>
                )}
              </div>
            ) : (
              <div className="text-sm text-slate-500">Click an open (green) slot above to select a time</div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Notes */}
            {selectedRep && (
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Notes (optional)"
                className="px-3 py-2 rounded-lg text-sm text-white w-48"
                style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
              />
            )}
            <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
            <button
              onClick={handleConfirm}
              disabled={!selectedRep || !selectedDate || selectedHour === null || submitting}
              className="px-5 py-2 text-sm font-bold text-white rounded-lg disabled:opacity-30 transition-colors"
              style={{ backgroundColor: selectedRep ? '#16a34a' : '#334155' }}
            >
              {submitting ? 'Scheduling...' : 'Confirm Visit'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

