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

const RO_CHECKLIST = [
  { key: 'ro_operation', label: 'RO system operation explained to customer' },
  { key: 'faucet_usage', label: 'RO faucet usage demonstrated' },
  { key: 'tank_fill_time', label: 'Initial tank fill time explained (2-4 hours)' },
  { key: 'filter_schedule', label: 'Filter replacement schedule reviewed' },
  { key: 'membrane_schedule', label: 'Membrane replacement schedule reviewed' },
  { key: 'tds_reading', label: 'TDS reading shown and explained to customer' },
  { key: 'drain_connection', label: 'Drain connection location shown' },
  { key: 'warranty_info', label: 'Warranty information provided' },
  { key: 'contact_info', label: 'Service contact information provided' },
  { key: 'customer_questions', label: 'All customer questions answered' },
]

export function ROHandoverForm({ jobId, formType, onSubmit, isPending }: Props) {
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const [customerName, setCustomerName] = useState('')
  const [tdsReading, setTdsReading] = useState('')
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)

  const allChecked = RO_CHECKLIST.every(item => checks[item.key])
  const canSubmit = allChecked && customerName.trim() && tdsReading.trim() && signatureDataUrl

  function toggleCheck(key: string) { setChecks(prev => ({ ...prev, [key]: !prev[key] })) }

  async function handleSubmit() {
    if (!canSubmit) { setError('All items, TDS reading, customer name, and signature required'); return }
    setError('')
    setUploading(true)
    try {
      let signatureUrl: string | null = null
      try { signatureUrl = await uploadSignature(jobId, signatureDataUrl!, formType) }
      catch { signatureUrl = `local_signature_${customerName.trim()}_${Date.now()}` }

      await onSubmit({
        checklist_items: RO_CHECKLIST.map(item => ({ key: item.key, label: item.label, checked: !!checks[item.key] })),
        customer_name: customerName.trim(), tds_reading: tdsReading.trim(),
        signature_captured: true, submitted_at: new Date().toISOString(),
      }, signatureUrl)
    } catch (e: any) { setError(e.message) }
    finally { setUploading(false) }
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted">Guardian RO ZPS-RO800 — Complete with customer present.</div>
      <div className="space-y-1">
        {RO_CHECKLIST.map(item => (
          <div key={item.key} onClick={() => toggleCheck(item.key)}
            className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-colors ${checks[item.key] ? 'bg-green/5' : 'hover:bg-surface'}`}>
            <div className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center ${checks[item.key] ? 'bg-green border-green text-white' : 'border-muted'}`}>
              {checks[item.key] && <span className="text-xs">✓</span>}
            </div>
            <span className={`text-sm ${checks[item.key] ? 'text-muted line-through' : 'text-slate-200'}`}>{item.label}</span>
          </div>
        ))}
      </div>
      <div>
        <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Final TDS Reading <span className="text-red-400">*</span></label>
        <input type="text" value={tdsReading} onChange={e => setTdsReading(e.target.value)} placeholder="e.g., 12 ppm"
          className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Customer Name <span className="text-red-400">*</span></label>
        <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Full legal name"
          className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Customer Signature <span className="text-red-400">*</span></label>
        <SignatureCanvas onCapture={setSignatureDataUrl} onClear={() => setSignatureDataUrl(null)} />
      </div>
      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>}
      <button onClick={handleSubmit} disabled={!canSubmit || isPending || uploading}
        className="w-full py-2.5 bg-green-500 hover:bg-green-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-sm transition-colors">
        {isPending || uploading ? 'Submitting...' : 'Complete RO Handover'}
      </button>
    </div>
  )
}
