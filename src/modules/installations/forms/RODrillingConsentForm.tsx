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

export function RODrillingConsentForm({ jobId, formType, onSubmit, isPending }: Props) {
  const [customerName, setCustomerName] = useState('')
  const [countertopMaterial, setCountertopMaterial] = useState('')
  const [acknowledgeRisk, setAcknowledgeRisk] = useState(false)
  const [authorizeWork, setAuthorizeWork] = useState(false)
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)

  const canSubmit = customerName.trim() && acknowledgeRisk && authorizeWork && signatureDataUrl

  async function handleSubmit() {
    if (!canSubmit) { setError('All acknowledgments, customer name, and signature required'); return }
    setError('')
    setUploading(true)
    try {
      let signatureUrl: string | null = null
      try { signatureUrl = await uploadSignature(jobId, signatureDataUrl!, formType) }
      catch { signatureUrl = `local_consent_sig_${customerName.trim()}_${Date.now()}` }

      await onSubmit({
        customer_name: customerName.trim(), countertop_material: countertopMaterial.trim() || null,
        acknowledge_risk: true, authorize_work: true, signature_captured: true,
        consent_date: new Date().toISOString(),
      }, signatureUrl)
    } catch (e: any) { setError(e.message) }
    finally { setUploading(false) }
  }

  return (
    <div className="space-y-4">
      <div className="bg-amber/10 border border-amber/30 rounded-xl p-3">
        <div className="text-sm font-bold text-amber mb-1">⚠️ Drilling Authorization Required</div>
        <div className="text-xs text-slate-300">Must be obtained BEFORE drilling. Customer must be present and sign.</div>
      </div>
      <div className="bg-surface border border-border rounded-lg p-3">
        <div className="text-xs font-semibold text-slate-300 mb-2">CONSENT AGREEMENT</div>
        <div className="text-xs text-muted leading-relaxed">
          I hereby authorize Zenith Pure Solutions LLC to drill a new hole in my countertop/sink area for RO faucet installation.
          I understand this is permanent and cannot be undone without professional repair.
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Customer Name <span className="text-red-400">*</span></label>
        <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Full legal name"
          className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Countertop Material (optional)</label>
        <input type="text" value={countertopMaterial} onChange={e => setCountertopMaterial(e.target.value)} placeholder="Granite, Quartz..."
          className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent" />
      </div>
      <div className="space-y-2">
        {[
          { state: acknowledgeRisk, toggle: () => setAcknowledgeRisk(!acknowledgeRisk), text: 'I understand this is permanent and accept the risks.' },
          { state: authorizeWork, toggle: () => setAuthorizeWork(!authorizeWork), text: 'I authorize Zenith Pure Solutions to proceed with drilling.' },
        ].map((item, i) => (
          <div key={i} onClick={item.toggle}
            className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${item.state ? 'border-amber/50 bg-amber/5' : 'border-border'}`}>
            <div className={`w-5 h-5 rounded border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${item.state ? 'bg-amber border-amber text-white' : 'border-muted'}`}>
              {item.state && <span className="text-xs">✓</span>}
            </div>
            <div className="text-sm text-slate-200">{item.text}</div>
          </div>
        ))}
      </div>
      <div>
        <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Customer Signature <span className="text-red-400">*</span></label>
        <SignatureCanvas onCapture={setSignatureDataUrl} onClear={() => setSignatureDataUrl(null)} />
      </div>
      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>}
      <button onClick={handleSubmit} disabled={!canSubmit || isPending || uploading}
        className="w-full py-2.5 bg-amber hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-sm transition-colors">
        {isPending || uploading ? 'Saving...' : 'Record Drilling Consent'}
      </button>
    </div>
  )
}
