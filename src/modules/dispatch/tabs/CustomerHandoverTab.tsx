import { useJobRequiredForms, useJobFormResponses, useSubmitFormResponse } from '../useJobs'
import { FORM_TYPE_LABELS } from '../dispatch.types'
import type { JobRequiredForm, FormType } from '../dispatch.types'
import { useState } from 'react'

interface Props {
  jobId: string
}

export function CustomerHandoverTab({ jobId }: Props) {
  const { data: forms, isLoading } = useJobRequiredForms(jobId)
  const { data: responses } = useJobFormResponses(jobId)
  const { mutateAsync: submitForm, isPending } = useSubmitFormResponse()
  const [activeForm, setActiveForm] = useState<string | null>(null)

  if (isLoading) return <p className="text-sm text-muted text-center py-8">Loading forms...</p>

  const handoverForms = (forms as JobRequiredForm[] || []).filter(
    f => f.form_type === 'whole_home_handover' || f.form_type === 'ro_handover'
  )

  if (handoverForms.length === 0) {
    return <p className="text-sm text-muted text-center py-8">No customer handover forms required for this job.</p>
  }

  const responseLookup = new Map((responses || []).map((r: any) => [r.form_type, r]))

  async function handleSubmit(formType: FormType) {
    try {
      await submitForm({
        jobId,
        formType,
        responseData: { acknowledged: true, submitted_at: new Date().toISOString() },
        signatureUrl: null, // Signature capture in future — Supabase Storage
      })
      setActiveForm(null)
    } catch (e: any) {
      alert(e.message)
    }
  }

  return (
    <div className="space-y-4">
      {handoverForms.map(form => {
        const response = responseLookup.get(form.form_type)
        const isCompleted = form.status === 'completed'

        return (
          <div
            key={form.id}
            className={`border rounded-xl p-4 ${
              isCompleted ? 'border-green/30 bg-green/5' : 'border-border'
            }`}
          >
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

            {form.requires_signature && (
              <div className="text-xs text-muted mb-2">
                ✍️ Customer signature required
              </div>
            )}

            {isCompleted ? (
              <div className="text-xs text-muted">
                Completed {form.completed_at ? new Date(form.completed_at).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                }) : ''}
                {response?.customer_signature_url && ' • Signature captured'}
              </div>
            ) : (
              <div>
                <p className="text-xs text-muted mb-3">
                  This form must be completed with the customer present before the job can be marked complete.
                </p>
                <button
                  onClick={() => handleSubmit(form.form_type)}
                  disabled={isPending}
                  className="text-xs px-3 py-1.5 bg-accent hover:bg-sky-400 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
                >
                  {isPending ? 'Submitting...' : 'Complete Handover'}
                </button>
              </div>
            )}
          </div>
        )
      })}

      <div className="text-xs text-muted border-t border-border pt-3">
        Full handover form UI with field-by-field input and signature capture will be built when Supabase Storage is connected.
        Current flow captures acknowledgment status.
      </div>
    </div>
  )
}
