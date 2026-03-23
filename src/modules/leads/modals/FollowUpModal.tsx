// src/modules/leads/modals/FollowUpModal.tsx
// Follow-Up modal with a visual calendar picker (no manual date typing)

import { useState } from 'react'

interface Props {
  onSubmit: (date: string, notes?: string) => void
  onCancel: () => void
  isPending?: boolean
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function formatDisplay(dateStr: string): string {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export function FollowUpModal({ onSubmit, onCancel, isPending }: Props) {
  const today = new Date()
  const todayStr = formatDateKey(today.getFullYear(), today.getMonth(), today.getDate())

  const [viewYear, setViewYear]   = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selected, setSelected]   = useState<string>('')
  const [notes, setNotes]         = useState('')

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  const daysInMonth  = getDaysInMonth(viewYear, viewMonth)
  const firstDay     = getFirstDayOfMonth(viewYear, viewMonth)
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null)

  function handleSubmit() {
    if (!selected) return
    onSubmit(selected, notes.trim() || undefined)
  }

  // Quick pick buttons
  function quickPick(daysAhead: number) {
    const d = new Date()
    d.setDate(d.getDate() + daysAhead)
    const key = formatDateKey(d.getFullYear(), d.getMonth(), d.getDate())
    setSelected(key)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  return (
    <div className="absolute inset-0 bg-black/60 flex items-center justify-center p-4 z-20">
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">

        {/* Header */}
        <div style={{ background: '#162232', padding: '16px 20px', borderBottom: '1px solid #1e3a4f' }}>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 15 }}>📅 Schedule Follow-Up</div>
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>Pick a date to re-engage this lead</div>
        </div>

        <div style={{ padding: '16px 20px' }}>

          {/* Quick picks */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {[
              { label: 'Tomorrow',  days: 1  },
              { label: '3 Days',    days: 3  },
              { label: '1 Week',    days: 7  },
              { label: '2 Weeks',   days: 14 },
              { label: '1 Month',   days: 30 },
            ].map(q => (
              <button key={q.label} onClick={() => quickPick(q.days)}
                style={{
                  padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  border: '1px solid rgba(96,165,250,0.3)',
                  background: 'rgba(96,165,250,0.08)',
                  color: '#60a5fa',
                  transition: 'all 0.15s',
                }}>
                {q.label}
              </button>
            ))}
          </div>

          {/* Month navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button onClick={prevMonth} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18, padding: '0 4px', lineHeight: 1 }}>‹</button>
            <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13 }}>{MONTHS[viewMonth]} {viewYear}</div>
            <button onClick={nextMonth} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18, padding: '0 4px', lineHeight: 1 }}>›</button>
          </div>

          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
            {DAYS.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#475569', padding: '2px 0' }}>{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {cells.map((day, i) => {
              if (!day) return <div key={i} />
              const dateKey  = formatDateKey(viewYear, viewMonth, day)
              const isPast   = dateKey < todayStr
              const isToday  = dateKey === todayStr
              const isSel    = dateKey === selected
              return (
                <button key={i} onClick={() => !isPast && setSelected(dateKey)} disabled={isPast}
                  style={{
                    padding: '6px 2px', borderRadius: 7, fontSize: 12, fontWeight: isSel ? 700 : 400,
                    cursor: isPast ? 'not-allowed' : 'pointer', border: 'none',
                    background: isSel ? '#0d7ea3' : isToday ? 'rgba(96,165,250,0.15)' : 'transparent',
                    color: isSel ? '#fff' : isPast ? '#334155' : isToday ? '#60a5fa' : '#e2e8f0',
                    outline: isToday && !isSel ? '1px solid rgba(96,165,250,0.4)' : 'none',
                    transition: 'all 0.1s',
                  }}
                  onMouseEnter={e => { if (!isPast && !isSel) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)' }}
                  onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = isToday ? 'rgba(96,165,250,0.15)' : 'transparent' }}
                >
                  {day}
                </button>
              )
            })}
          </div>

          {/* Selected date display */}
          {selected && (
            <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(13,126,163,0.12)', border: '1px solid rgba(13,126,163,0.3)', borderRadius: 8, fontSize: 12, color: '#38bdf8', fontWeight: 600 }}>
              ✓ {formatDisplay(selected)}
            </div>
          )}

          {/* Notes */}
          <div style={{ marginTop: 12 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Why are we following up? Any context..."
              rows={2}
              style={{ width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '8px 10px', fontSize: 12, outline: 'none', resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button onClick={onCancel} style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: '1px solid #1e3a4f', background: 'transparent', color: '#64748b', fontSize: 13, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={!selected || isPending}
              style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: 'none', background: selected ? '#0d7ea3' : '#334155', color: '#fff', fontWeight: 700, fontSize: 13, cursor: selected ? 'pointer' : 'not-allowed', opacity: isPending ? 0.6 : 1 }}>
              {isPending ? 'Scheduling…' : 'Schedule'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
