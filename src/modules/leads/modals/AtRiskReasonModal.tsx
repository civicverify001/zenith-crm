// src/modules/leads/modals/AtRiskReasonModal.tsx
// At Risk reason codes — same pattern as LostReasonModal
// 4 reason codes per Zenith_Lost_AtRisk_Reason_Codes_v1_0 spec

import { useState } from 'react'

export const AT_RISK_REASON_CODES = [
  {
    value: 'missed_payment',
    label: 'Missed Payment',
    description: 'Autopay failed or payment is overdue. Needs immediate follow-up.',
    requiresText: false,
    requiresDate: false,
    optionalText: false,
    note: 'Check billing tab and confirm payment method is still valid.',
  },
  {
    value: 'no_recent_contact',
    label: 'No Recent Contact',
    description: 'Customer has gone quiet and is not responding to calls or messages.',
    requiresText: false,
    requiresDate: true,
    optionalText: false,
    note: 'A follow-up task will be created on the re-engage date.',
  },
  {
    value: 'considering_cancellation',
    label: 'Considering Cancellation',
    description: 'Customer has expressed intent to cancel or is unhappy with the agreement.',
    requiresText: true,
    requiresDate: false,
    optionalText: false,
    optionalTextPlaceholder: 'Required — describe the situation and what was discussed',
    note: 'Flag for admin review. Consider a retention call or offer.',
  },
  {
    value: 'service_complaint',
    label: 'Service Complaint',
    description: 'Customer is unhappy with service quality, response time, or equipment.',
    requiresText: true,
    requiresDate: false,
    optionalText: false,
    optionalTextPlaceholder: 'Required — describe the complaint clearly',
    note: 'Escalate to admin. Document complaint for service improvement tracking.',
  },
] as const

export type AtRiskReasonCode = typeof AT_RISK_REASON_CODES[number]['value']

export interface AtRiskReasonResult {
  reasonCode: AtRiskReasonCode
  reasonLabel: string
  freeText: string | null
  reEngageDate: string | null
}

interface Props {
  onSubmit: (result: AtRiskReasonResult) => void
  onCancel: () => void
  isPending?: boolean
}

