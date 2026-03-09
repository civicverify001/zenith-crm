import { useState } from 'react'
import type { AgreementData, PaymentMethodEnum, InstallPreferenceEnum } from '../../../services/leadMutations'

interface Props {
  onSubmit: (data: AgreementData) => void
  onCancel: () => void
  isPending?: boolean
}

const PAYMENT_OPTIONS: { value: PaymentMethodEnum; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'card', label: 'Card' },
  { value: 'financing', label: 'Financing' },
]

const INSTALL_OPTIONS: { value: InstallPreferenceEnum; label: string }[] = [
  { value: 'asap', label: 'ASAP' },
  { value: 'specific_date', label: 'Specific Date' },
  { value: 'flexible', label: 'Flexible' },
]

export function AgreementModal({ onSubmit, onCancel, isPending = false }: Props) {
  const [form, setForm] = useState({
    quote_total: '',
    signed_by: '',
    deposit_amount: '',
    payment_method: '' as PaymentMethodEnum | '',
    financing_provider: '',
    install_preference: '' as InstallPreferenceEnum | '',
    install_preferred_date: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  function set(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: '' }))
  }

  function validate(): boolean {
    const e: Record<string, string> = {}
    const total = parseFloat(form.quote_total)
    if (!form.quote_total || isNaN(total) || total <= 0) e.quote_total = 'Must be a positive number'
    if (!form.signed_by.trim()) e.signed_by = 'Required'
    if (!form.payment_method) e.payment_method = 'Select a payment method'
    if (form.payment_method === 'financing' && !form.financing_provider.trim()) {
      e.financing_provider = 'Required when financing'
    }
    if (form.install_preference === 'specific_date' && !form.install_preferred_date) {
      e.install_preferred_date = 'Select a date'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit() {
    if (!validate()) return
    onSubmit({
      quote_total: parseFloat(form.quote_total),
      signed_by: form.signed_by.trim(),
      deposit_amount: form.deposit_amount ? parseFloat(form.deposit_amount) : undefined,
      payment_method: form.payment_method as PaymentMethodEnum,
      financing_provider: form.financing_provider.trim() || undefined,
      install_preference: (form.install_preference || undefined) as InstallPreferenceEnum | undefined,
      install_preferred_date: form.install_preferred_date || undefined,
    })
  }

  const inputClass = (key: string) =>
    `w-full bg-surface border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent transition-colors ${
      errors[key] ? 'border-red-500' : 'border-border'
    }`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 shadow-2xl">
        <h3 className="font-bold text-white mb-1">Mark Agreement Signed</h3>
        <p className="text-xs text-muted mb-4">Enter agreement details to move this lead forward.</p>

        <div className="space-y-3">
          {/* Quote Total */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
              Quote Total <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.quote_total}
                onChange={e => set('quote_total', e.target.value)}
                placeholder="0.00"
                className={`${inputClass('quote_total')} pl-7`}
                autoFocus
              />
            </div>
            {errors.quote_total && <p className="text-xs text-red-400 mt-1">{errors.quote_total}</p>}
          </div>

          {/* Signed By */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
              Signed By <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.signed_by}
              onChange={e => set('signed_by', e.target.value)}
              placeholder="Customer name"
              className={inputClass('signed_by')}
            />
            {errors.signed_by && <p className="text-xs text-red-400 mt-1">{errors.signed_by}</p>}
          </div>

          {/* Deposit */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
              Deposit Amount
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.deposit_amount}
                onChange={e => set('deposit_amount', e.target.value)}
                placeholder="0.00"
                className={`${inputClass('deposit_amount')} pl-7`}
              />
            </div>
          </div>

          {/* Payment Method */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
              Payment Method <span className="text-red-400">*</span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {PAYMENT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => set('payment_method', opt.value)}
                  className={`py-2 text-xs font-semibold rounded-lg border transition-colors ${
                    form.payment_method === opt.value
                      ? 'bg-accent/20 text-accent border-accent/50'
                      : 'bg-surface text-muted border-border hover:border-muted'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {errors.payment_method && <p className="text-xs text-red-400 mt-1">{errors.payment_method}</p>}
          </div>

          {/* Financing Provider (conditional) */}
          {form.payment_method === 'financing' && (
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                Financing Provider <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.financing_provider}
                onChange={e => set('financing_provider', e.target.value)}
                placeholder="e.g., GreenSky, Synchrony..."
                className={inputClass('financing_provider')}
              />
              {errors.financing_provider && <p className="text-xs text-red-400 mt-1">{errors.financing_provider}</p>}
            </div>
          )}

          {/* Install Preference */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
              Install Preference
            </label>
            <div className="grid grid-cols-3 gap-2">
              {INSTALL_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => set('install_preference', opt.value)}
                  className={`py-2 text-xs font-semibold rounded-lg border transition-colors ${
                    form.install_preference === opt.value
                      ? 'bg-green/20 text-green border-green/50'
                      : 'bg-surface text-muted border-border hover:border-muted'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Install Date (conditional) */}
          {form.install_preference === 'specific_date' && (
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                Preferred Install Date <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                value={form.install_preferred_date}
                min={new Date().toISOString().split('T')[0]}
                onChange={e => set('install_preferred_date', e.target.value)}
                className={inputClass('install_preferred_date')}
              />
              {errors.install_preferred_date && <p className="text-xs text-red-400 mt-1">{errors.install_preferred_date}</p>}
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
            className="flex-1 py-2 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
          >
            {isPending ? 'Saving...' : 'Sign Agreement'}
          </button>
        </div>
      </div>
    </div>
  )
}
