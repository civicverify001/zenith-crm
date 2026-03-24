// src/modules/leads/LostReasonModal.tsx
// Lost reason codes per Zenith_Lost_AtRisk_Reason_Codes_v1_0 spec
// 6 mandatory reason codes. "Other" = mandatory free text.
// "Deferred / Timing Not Right" = mandatory re-engage date.
// "No Response After Follow-ups" = auto-move note shown to user.

import { useState } from 'react'

// ── Reason code definitions ─────────────────────────────────────
export const LOST_REASON_CODES = [
  {
    value: 'price_too_high',
    label: 'Price Too High',
    description: 'Customer indicated the quoted price was beyond their budget or expectations.',
    requiresText: false,
    requiresDate: false,
    optionalText: true,
    optionalTextPlaceholder: 'Any additional context? (optional)',
    autoMove: false,
    note: null,
  },
  {
    value: 'went_with_competitor',
    label: 'Went With Competitor',
    description: 'Customer has chosen an alternative supplier or product.',
    requiresText: false,
    requiresDate: false,
    optionalText: true,
    optionalTextPlaceholder: 'Competitor name if known (optional — helps competitive analysis)',
    autoMove: false,
    note: null,
  },
  {
    value: 'finance_declined',
    label: 'Finance Declined',
    description: 'Hearth finance application was declined and customer cannot proceed.',
    requiresText: false,
    requiresDate: false,
    optionalText: false,
    optionalTextPlaceholder: null,
    autoMove: false,
    note: 'Admin may present alternative payment options (buy outright / rental).',
  },
  {
    value: 'no_response',
    label: 'No Response After Follow-ups',
    description: 'Customer did not respond after full contact sequence and follow-up emails.',
    requiresText: false,
    requiresDate: false,
    optionalText: false,
    optionalTextPlaceholder: null,
    autoMove: true,
    note: 'Lead will be moved to Future Follow-Up automatically for re-engagement.',
  },
  {
    value: 'deferred',
    label: 'Deferred / Timing Not Right',
    description: 'Customer is interested but not ready to proceed at this time.',
    requiresText: false,
    requiresDate: true,
    optionalText: false,
    optionalTextPlaceholder: null,
    autoMove: true,
    note: 'Lead will be auto-moved to Future Follow-Up on the re-engage date you set.',
  },
  {
    value: 'other',
    label: 'Other',
    description: 'Reason does not fit any of the above categories.',
    requiresText: true,
    requiresDate: false,
    optionalText: false,
    optionalTextPlaceholder: 'Required — describe the reason clearly',
    autoMove: false,
    note: 'Admin will review periodically.',
  },
] as const

export type LostReasonCode = typeof LOST_REASON_CODES[number]['value']

export interface LostReasonResult {
  reasonCode: LostReasonCode
  reasonLabel: string
  freeText: string | null
  reEngageDate: string | null  // ISO date string YYYY-MM-DD
  autoMoveToFutureFollowUp: boolean
}

interface Props {
  onSubmit: (result: LostReasonResult) => void
  onCancel: () => void
  isPending?: boolean
}

