import { useState } from 'react'

interface Props {
  onSubmit: (reason: string) => void
  onCancel: () => void
  isPending?: boolean
}

export function LostReasonModal({ onSubmit, onCancel, isPending = false }: Props) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  function handleSubmit() {
    const trimmed = reason.trim()
    if (trimmed.length < 5) {
      setError('Please provide at least 5 characters')
      return
    }
    setError('')
    onSubmit(trimmed)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-sm p-5 shadow-2xl">
        <h3 className="font-bold text-white mb-1">Mark as Lost</h3>
        <p className="text-xs text-muted mb-4">Why is this lead being lost?</p>

        <div>
          <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
            Lost Reason <span className="text-red-400">*</span>
          </label>
          <textarea
            value={reason}
            onChange={e => { setReason(e.target.value); setError('') }}
            placeholder="e.g., Went with competitor, budget issues, no response..."
            rows={3}
            className={`w-full bg-surface border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent resize-none transition-colors ${
              error ? 'border-red-500' : 'border-border'
            }`}
            autoFocus
          />
          {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
          <p className="text-xs text-muted mt-1">{reason.trim().length}/5 minimum characters</p>
        </div>

        <div className="flex gap-3 mt-4">
          <button onClick={onCancel} className="flex-1 py-2 text-sm text-muted hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="flex-1 py-2 bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
          >
            {isPending ? 'Saving...' : 'Mark Lost'}
          </button>
        </div>
      </div>
    </div>
  )
}
