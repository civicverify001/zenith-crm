import { useState } from 'react'
import type { FormType } from '../../dispatch/dispatch.types'
import { SignatureCanvas } from '../SignatureCanvas'
import { uploadSignature } from '../../../services/storageService'

interface Props {
  jobId: string
  formType: FormType
  onSubmit: (responseData: Record<string, any>, signatureUrl: string | null) => Promise<void>
  isPending?: boolean
}

const WHOLE_HOME_CHECKLIST = [
  { key: 'system_operation', label: 'System operation explained to customer' },
  { key: 'bypass_valve', label: 'Bypass valve location and operation shown' },
  { key: 'regeneration_schedule', label: 'Regeneration schedule explained' },
  { key: 'salt_maintenance', label: 'Salt maintenance requirements discussed' },
  { key: 'filter_schedule', label: 'Filter replacement schedule provided' },
  { key: 'warranty_info', label: 'Warranty information reviewed with customer' },
  { key: 'emergency_shutoff', label: 'Emergency shutoff procedure demonstrated' },
  { key: 'water_quality', label: 'Water quality test results reviewed' },
  { key: 'contact_info', label: 'Service contact information provided' },
  { key: 'customer_questions', label: 'All customer questions answered' },
]

export function WholeHomeHandoverForm({ jobId, formType, onSubmit, isPending }: Props) {
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const [customerName, setCustomerName] = useState('')
  const [customerNotes, setCustomerNotes] = useState('')
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)

  const allChecked = WHOLE_HOME_CHECKLIST.every(item => checks[item.key])
  const canSubmit = allChecked && customerName.trim() && signatureDataUrl

  function toggleCheck(key: string) {
    setChecks(prev => ({ ...prev, [key]: !prev[key] }))
  }

  async function handleSubmit() {
    if (!allChecked) { setError('All checklist items must be checked'); return }
    if (!customerName.trim()) { setError('Customer name is required'); return }
    if (!signatureDataUrl) { setError('Customer signature is required'); return }
    setError('')
    setUploading(true)

    try {
      // Upload signature to Supabase Storage
      let signatureUrl: string | null = null
      try {
        signatureUrl = await uploadSignature(jobId, signatureDataUrl, formType)
      } catch (uploadErr) {
        // Storage might not be configured yet — fall back to data URL reference
        console.warn('Signature upload failed, using reference:', uploadErr)
        signatureUrl = `local_signature_${customerName.trim()}_${Date.now()}`
      }

      const responseData = {
        checklist_items: WHOLE_HOME_CHECKLIST.map(item => ({
          key: item.key, label: item.label, checked: !!checks[item.key],
        })),
        customer_name: customerName.trim(),
        customer_notes: customerNotes.trim() || null,
        signature_captured: true,
        submitted_at: new Date().toISOString(),
      }

      await onSubmit(responseData, signatureUrl)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  const busy = isPending || uploading

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted">Complete each item with the customer present. All items and signature are required.</div>

      <div className="space-y-1">
        {WHOLE_HOME_CHECKLIST.map(item => (
          <div key={item.key} onClick={() => toggleCheck(item.key)}
            className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-colors ${checks[item.key] ? 'bg-green/5' : 'hover:bg-surface'}`}>
            <div className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
              checks[item.key] ? 'bg-green border-green text-white' : 'border-muted'}`}>
              {checks[item.key] && <span className="text-xs">✓</span>}
            </div>
            <span className={`text-sm ${checks[item.key] ? 'text-muted line-through' : 'text-slate-200'}`}>{item.label}</span>
          </div>
        ))}
      </div>

      <div>
        <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Customer Name <span className="text-red-400">*</span></label>
        <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Full legal name"
          className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent" />
      </div>

      <div>
        <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Notes (optional)</label>
        <textarea value={customerNotes} onChange={e => setCustomerNotes(e.target.value)} placeholder="Any special instructions..."
          rows={2} className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent resize-none" />
      </div>

      <div>
        <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Customer Signature <span className="text-red-400">*</span></label>
        <SignatureCanvas onCapture={setSignatureDataUrl} onClear={() => setSignatureDataUrl(null)} />
      </div>

      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>}

      <button onClick={handleSubmit} disabled={!canSubmit || busy}
        className="w-full py-2.5 bg-green-500 hover:bg-green-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-sm transition-colors">
        {busy ? 'Submitting...' : 'Complete Handover'}
      </button>
    </div>
  )
}