export function LostReasonModal({ onSubmit, onCancel, isPending = false }: Props) {
  const [selectedCode, setSelectedCode] = useState<LostReasonCode | ''>('')
  const [freeText, setFreeText] = useState('')
  const [reEngageDate, setReEngageDate] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const selected = LOST_REASON_CODES.find(r => r.value === selectedCode) ?? null

  // ── Min date for re-engage = tomorrow ──────────────────────────
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const minDate = tomorrow.toISOString().split('T')[0]

  function validate(): boolean {
    const errs: Record<string, string> = {}

    if (!selectedCode) {
      errs.code = 'Please select a reason'
    }

    if (selected?.requiresText && freeText.trim().length < 5) {
      errs.text = 'Required — please describe the reason (at least 5 characters)'
    }

    if (selected?.requiresDate && !reEngageDate) {
      errs.date = 'Re-engage date is required for this reason code'
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
      reasonCode:              selected.value,
      reasonLabel:             selected.label,
      freeText:                freeText.trim() || null,
      reEngageDate:            reEngageDate || null,
      autoMoveToFutureFollowUp: selected.autoMove,
    })
  }

  // ── Styles ──────────────────────────────────────────────────────
  const inputBase: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f',
    borderRadius: 10, padding: '9px 14px', color: '#e2e8f0',
    fontSize: 13, outline: 'none', fontFamily: 'inherit',
  }
  const inputErr: React.CSSProperties = { ...inputBase, border: '1px solid rgba(248,113,113,0.6)' }

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
            <span style={{ fontSize: 20 }}>❌</span>
            <h3 style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 16, margin: 0 }}>
              Mark as Lost
            </h3>
          </div>
          <p style={{ color: '#64748b', fontSize: 12, margin: 0 }}>
            Select the reason this lead is being lost. This feeds directly into pipeline reporting.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* ── Reason Code Radio List ──────────────────────────── */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Lost Reason <span style={{ color: '#f87171' }}>*</span>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {LOST_REASON_CODES.map(code => {
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
                      background: isSelected
                        ? 'rgba(248,113,113,0.1)'
                        : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${isSelected
                        ? 'rgba(248,113,113,0.4)'
                        : 'rgba(255,255,255,0.06)'}`,
                      transition: 'all 0.12s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {/* Radio dot */}
                      <div style={{
                        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                        border: `2px solid ${isSelected ? '#f87171' : '#334155'}`,
                        background: isSelected ? '#f87171' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.12s',
                      }}>
                        {isSelected && (
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: isSelected ? '#f87171' : '#e2e8f0' }}>
                            {code.label}
                          </span>
                          {code.requiresText && (
                            <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: 'rgba(248,113,113,0.15)', color: '#f87171', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              Requires note
                            </span>
                          )}
                          {code.requiresDate && (
                            <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: 'rgba(251,191,36,0.15)', color: '#fbbf24', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              Requires date
                            </span>
                          )}
                          {code.autoMove && (
                            <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: 'rgba(167,139,250,0.15)', color: '#a78bfa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              Auto-moves
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
            {errors.code && (
              <p style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>{errors.code}</p>
            )}
          </div>

          {/* ── Contextual fields based on selection ─────────────── */}
          {selected && (

            /* Optional competitor name or other optional text */
            selected.optionalText && !selected.requiresText ? (
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  Additional Context <span style={{ color: '#334155' }}>(optional)</span>
                </label>
                <input
                  type="text"
                  value={freeText}
                  onChange={e => setFreeText(e.target.value)}
                  placeholder={selected.optionalTextPlaceholder ?? ''}
                  style={inputBase}
                />
              </div>
            ) : selected.requiresText ? (
              /* "Other" — mandatory free text */
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  Reason Description <span style={{ color: '#f87171' }}>* Required</span>
                </label>
                <textarea
                  value={freeText}
                  onChange={e => { setFreeText(e.target.value); setErrors(p => ({ ...p, text: '' })) }}
                  placeholder={selected.optionalTextPlaceholder ?? 'Describe the reason clearly...'}
                  rows={3}
                  style={{ ...(errors.text ? inputErr : inputBase), resize: 'none' }}
                  autoFocus
                />
                {errors.text
                  ? <p style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>{errors.text}</p>
                  : <p style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{freeText.trim().length}/5 minimum characters</p>
                }
              </div>
            ) : null
          )}

          {/* ── Re-engage date (Deferred) ───────────────────────── */}
          {selected?.requiresDate && (
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Re-Engage Date <span style={{ color: '#f87171' }}>* Required</span>
              </label>
              <input
                type="date"
                value={reEngageDate}
                min={minDate}
                onChange={e => { setReEngageDate(e.target.value); setErrors(p => ({ ...p, date: '' })) }}
                style={errors.date ? inputErr : inputBase}
              />
              {errors.date
                ? <p style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>{errors.date}</p>
                : <p style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                    Lead will be auto-moved to Future Follow-Up on this date and a reminder task will be created for the rep.
                  </p>
              }
            </div>
          )}

          {/* ── Info note ──────────────────────────────────────────── */}
          {selected?.note && (
            <div style={{
              background: selected.autoMove
                ? 'rgba(167,139,250,0.08)'
                : 'rgba(13,126,163,0.08)',
              border: `1px solid ${selected.autoMove
                ? 'rgba(167,139,250,0.2)'
                : 'rgba(13,126,163,0.2)'}`,
              borderRadius: 10, padding: '8px 12px',
              display: 'flex', gap: 8, alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>
                {selected.autoMove ? 'ℹ️' : '💡'}
              </span>
              <p style={{ fontSize: 12, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
                {selected.note}
              </p>
            </div>
          )}
        </div>

        {/* ── Actions ─────────────────────────────────────────────── */}
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
              fontWeight: 700, color: '#fff',
              background: isPending || !selectedCode
                ? 'rgba(248,113,113,0.3)'
                : 'linear-gradient(135deg, #ef4444, #dc2626)',
              border: 'none',
              cursor: isPending || !selectedCode ? 'not-allowed' : 'pointer',
              opacity: isPending ? 0.7 : 1,
            }}
          >
            {isPending ? 'Saving...' : 'Mark Lost'}
          </button>
        </div>
      </div>
    </div>
  )
}
