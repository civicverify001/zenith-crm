import { useJobRequiredForms, useSubmitFormResponse } from '../useJobs'
import { FORM_TYPE_LABELS } from '../dispatch.types'
import type { JobRequiredForm, FormType } from '../dispatch.types'

interface Props {
  jobId: string
}

export function ConsentsTab({ jobId }: Props) {
  const { data: forms, isLoading } = useJobRequiredForms(jobId)
  const { mutateAsync: submitForm, isPending } = useSubmitFormResponse()

  if (isLoading) return <p className="text-sm text-muted text-center py-8">Loading...</p>

  const consentForms = (forms as JobRequiredForm[] || []).filter(
    f => f.form_type === 'ro_drilling_consent'
  )

  if (consentForms.length === 0) {
    return <p className="text-sm text-muted text-center py-8">No consent forms required for this job type.</p>
  }

  async function handleSubmit(formType: FormType) {
    try {
      await submitForm({
        jobId,
        formType,
        responseData: {
          consent_given: true,
          consent_date: new Date().toISOString(),
          description: 'Customer authorizes drilling of new faucet hole for RO installation.',
        },
        signatureUrl: null,
      })
    } catch (e: any) {
      alert(e.message)
    }
  }

  return (
    <div className="space-y-4">
      {consentForms.map(form => {
        const isCompleted = form.status === 'completed'

        return (
          <div
            key={form.id}
            className={`border rounded-xl p-4 ${
              isCompleted ? 'border-green/30 bg-green/5' : 'border-amber/30 bg-amber/5'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold text-white">{FORM_TYPE_LABELS[form.form_type]}</h4>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                isCompleted ? 'bg-green/20 text-green' : 'bg-amber/20 text-amber'
              }`}>
                {isCompleted ? 'Signed' : 'Required'}
              </span>
            </div>

            {!isCompleted && (
              <>
                <p className="text-xs text-slate-300 mb-2">
                  The customer authorizes Zenith Pure Solutions to drill a new faucet hole in the countertop
                  or sink area for the reverse osmosis system installation. Customer understands this is a
                  permanent modification.
                </p>
                <p className="text-xs text-amber mb-3">
                  ⚠️ This consent must be obtained BEFORE drilling begins.
                </p>
                <button
                  onClick={() => handleSubmit(form.form_type)}
                  disabled={isPending}
                  className="text-xs px-3 py-1.5 bg-amber hover:bg-amber-400 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
                >
                  {isPending ? 'Saving...' : 'Record Consent'}
                </button>
              </>
            )}

            {isCompleted && (
              <div className="text-xs text-muted">
                Consent recorded {form.completed_at ? new Date(form.completed_at).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                }) : ''}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
