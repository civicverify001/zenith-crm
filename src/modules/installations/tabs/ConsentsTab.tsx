import { useJobRequiredForms, useSubmitFormResponse } from '../../dispatch/useJobs'
import { FORM_TYPE_LABELS } from '../../dispatch/dispatch.types'
import type { JobRequiredForm, FormType } from '../dispatch/dispatch.types'
import { RODrillingConsentForm } from '../forms/RODrillingConsentForm'
import { useState } from 'react'

interface Props {
  jobId: string
}

export function ConsentsTab({ jobId }: Props) {
  const { data: forms, isLoading } = useJobRequiredForms(jobId)
  const { mutateAsync: submitForm, isPending } = useSubmitFormResponse()
  const [activeForm, setActiveForm] = useState<FormType | null>(null)

  if (isLoading) return <p className="text-sm text-muted text-center py-8">Loading...</p>

  const consentForms = (forms as JobRequiredForm[] || []).filter(
    f => f.form_type === 'ro_drilling_consent'
  )

  if (consentForms.length === 0) {
    return <p className="text-sm text-muted text-center py-8">No consent forms required for this job type.</p>
  }

  async function handleSubmit(formType: FormType, responseData: Record<string, any>, signatureUrl: string | null) {
    await submitForm({ jobId, formType, responseData, signatureUrl })
    setActiveForm(null)
  }

  return (
    <div className="space-y-4">
      {consentForms.map(form => {
        const isCompleted = form.status === 'completed'
        const isActive = activeForm === form.form_type

        return (
          <div key={form.id} className={`border rounded-xl p-4 ${
            isCompleted ? 'border-green/30 bg-green/5' : 'border-amber/30 bg-amber/5'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold text-white">{FORM_TYPE_LABELS[form.form_type]}</h4>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                isCompleted ? 'bg-green/20 text-green' : 'bg-amber/20 text-amber'
              }`}>
                {isCompleted ? 'Signed' : 'Required'}
              </span>
            </div>

            {isCompleted ? (
              <div className="text-xs text-muted">
                Consent recorded {form.completed_at ? new Date(form.completed_at).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                }) : ''}
                <div className="text-green mt-1">✅ Customer signature captured</div>
              </div>
            ) : isActive ? (
              <div className="mt-3">
                <RODrillingConsentForm
                  jobId={jobId}
                  formType={form.form_type}
                  onSubmit={(data, sig) => handleSubmit(form.form_type, data, sig)}
                  isPending={isPending}
                />
                <button
                  onClick={() => setActiveForm(null)}
                  className="w-full mt-2 py-1.5 text-xs text-muted hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div>
                <p className="text-xs text-slate-300 mb-3">
                  ⚠️ This consent must be obtained BEFORE drilling begins. Customer must be present.
                </p>
                <button
                  onClick={() => setActiveForm(form.form_type)}
                  className="text-xs px-3 py-1.5 bg-amber hover:bg-amber-400 text-white font-semibold rounded-lg transition-colors"
                >
                  Start Consent Form
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
