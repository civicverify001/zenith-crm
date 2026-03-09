import { useState } from 'react'
import { useCreateLead, useReps } from './useLeads'
import { usePermission } from '../../hooks/usePermission'
import { useAuth } from '../../hooks/useAuth'
import type { CreateLeadPayload } from './leads.types'
import { LEAD_SOURCE_LABELS, WATER_CONCERN_LABELS } from '../../types/domain.types'
import type { LeadSource, WaterConcern } from '../../types/domain.types'

interface Props {
  onClose: () => void
  onCreated?: () => void
}

interface FormState {
  full_name: string
  phone: string
  email: string
  address: string
  city: string
  state: string
  zip_code: string
  source: LeadSource
  water_concern: WaterConcern | ''
  assigned_rep_id: string
  notes: string
  urgent: boolean
}

const SOURCES = Object.entries(LEAD_SOURCE_LABELS) as [LeadSource, string][]
const CONCERNS = Object.entries(WATER_CONCERN_LABELS) as [WaterConcern, string][]

export function CreateLeadModal({ onClose, onCreated }: Props) {
  const { role } = useAuth()
  const { can } = usePermission(role)
  const { mutateAsync: createLead, isPending } = useCreateLead()
  const { data: reps } = useReps()

  const [form, setForm] = useState<FormState>({
    full_name: '', phone: '', email: '', address: '',
    city: '', state: 'IN', zip_code: '', source: 'phone_call',
    water_concern: '', assigned_rep_id: '', notes: '', urgent: false,
  })
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [submitError, setSubmitError] = useState('')

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: '' }))
  }

  function validate(): boolean {
    const e: Partial<Record<keyof FormState, string>> = {}
    if (!form.full_name.trim()) e.full_name = 'Name is required'
    if (!form.phone.trim()) e.phone = 'Phone is required'
    else if (!/^\+?[\d\s\-().]{7,}$/.test(form.phone)) e.phone = 'Enter a valid phone number'
    if (!form.source) e.source = 'Lead source is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    setSubmitError('')
    const payload: CreateLeadPayload & { address?: string; city?: string; state?: string } = {
      full_name: form.full_name, phone: form.phone, source: form.source,
      ...(form.email && { email: form.email }),
      ...(form.address && { address: form.address }),
      ...(form.city && { city: form.city }),
      ...(form.state && { state: form.state }),
      ...(form.zip_code && { zip_code: form.zip_code }),
      ...(form.water_concern && { water_concern: form.water_concern }),
      ...(form.assigned_rep_id && { assigned_rep_id: form.assigned_rep_id }),
      ...(form.notes && { notes: form.notes }),
      urgent: form.urgent,
    }
    try {
      await createLead(payload)
      onCreated?.()
      onClose()
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create lead')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-lg font-bold text-white">New Lead</h2>
            <p className="text-xs text-muted mt-0.5">Fill in the details to add to the pipeline</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-white transition-colors text-xl leading-none">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Full Name <span className="text-red-400">*</span></label>
            <input type="text" value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="John Smith"
              className={`w-full bg-surface border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent transition-colors ${errors.full_name ? 'border-red-500' : 'border-border'}`} />
            {errors.full_name && <p className="text-xs text-red-400 mt-1">{errors.full_name}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Phone <span className="text-red-400">*</span></label>
            <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="(317) 555-0100"
              className={`w-full bg-surface border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent transition-colors ${errors.phone ? 'border-red-500' : 'border-border'}`} />
            {errors.phone && <p className="text-xs text-red-400 mt-1">{errors.phone}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Email</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="john@email.com"
              className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent transition-colors" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Street Address</label>
            <input type="text" value={form.address} onChange={e => set('address', e.target.value)} placeholder="123 Main St"
              className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent transition-colors" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">City</label>
              <input type="text" value={form.city} onChange={e => set('city', e.target.value)} placeholder="Indianapolis"
                className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">State</label>
              <input type="text" value={form.state} onChange={e => set('state', e.target.value.toUpperCase())} placeholder="IN" maxLength={2}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">ZIP</label>
              <input type="text" value={form.zip_code} onChange={e => set('zip_code', e.target.value)} placeholder="46032" maxLength={10}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent transition-colors" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Lead Source <span className="text-red-400">*</span></label>
            <select value={form.source} onChange={e => set('source', e.target.value as LeadSource)}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-accent transition-colors">
              {SOURCES.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Water Concern</label>
            <select value={form.water_concern} onChange={e => set('water_concern', e.target.value as WaterConcern | '')}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-accent transition-colors">
              <option value="">— Select concern —</option>
              {CONCERNS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
          </div>

          {can('leads', 'assign_rep') && reps && reps.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Assign Rep</label>
              <select value={form.assigned_rep_id} onChange={e => set('assigned_rep_id', e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-accent transition-colors">
                <option value="">— Unassigned —</option>
                {reps.map((rep: { id: string; full_name: string; role: string }) => (
                  <option key={rep.id} value={rep.id}>{rep.full_name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any additional context..." rows={3}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent transition-colors resize-none" />
          </div>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div onClick={() => set('urgent', !form.urgent)}
              className={`w-10 h-5 rounded-full transition-colors relative ${form.urgent ? 'bg-orange-500' : 'bg-slate-600'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${form.urgent ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-sm text-slate-300">Mark as Urgent</span>
          </label>

          {submitError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-red-400">{submitError}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-5 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted hover:text-white transition-colors">Cancel</button>
          <button onClick={handleSubmit} disabled={isPending}
            className="px-5 py-2 bg-accent hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-sm transition-colors">
            {isPending ? 'Creating...' : 'Create Lead'}
          </button>
        </div>
      </div>
    </div>
  )
}