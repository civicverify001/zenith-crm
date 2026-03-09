import { useState } from 'react'

interface Props {
  onSubmit: (date: string, notes?: string) => void
  onCancel: () => void
  isPending?: boolean
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export function FollowUpModal({ onSubmit, onCancel, isPending = false }: Props) {
  const [date, setDate] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  function handleSubmit() {
    if (!date) {
      setError('Follow-up date is required')
      return
    }
    if (date < todayStr()) {
      setError('Date must be today or later')
      return
    }
    setError('')
    onSubmit(date, notes.trim() || undefined)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-sm p-5 shadow-2xl">
        <h3 className="font-bold text-white mb-1">Schedule Follow-Up</h3>
        <p className="text-xs text-muted mb-4">Set a date to re-engage this lead.</p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
              Follow-Up Date <span className="text-red-400">*</span>
            </label>
            <input
              type="date"
              value={date}
              min={todayStr()}
              onChange={e => { setDate(e.target.value); setError('') }}
              className={`w-full bg-surface border rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-accent transition-colors ${
                error ? 'border-red-500' : 'border-border'
              }`}
            />
            {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Why are we following up? Any context..."
              rows={2}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent resize-none transition-colors"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-4">
          <button onClick={onCancel} className="flex-1 py-2 text-sm text-muted hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="flex-1 py-2 bg-purple-500 hover:bg-purple-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
          >
            {isPending ? 'Saving...' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}