export function AtRiskReasonModal({ onSubmit, onCancel, isPending = false }: Props) {
  const [selectedCode, setSelectedCode] = useState<AtRiskReasonCode | ''>('')
  const [freeText, setFreeText] = useState('')
  const [reEngageDate, setReEngageDate] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const selected = AT_RISK_REASON_CODES.find(r => r.value === selectedCode) ?? null

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const minDate = tomorrow.toISOString().split('T')[0]

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!selectedCode) errs.code = 'Please select a reason'
    if (selected?.requiresText && freeText.trim().length < 5) {
      errs.text = 'Required — please describe the situation (at least 5 characters)'
    }
    if (selected?.requiresDate && !reEngageDate) {
      errs.date = 'Re-engage date is required for this reason'
    }
    if (selected?.requiresDate && reEngageDate && reEngageDate < minDate) {
      errs.date = 'Re-engage date must be in the future'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  function handleSubmit() {
    if (!validate() || !selected) return
    onSubmit({
      reasonCode:  selected.value,
      reasonLabel: selected.label,
      freeText:    freeText.trim() || null,
      reEngageDate: reEngageDate || null,
    })
  }

  const inputBase: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f',
    borderRadius: 10, padding: '9px 14px', color: '#e2e8f0',
    fontSize: 13, outline: 'none', fontFamily: 'inherit',
  }
  const inputErr: React.CSSProperties = { ...inputBase, border: '1px solid rgba(251,191,36,0.6)' }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      {/* Backdrop */}
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)' }}
        onClick={onCancel}
      />

      {/* Modal */}
      <div style={{
        position: 'relative', width: '100%', maxWidth: 440,
        background: '#162232', border: '1px solid #1e3a4f',
        borderRadius: 20, padding: '24px 24px 20px',
        boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 20 }}>⚠️</span>
            <h3 style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 16, margin: 0 }}>
              Mark as At Risk
            </h3>
          </div>
          <p style={{ color: '#64748b', fontSize: 12, margin: 0 }}>
            Select the reason this customer is at risk. This feeds into retention reporting.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Reason code radio list */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              At Risk Reason <span style={{ color: '#fbbf24' }}>*</span>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {AT_RISK_REASON_CODES.map(code => {
                const isSelected = selectedCode === code.value
                return (
                  <button
                    key={code.value}
                    onClick={() => {
                      setSelectedCode(code.value)
                      setFreeText('')
                      setReEngageDate('')
                      setErrors({})
                    }}
                    style={{
                      width: '100%', textAlign: 'left', cursor: 'pointer',
                      padding: '10px 14px', borderRadius: 10,
                      background: isSelected ? 'rgba(251,191,36,0.08)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${isSelected ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.06)'}`,
                      transition: 'all 0.12s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {/* Radio dot */}
                      <div style={{
                        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                        border: `2px solid ${isSelected ? '#fbbf24' : '#334155'}`,
                        background: isSelected ? '#fbbf24' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.12s',
                      }}>
                        {isSelected && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#0f1923' }} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: isSelected ? '#fbbf24' : '#e2e8f0' }}>
                            {code.label}
                          </span>
                          {code.requiresText && (
                            <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: 'rgba(251,191,36,0.15)', color: '#fbbf24', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              Requires note
                            </span>
                          )}
                          {code.requiresDate && (
                            <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: 'rgba(167,139,250,0.15)', color: '#a78bfa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              Requires date
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: '#475569', marginTop: 2, lineHeight: 1.4 }}>
                          {code.description}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
            {errors.code && <p style={{ fontSize: 11, color: '#fbbf24', marginTop: 6 }}>{errors.code}</p>}
          </div>

          {/* Mandatory free text */}
          {selected?.requiresText && (
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Description <span style={{ color: '#fbbf24' }}>* Required</span>
              </label>
              <textarea
                value={freeText}
                onChange={e => { setFreeText(e.target.value); setErrors(p => ({ ...p, text: '' })) }}
                placeholder={selected.optionalTextPlaceholder ?? 'Describe the situation clearly...'}
                rows={3}
                style={{ ...(errors.text ? inputErr : inputBase), resize: 'none' }}
                autoFocus
              />
              {errors.text
                ? <p style={{ fontSize: 11, color: '#fbbf24', marginTop: 4 }}>{errors.text}</p>
                : <p style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{freeText.trim().length}/5 minimum characters</p>
              }
            </div>
          )}

          {/* Re-engage date */}
          {selected?.requiresDate && (
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Re-Engage Date <span style={{ color: '#fbbf24' }}>* Required</span>
              </label>
              <input
                type="date"
                value={reEngageDate}
                min={minDate}
                onChange={e => { setReEngageDate(e.target.value); setErrors(p => ({ ...p, date: '' })) }}
                style={errors.date ? inputErr : inputBase}
              />
              {errors.date
                ? <p style={{ fontSize: 11, color: '#fbbf24', marginTop: 4 }}>{errors.date}</p>
                : <p style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>A follow-up task will be created on this date.</p>
              }
            </div>
          )}

          {/* Info note */}
          {selected?.note && (
            <div style={{
              background: 'rgba(251,191,36,0.06)',
              border: '1px solid rgba(251,191,36,0.2)',
              borderRadius: 10, padding: '8px 12px',
              display: 'flex', gap: 8, alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>💡</span>
              <p style={{ fontSize: 12, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
                {selected.note}
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 10, fontSize: 13,
              color: '#64748b', background: 'rgba(255,255,255,0.04)',
              border: '1px solid #1e3a4f', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending || !selectedCode}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 10, fontSize: 13,
              fontWeight: 700, color: '#0f1923',
              background: isPending || !selectedCode
                ? 'rgba(251,191,36,0.3)'
                : '#fbbf24',
              border: 'none',
              cursor: isPending || !selectedCode ? 'not-allowed' : 'pointer',
              opacity: isPending ? 0.7 : 1,
            }}
          >
            {isPending ? 'Saving...' : 'Mark At Risk'}
          </button>
        </div>
      </div>
    </div>
  )
}
