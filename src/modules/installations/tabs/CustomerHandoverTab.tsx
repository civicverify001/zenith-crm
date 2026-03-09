import { useJobRequiredForms, useJobFormResponses, useSubmitFormResponse } from '../../dispatch/useJobs'
import { FORM_TYPE_LABELS } from '../../dispatch/dispatch.types'
import type { JobRequiredForm, FormType } from '../../dispatch/dispatch.types'
import { WholeHomeHandoverForm } from '../forms/WholeHomeHandoverForm'
import { ROHandoverForm } from '../forms/ROHandoverForm'
import { useState } from 'react'

interface Props {
  jobId: string
}

/**
 * Validate that the customer name looks like a real name.
 * Must be at least 2 characters, contain only letters/spaces/hyphens/apostrophes,
 * and have at least 2 parts (first + last).
 */
function validateCustomerName(name: string | undefined | null): string | null {
  if (!name || !name.trim()) return 'Customer name is required for signature'

  const cleaned = name.trim()

  // Must be at least 3 characters
  if (cleaned.length < 3) return 'Name is too short — enter the customer\'s full name'

  // Must contain only valid name characters (letters, spaces, hyphens, apostrophes, periods)
  if (!/^[a-zA-Z\s\-'.]+$/.test(cleaned)) return 'Name contains invalid characters — please enter the customer\'s real name'

  // Must have at least 2 parts (first and last name)
  const parts = cleaned.split(/\s+/).filter(p => p.length > 0)
  if (parts.length < 2) return 'Please enter the customer\'s full name (first and last)'

  // Each part should be at least 2 characters
  if (parts.some(p => p.length < 2)) return 'Each name part must be at least 2 characters'

  return null // Valid
}

export function CustomerHandoverTab({ jobId }: Props) {
  const { data: forms, isLoading } = useJobRequiredForms(jobId)
  const { data: responses } = useJobFormResponses(jobId)
  const { mutateAsync: submitForm, isPending } = useSubmitFormResponse()
  const [activeForm, setActiveForm] = useState<FormType | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  if (isLoading) return <p className="text-sm text-muted text-center py-8">Loading forms...</p>

  const handoverForms = (forms as JobRequiredForm[] || []).filter(
    f => f.form_type === 'whole_home_handover' || f.form_type === 'ro_handover'
  )

  if (handoverForms.length === 0) {
    return <p className="text-sm text-muted text-center py-8">No customer handover forms required for this job.</p>
  }

  const responseLookup = new Map((responses || []).map((r: any) => [r.form_type, r]))

  async function handleFormSubmit(formType: FormType, responseData: Record<string, any>, signatureUrl: string | null) {
    // Validate customer name before submission
    const nameError = validateCustomerName(responseData.customer_name)
    if (nameError) {
      setValidationError(nameError)
      return
    }

    setValidationError(null)

    await submitForm({ jobId, formType, responseData, signatureUrl })
    setActiveForm(null)
  }

  return (
    <div className="space-y-4">
      {/* Validation error banner */}
      {validationError && (
        <div className="rounded-lg px-4 py-2.5 text-sm font-semibold flex items-center gap-2"
          style={{ backgroundColor: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' }}>
          <span>⚠️</span>
          <span>{validationError}</span>
        </div>
      )}

      {handoverForms.map(form => {
        const response = responseLookup.get(form.form_type)
        const isCompleted = form.status === 'completed'
        const isActive = activeForm === form.form_type

        return (
          <div key={form.id} className={`border rounded-xl p-4 ${
            isCompleted ? 'border-green/30 bg-green/5' : 'border-border'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold text-white">
                {FORM_TYPE_LABELS[form.form_type]}
              </h4>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                isCompleted ? 'bg-green/20 text-green' : 'bg-amber/20 text-amber'
              }`}>
                {isCompleted ? 'Completed' : 'Pending'}
              </span>
            </div>

            {isCompleted ? (
              <div className="text-xs text-muted space-y-1">
                <div>Completed {form.completed_at ? new Date(form.completed_at).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                }) : ''}</div>
                {(form as any).signature_verified
                  ? <div className="text-green">✅ Customer signature verified</div>
                  : form.requires_signature
                    ? <div className="text-amber">⚠️ Signature not yet verified</div>
                    : null
                }
                {response?.response_data?.customer_name && (
                  <div>Signed by: {response.response_data.customer_name}</div>
                )}
              </div>
            ) : isActive ? (
              <div className="mt-3">
                {form.form_type === 'whole_home_handover' && (
                  <WholeHomeHandoverForm
                    jobId={jobId}
                    formType={form.form_type}
                    onSubmit={(data, sig) => handleFormSubmit(form.form_type, data, sig)}
                    isPending={isPending}
                  />
                )}
                {form.form_type === 'ro_handover' && (
                  <ROHandoverForm
                    jobId={jobId}
                    formType={form.form_type}
                    onSubmit={(data, sig) => handleFormSubmit(form.form_type, data, sig)}
                    isPending={isPending}
                  />
                )}
                <button
                  onClick={() => { setActiveForm(null); setValidationError(null) }}
                  className="w-full mt-2 py-1.5 text-xs text-muted hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div>
                <p className="text-xs text-muted mb-3">
                  {form.requires_signature && '✍️ Customer signature required. '}
                  Complete this form with the customer present.
                </p>
                <button
                  onClick={() => { setActiveForm(form.form_type); setValidationError(null) }}
                  className="text-xs px-3 py-1.5 bg-accent hover:bg-sky-400 text-white font-semibold rounded-lg transition-colors"
                >
                  Start Handover
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
