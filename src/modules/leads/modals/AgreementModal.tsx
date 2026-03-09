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
  { value: 'rental', label: 'Rental' },
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
    rental_monthly_amount: '',
    rental_term_months: '60',
    install_preference: '' as InstallPreferenceEnum | '',
    install_preferred_date: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  function set(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: '' }))
  }

  const isRental = form.payment_method === 'rental'

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (isRental) {
      const monthly = parseFloat(form.rental_monthly_amount)
      if (!form.rental_monthly_amount || isNaN(monthly) || monthly <= 0) e.rental_monthly_amount = 'Must be a positive number'
      const term = parseInt(form.rental_term_months)
      if (!form.rental_term_months || isNaN(term) || term <= 0) e.rental_term_months = 'Must be a positive number'
      // Auto-calculate quote total for rental = monthly * term
    } else {
      const total = parseFloat(form.quote_total)
      if (!form.quote_total || isNaN(total) || total <= 0) e.quote_total = 'Must be a positive number'
    }
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

    let quoteTotal: number
    if (isRental) {
      quoteTotal = parseFloat(form.rental_monthly_amount) * parseInt(form.rental_term_months)
    } else {
      quoteTotal = parseFloat(form.quote_total)
    }

    onSubmit({
      quote_total: quoteTotal,
      signed_by: form.signed_by.trim(),
      deposit_amount: form.deposit_amount ? parseFloat(form.deposit_amount) : undefined,
      payment_method: form.payment_method as PaymentMethodEnum,
      financing_provider: form.financing_provider.trim() || undefined,
      rental_monthly_amount: isRental ? parseFloat(form.rental_monthly_amount) : undefined,
      rental_term_months: isRental ? parseInt(form.rental_term_months) : undefined,
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
          {/* Payment Method — moved up so rental fields show contextually */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
              Payment Method <span className="text-red-400">*</span>
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {PAYMENT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => set('payment_method', opt.value)}
                  className={`py-2 text-xs font-semibold rounded-lg border transition-colors ${
                    form.payment_method === opt.value
                      ? opt.value === 'rental'
                        ? 'bg-amber-500/20 text-amber-400 border-amber-500/50'
                        : 'bg-accent/20 text-accent border-accent/50'
                      : 'bg-surface text-muted border-border hover:border-muted'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {errors.payment_method && <p className="text-xs text-red-400 mt-1">{errors.payment_method}</p>}
          </div>

          {/* Rental fields */}
          {isRental && (
            <div className="rounded-lg p-3 space-y-3" style={{ backgroundColor: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <div className="text-xs font-bold uppercase tracking-wide" style={{ color: '#fbbf24' }}>Rental Terms</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1">
                    Monthly Amount <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
                    <input
                      type="number" step="0.01" min="0"
                      value={form.rental_monthly_amount}
                      onChange={e => set('rental_monthly_amount', e.target.value)}
                      placeholder="49.99"
                      className={`${inputClass('rental_monthly_amount')} pl-7`}
                    />
                  </div>
                  {errors.rental_monthly_amount && <p className="text-xs text-red-400 mt-1">{errors.rental_monthly_amount}</p>}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1">
                    Term (months) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number" min="1"
                    value={form.rental_term_months}
                    onChange={e => set('rental_term_months', e.target.value)}
                    placeholder="60"
                    className={inputClass('rental_term_months')}
                  />
                  {errors.rental_term_months && <p className="text-xs text-red-400 mt-1">{errors.rental_term_months}</p>}
                </div>
              </div>
              {form.rental_monthly_amount && form.rental_term_months && (
                <div className="text-xs text-muted">
                  Total contract value: <span className="text-white font-semibold">
                    ${(parseFloat(form.rental_monthly_amount || '0') * parseInt(form.rental_term_months || '0')).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Quote Total — only for non-rental */}
          {!isRental && (
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                Quote Total <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
                <input
                  type="number" step="0.01" min="0"
                  value={form.quote_total}
                  onChange={e => set('quote_total', e.target.value)}
                  placeholder="0.00"
                  className={`${inputClass('quote_total')} pl-7`}
                  autoFocus
                />
              </div>
              {errors.quote_total && <p className="text-xs text-red-400 mt-1">{errors.quote_total}</p>}
            </div>
          )}

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

          {/* Deposit — not for rental */}
          {!isRental && (
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                Deposit Amount
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
                <input
                  type="number" step="0.01" min="0"
                  value={form.deposit_amount}
                  onChange={e => set('deposit_amount', e.target.value)}
                  placeholder="0.00"
                  className={`${inputClass('deposit_amount')} pl-7`}
                />
              </div>
            </div>
          )}

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
