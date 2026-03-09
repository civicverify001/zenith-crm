import { useState } from 'react'
import type { Lead } from '../leads.types'
import type { SystemType } from '../../dispatch/dispatch.types'
import { SYSTEM_TYPE_LABELS } from '../../dispatch/dispatch.types'
import { createInstallJobFromLead } from '../../../services/jobService'

interface Props {
  lead: Lead
  onSubmit: (updatedLead: Lead) => void
  onCancel: () => void
  actor: { actor_id: string; actor_name?: string }
}

const SYSTEM_OPTIONS: { value: SystemType; label: string }[] = [
  { value: 'softener_only', label: 'Softener Only' },
  { value: 'pure_start_softener', label: 'Pure Start + Softener' },
  { value: 'advanced_softener', label: 'Advanced + Softener' },
  { value: 'dual_tank', label: 'Dual Tank' },
  { value: 'ro_install', label: 'RO Install' },
  { value: 'combo_whole_home_ro', label: 'Combo (Whole Home + RO)' },
]

export function InstallJobModal({ lead, onSubmit, onCancel, actor }: Props) {
  const [systemType, setSystemType] = useState<SystemType | ''>('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [needsFaucetHole, setNeedsFaucetHole] = useState(false)
  const [error, setError] = useState('')
  const [isPending, setIsPending] = useState(false)

  const showFaucetOption = systemType === 'ro_install' || systemType === 'combo_whole_home_ro'

  async function handleSubmit() {
    if (!systemType) {
      setError('Select a system type')
      return
    }
    setError('')
    setIsPending(true)

    try {
      await createInstallJobFromLead(
        lead,
        systemType,
        scheduledDate || null,
        needsFaucetHole,
        actor
      )
      // Refresh the lead to show job_created = true
      onSubmit({ ...lead, job_created: true })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 shadow-2xl">
        <h3 className="font-bold text-white mb-1">Create Install Job</h3>
        <p className="text-xs text-muted mb-4">
          This creates a real job in the Dispatch Board with checklist and required forms.
        </p>

        <div className="space-y-3">
          {/* System Type */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">
              System Type <span className="text-red-400">*</span>
            </label>
            <div className="space-y-1.5">
              {SYSTEM_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { setSystemType(opt.value); setError('') }}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                    systemType === opt.value
                      ? 'bg-accent/15 border-accent/50 text-white font-medium'
                      : 'bg-surface border-border text-slate-300 hover:border-muted'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Faucet hole (conditional for RO) */}
          {showFaucetOption && (
            <label className="flex items-center gap-3 cursor-pointer select-none py-1">
              <div
                onClick={() => setNeedsFaucetHole(!needsFaucetHole)}
                className={`w-10 h-5 rounded-full transition-colors relative ${needsFaucetHole ? 'bg-amber' : 'bg-slate-600'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${needsFaucetHole ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-sm text-slate-300">New faucet hole required (triggers drilling consent)</span>
            </label>
          )}

          {/* Scheduled Date */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
              Scheduled Date (optional)
            </label>
            <input
              type="date"
              value={scheduledDate}
              min={new Date().toISOString().split('T')[0]}
              onChange={e => setScheduledDate(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={onCancel} className="flex-1 py-2 text-sm text-muted hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="flex-1 py-2 bg-accent hover:bg-sky-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
          >
            {isPending ? 'Creating Job...' : 'Create Job'}
          </button>
        </div>
      </div>
    </div>
  )
}
