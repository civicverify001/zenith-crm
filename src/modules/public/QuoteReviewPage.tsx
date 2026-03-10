// src/modules/public/QuoteReviewPage.tsx
// Two-step flow: 1) Review & accept quote  2) Sign rental agreement (if rental)
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'

const LOGO_URL = '/zenith-logo.png'
const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—'
const fmtLong = (s: string | null) => s ? new Date(s).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'

type QuoteData = { id: string; quote_number: string; status: string; commercial_type: string; subtotal: number; tax_amount: number; total: number; notes: string | null; valid_until: string | null; sent_at: string | null; accepted_at: string | null; declined_at: string | null; created_at: string; line_items: any[]; customer_name: string; customer_email: string; customer_phone: string; customer_address: string }
type AgreementData = { contract: any; customer: any; quote: any; terms: Record<string, string> }
type Step = 'quote' | 'agreement' | 'complete'

/* ─── Signature Pad ─────────────────────────────────────────── */
function SignaturePad({ onSignature }: { onSignature: (data: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drawing, setDrawing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)
  const getPos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const c = canvasRef.current!; const r = c.getBoundingClientRect(); const sx = c.width / r.width; const sy = c.height / r.height
    if ('touches' in e) return { x: (e.touches[0].clientX - r.left) * sx, y: (e.touches[0].clientY - r.top) * sy }
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy }
  }, [])
  function startDraw(e: React.MouseEvent | React.TouchEvent) { e.preventDefault(); const ctx = canvasRef.current?.getContext('2d'); if (!ctx) return; setDrawing(true); setHasDrawn(true); const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y) }
  function draw(e: React.MouseEvent | React.TouchEvent) { if (!drawing) return; e.preventDefault(); const ctx = canvasRef.current?.getContext('2d'); if (!ctx) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke() }
  function endDraw() { setDrawing(false); if (canvasRef.current && hasDrawn) onSignature(canvasRef.current.toDataURL('image/png')) }
  function clear() { const c = canvasRef.current; if (!c) return; c.getContext('2d')?.clearRect(0, 0, c.width, c.height); setHasDrawn(false); onSignature('') }
  return (
    <div>
      <div style={{ position: 'relative', border: '1px solid #cbd5e1', borderBottom: '2px solid #0f172a', borderRadius: 4, background: '#fafafa', overflow: 'hidden' }}>
        <canvas ref={canvasRef} width={720} height={160} style={{ width: '100%', maxWidth: 360, height: 80, cursor: 'crosshair', display: 'block', touchAction: 'none' }}
          onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw} onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw} />
        {!hasDrawn && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', color: '#94a3b8', fontSize: 14, pointerEvents: 'none' }}>Sign here</div>}
      </div>
      {hasDrawn && <button onClick={clear} style={{ marginTop: 6, background: 'none', border: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>Clear signature</button>}
    </div>
  )
}

/* ─── Signature Block (reusable) ─────────────────────────────── */
function SignatureBlock({ sigMode, setSigMode, typedSig, setTypedSig, drawnSig, setDrawnSig, agreedTerms, setAgreedTerms, agreedLabel }: any) {
  const hasSig = sigMode === 'type' ? typedSig.trim().length > 0 : drawnSig.length > 0
  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 20 }}>
        <input type="checkbox" checked={agreedTerms} onChange={(e: any) => setAgreedTerms(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18, accentColor: '#0c4a6e' }} />
        <span style={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>{agreedLabel}</span>
      </label>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', marginBottom: 8 }}>SIGNATURE</div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {(['draw', 'type'] as const).map(m => (
            <button key={m} onClick={() => setSigMode(m)} style={{ padding: '6px 16px', borderRadius: 6, border: `1px solid ${sigMode === m ? '#0c4a6e' : '#cbd5e1'}`, background: sigMode === m ? '#0c4a6e' : '#fff', color: sigMode === m ? '#fff' : '#475569', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              {m === 'draw' ? '✍ Draw' : '⌨ Type'}
            </button>
          ))}
        </div>
        {sigMode === 'draw' ? <SignaturePad onSignature={setDrawnSig} /> : (
          <input type="text" value={typedSig} onChange={(e: any) => setTypedSig(e.target.value)} placeholder="Type your full name"
            style={{ width: '100%', maxWidth: 360, padding: '12px 16px', fontSize: 20, fontFamily: '"Brush Script MT", "Segoe Script", cursive', border: '1px solid #cbd5e1', borderBottom: '2px solid #0f172a', borderRadius: 4, outline: 'none', boxSizing: 'border-box' as const, background: '#fafafa' }} />
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════ */
/*  MAIN PAGE                                                     */
/* ═══════════════════════════════════════════════════════════════ */
export function QuoteReviewPage() {
  const { token } = useParams<{ token: string }>()
  const [quote, setQuote] = useState<QuoteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<Step>('quote')
  const [showDecline, setShowDecline] = useState(false)
  const [declineReason, setDeclineReason] = useState('')

  // Quote signature
  const [qSigMode, setQSigMode] = useState<'draw' | 'type'>('draw')
  const [qTypedSig, setQTypedSig] = useState('')
  const [qDrawnSig, setQDrawnSig] = useState('')
  const [qAgreed, setQAgreed] = useState(false)
  const qSig = qSigMode === 'type' ? qTypedSig.trim() : qDrawnSig
  const qHasSig = qSig.length > 0

  // Agreement data + signature
  const [agreement, setAgreement] = useState<AgreementData | null>(null)
  const [aSigMode, setASigMode] = useState<'draw' | 'type'>('draw')
  const [aTypedSig, setATypedSig] = useState('')
  const [aDrawnSig, setADrawnSig] = useState('')
  const [aAgreed, setAAgreed] = useState(false)
  const aSig = aSigMode === 'type' ? aTypedSig.trim() : aDrawnSig
  const aHasSig = aSig.length > 0

  const [finalMessage, setFinalMessage] = useState('')

  useEffect(() => {
    if (!token) return
    fetch(`/api/quotes/review?token=${token}`)
      .then(r => r.json())
      .then(data => { if (data.error) setError(data.error); else setQuote(data) })
      .catch(() => setError('Unable to load quote'))
      .finally(() => setLoading(false))
  }, [token])

  // ─── Accept quote ───────────────────────────────────────
  async function handleAccept() {
    setBusy(true)
    try {
      const res = await fetch(`/api/quotes/review?token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action: 'accept', signature: qSig }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')

      setQuote(prev => prev ? { ...prev, status: 'accepted' } : null)

      // If rental → load agreement and go to step 2
      if (data.is_rental && data.contract_id) {
        const agRes = await fetch(`/api/contracts/sign?token=${token}`)
        const agData = await agRes.json()
        if (agRes.ok) {
          setAgreement(agData)
          setStep('agreement')
          window.scrollTo({ top: 0, behavior: 'smooth' })
        } else {
          // Contract created but couldn't load agreement — show basic success
          setFinalMessage('Quote accepted! Our team will send you the rental agreement shortly.')
          setStep('complete')
        }
      } else {
        // Non-rental — done
        setFinalMessage('Quote accepted! Our team will contact you shortly to schedule your installation.')
        setStep('complete')
      }
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  // ─── Sign agreement ─────────────────────────────────────
  async function handleSignAgreement() {
    if (!agreement) return
    setBusy(true)
    try {
      const res = await fetch('/api/contracts/sign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contract_id: agreement.contract.id, signature: aSig, signature_type: aSigMode }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Signing failed')
      setFinalMessage('Rental agreement signed! Our team will contact you to schedule your installation.')
      setStep('complete')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  // ─── Decline ────────────────────────────────────────────
  async function handleDecline() {
    setBusy(true)
    try {
      const res = await fetch(`/api/quotes/review?token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action: 'decline', decline_reason: declineReason || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setFinalMessage('Quote declined. Thank you for letting us know. Please contact us if you change your mind.')
      setStep('complete')
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  const page: React.CSSProperties = { minHeight: '100vh', background: '#f1f5f9', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
  if (loading) return <div style={page}><Header /><div style={{ maxWidth: 800, margin: '0 auto', padding: '60px 20px', textAlign: 'center', color: '#64748b' }}>Loading your quote…</div></div>
  if (error && !quote) return <div style={page}><Header /><div style={{ maxWidth: 800, margin: '0 auto', padding: '60px 20px', textAlign: 'center' }}><div style={{ fontSize: 48, marginBottom: 16 }}>😕</div><div style={{ fontSize: 22, fontWeight: 700, color: '#1e293b' }}>Quote Not Found</div><div style={{ fontSize: 15, color: '#64748b', marginTop: 8 }}>{error}</div></div></div>
  if (!quote) return null

  const isActionable = ['sent', 'viewed'].includes(quote.status) && step === 'quote'
  const isExpired = quote.valid_until && new Date(quote.valid_until) < new Date()
  const typeLabel = quote.commercial_type === 'rental' ? 'Rental' : quote.commercial_type === 'financed' ? 'Financed' : 'Purchase'

  return (
    <div style={page}>
      <Header />

      {/* ─── Step indicator for rental ─────────────────────── */}
      {quote.commercial_type === 'rental' && step !== 'complete' && (
        <div style={{ maxWidth: 800, margin: '20px auto 0', padding: '0 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
            <StepDot active={step === 'quote'} done={step === 'agreement'} label="1. Review Quote" />
            <div style={{ width: 40, height: 2, background: step === 'agreement' ? '#0c4a6e' : '#cbd5e1' }} />
            <StepDot active={step === 'agreement'} done={false} label="2. Sign Agreement" />
          </div>
        </div>
      )}

      {/* ─── Complete / Success ─────────────────────────────── */}
      {step === 'complete' && (
        <div style={{ maxWidth: 800, margin: '24px auto 0', padding: '0 20px' }}>
          <div style={{ padding: 32, borderRadius: 12, textAlign: 'center', background: finalMessage.includes('declined') ? '#fef2f2' : '#f0fdf4', border: `1px solid ${finalMessage.includes('declined') ? '#fecaca' : '#86efac'}` }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>{finalMessage.includes('declined') ? '❌' : '✅'}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: finalMessage.includes('declined') ? '#dc2626' : '#16a34a', marginBottom: 10 }}>
              {finalMessage.includes('declined') ? 'Quote Declined' : finalMessage.includes('agreement signed') ? 'Agreement Signed!' : 'Quote Accepted!'}
            </div>
            <div style={{ fontSize: 15, color: '#475569', maxWidth: 500, margin: '0 auto' }}>{finalMessage}</div>
          </div>
        </div>
      )}

      {/* ─── STEP 2: Rental Agreement ──────────────────────── */}
      {step === 'agreement' && agreement && (
        <div style={{ maxWidth: 800, margin: '24px auto', padding: '0 20px 40px' }}>
          <div style={{ background: '#fff', borderRadius: 4, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>

            {/* Agreement Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '28px 40px 24px', borderBottom: '3px solid #0c4a6e' }}>
              <img src={LOGO_URL} alt="Zenith Pure Solutions" style={{ height: 90, objectFit: 'contain' }} />
              <div style={{ textAlign: 'right', fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700 }}>Zenith Pure Solutions LLC</div>
                <div>6951 E 30th, Suite B</div><div>Indianapolis IN 46219</div>
              </div>
            </div>

            {/* Title */}
            <div style={{ padding: '28px 40px 20px', borderBottom: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#0f172a' }}>RENTAL AGREEMENT</div>
              <div style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>
                For Quote {agreement.quote?.quote_number} · Effective {fmtLong(new Date().toISOString())}
              </div>
            </div>

            {/* Parties */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, padding: '24px 40px', borderBottom: '1px solid #e2e8f0' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', marginBottom: 8 }}>PROVIDER</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>Zenith Pure Solutions LLC</div>
                <div style={{ fontSize: 13, color: '#475569' }}>6951 E 30th, Suite B, Indianapolis IN 46219</div>
                <div style={{ fontSize: 13, color: '#475569' }}>+1 (317) 690-4172</div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', marginBottom: 8 }}>CUSTOMER</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{agreement.customer.name}</div>
                {agreement.customer.address && <div style={{ fontSize: 13, color: '#475569' }}>{agreement.customer.address}</div>}
                {agreement.customer.phone && <div style={{ fontSize: 13, color: '#475569' }}>{agreement.customer.phone}</div>}
                {agreement.customer.email && <div style={{ fontSize: 13, color: '#475569' }}>{agreement.customer.email}</div>}
              </div>
            </div>

            {/* Equipment & Pricing */}
            {agreement.quote && (
              <div style={{ padding: '24px 40px', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>EQUIPMENT & PRICING</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #0c4a6e' }}>
                      {['Description', 'Qty', 'Monthly Rate'].map((h, i) => (
                        <th key={h} style={{ padding: '8px', fontSize: 11, fontWeight: 700, color: '#0f172a', textAlign: i >= 1 ? 'right' : 'left' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {agreement.quote.line_items.map((li: any, i: number) => (
                      <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '10px 8px', fontSize: 13, color: '#1e293b' }}>{li.description}</td>
                        <td style={{ padding: '10px 8px', fontSize: 13, textAlign: 'right' }}>{li.quantity}</td>
                        <td style={{ padding: '10px 8px', fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{fmt(li.unit_price)}/mo</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: 12, padding: '12px 16px', background: '#f0f9ff', borderRadius: 8, border: '1px solid #bae6fd' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0c4a6e' }}>Monthly Payment: {fmt(agreement.contract.monthly_amount)}</span>
                  <span style={{ fontSize: 12, color: '#64748b', marginLeft: 12 }}>Due on day {agreement.contract.billing_day} of each month</span>
                </div>
              </div>
            )}

            {/* Terms & Conditions */}
            <div style={{ padding: '24px 40px' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 16 }}>TERMS & CONDITIONS</div>
              {Object.entries(agreement.terms).map(([key, value]) => (
                <div key={key} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#0c4a6e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    {key.replace(/_/g, ' ')}
                  </div>
                  <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.7 }}>{value}</div>
                </div>
              ))}
            </div>

            <div style={{ margin: '0 40px', borderTop: '2px solid #0c4a6e' }} />

            {/* Sign Agreement */}
            <div style={{ padding: '28px 40px 32px' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 16 }}>SIGN RENTAL AGREEMENT</div>

              <SignatureBlock
                sigMode={aSigMode} setSigMode={setASigMode}
                typedSig={aTypedSig} setTypedSig={setATypedSig}
                drawnSig={aDrawnSig} setDrawnSig={setADrawnSig}
                agreedTerms={aAgreed} setAgreedTerms={setAAgreed}
                agreedLabel="I have read and agree to all terms above. I authorize Zenith Pure Solutions to install the equipment and charge the monthly rental amount to my payment method on file."
              />

              <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
                <button onClick={handleSignAgreement} disabled={busy || !aAgreed || !aHasSig}
                  style={{ padding: '14px 48px', borderRadius: 6, border: 'none', cursor: aAgreed && aHasSig ? 'pointer' : 'not-allowed', fontSize: 15, fontWeight: 700, color: '#fff', background: aAgreed && aHasSig ? '#16a34a' : '#94a3b8', opacity: busy ? 0.6 : 1, boxShadow: aAgreed && aHasSig ? '0 2px 8px rgba(22,163,74,0.3)' : 'none' }}>
                  {busy ? 'Signing…' : '✓ Sign Rental Agreement'}
                </button>
              </div>
            </div>

            <div style={{ padding: '16px 40px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>Engineered for purity. Installed with care. Backed by Zenith Pure Solutions.</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Agreement Date: {new Date().toLocaleDateString('en-US')}</div>
            </div>
          </div>
        </div>
      )}

      {/* ─── STEP 1: Quote Review (always shown except during agreement step) ── */}
      {(step === 'quote' || step === 'complete') && (
        <div style={{ maxWidth: 800, margin: '24px auto', padding: '0 20px 40px' }}>
          <div style={{ background: '#fff', borderRadius: 4, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>

            {/* Company Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '28px 40px 24px', borderBottom: '3px solid #0c4a6e' }}>
              <img src={LOGO_URL} alt="Zenith Pure Solutions" style={{ height: 90, objectFit: 'contain' }} />
              <div style={{ textAlign: 'right', fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700 }}>Zenith Pure Solutions LLC</div>
                <div>6951 E 30th, Suite B</div><div>Indianapolis IN 46219</div><div>United States</div>
              </div>
            </div>

            {/* Bill To */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, padding: '24px 40px', borderBottom: '1px solid #e2e8f0' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', marginBottom: 8 }}>BILL TO:</div>
                <div style={{ fontSize: 14, color: '#1e293b', fontWeight: 600 }}>{quote.customer_name}</div>
                {quote.customer_address && <div style={{ fontSize: 13, color: '#475569', marginTop: 2 }}>{quote.customer_address}</div>}
                <div style={{ fontSize: 13, color: '#475569' }}>United States</div>
                {quote.customer_phone && <div style={{ fontSize: 13, color: '#475569', marginTop: 2 }}>{quote.customer_phone}</div>}
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', marginBottom: 8 }}>INSTALLATION ADDRESS</div>
                <div style={{ fontSize: 14, color: '#1e293b', fontWeight: 600 }}>{quote.customer_name}</div>
                {quote.customer_address && <div style={{ fontSize: 13, color: '#475569', marginTop: 2 }}>{quote.customer_address}</div>}
                <div style={{ fontSize: 13, color: '#475569' }}>United States</div>
                {quote.customer_email && <div style={{ fontSize: 13, color: '#475569', marginTop: 2 }}>{quote.customer_email}</div>}
              </div>
            </div>

            {/* Quote Title */}
            <div style={{ padding: '28px 40px 20px' }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#0f172a' }}>QUOTATION # {quote.quote_number}</div>
              <div style={{ display: 'flex', gap: 48, marginTop: 16, flexWrap: 'wrap' }}>
                {[{ l: 'QUOTATION DATE', v: fmtDate(quote.sent_at || quote.created_at) }, { l: 'EXPIRATION', v: quote.valid_until ? fmtDate(quote.valid_until) : '—' }, { l: 'TYPE', v: typeLabel }].map(i => (
                  <div key={i.l}><div style={{ fontSize: 10, fontWeight: 700, color: '#0c4a6e', letterSpacing: '0.08em' }}>{i.l}</div><div style={{ fontSize: 14, color: '#1e293b', marginTop: 4 }}>{i.v}</div></div>
                ))}
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#0c4a6e', letterSpacing: '0.08em' }}>STATUS</div>
                  <div style={{ display: 'inline-block', marginTop: 4, padding: '2px 10px', borderRadius: 4, fontSize: 12, fontWeight: 700, background: quote.status === 'accepted' ? '#dcfce7' : quote.status === 'declined' ? '#fee2e2' : '#dbeafe', color: quote.status === 'accepted' ? '#16a34a' : quote.status === 'declined' ? '#dc2626' : '#2563eb' }}>
                    {quote.status.charAt(0).toUpperCase() + quote.status.slice(1)}
                  </div>
                </div>
              </div>
            </div>

            {/* Notes */}
            {quote.notes && (
              <div style={{ padding: '0 40px 20px' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>ESTIMATION DETAILS</div>
                <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{quote.notes}</div>
              </div>
            )}

            {/* Line Items */}
            <div style={{ padding: '0 40px 24px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '2px solid #0c4a6e', borderTop: '2px solid #0c4a6e' }}>
                  {['Code', 'Name and Description', 'Qty', 'Unit Price', 'Total'].map((h, i) => (
                    <th key={h} style={{ padding: '10px 8px', fontSize: 11, fontWeight: 700, color: '#0f172a', textAlign: i >= 2 ? 'right' : 'left' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {quote.line_items.map((li: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '12px 8px', fontSize: 12, color: '#0c4a6e', fontFamily: 'monospace', fontWeight: 600 }}>{li.sku || '—'}</td>
                      <td style={{ padding: '12px 8px', fontSize: 13, color: '#1e293b' }}>{li.description}</td>
                      <td style={{ padding: '12px 8px', fontSize: 13, textAlign: 'right' }}>{li.quantity}</td>
                      <td style={{ padding: '12px 8px', fontSize: 13, textAlign: 'right' }}>{fmt(li.unit_price)}</td>
                      <td style={{ padding: '12px 8px', fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{fmt(li.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={3} /><td style={{ padding: '8px', fontSize: 13, color: '#64748b', textAlign: 'right' }}>Subtotal</td><td style={{ padding: '8px', fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{fmt(quote.subtotal)}</td></tr>
                  <tr><td colSpan={3} /><td style={{ padding: '8px', fontSize: 13, color: '#64748b', textAlign: 'right' }}>Taxes</td><td style={{ padding: '8px', fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{fmt(quote.tax_amount)}</td></tr>
                  <tr style={{ borderTop: '2px solid #0c4a6e' }}><td colSpan={3} /><td style={{ padding: '12px 8px', fontSize: 15, fontWeight: 800, textAlign: 'right' }}>Total</td><td style={{ padding: '12px 8px', fontSize: 18, fontWeight: 800, textAlign: 'right' }}>{fmt(quote.total)}</td></tr>
                </tfoot>
              </table>
            </div>

            <div style={{ margin: '0 40px', borderTop: '1px solid #cbd5e1' }} />

            {/* Authorization */}
            <div style={{ padding: '24px 40px' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>CUSTOMER AUTHORIZATION</div>
              <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.8 }}>
                <p>This is an estimate, not a final invoice or contract for services.</p>
                <p style={{ marginTop: 8 }}>The summary above is a good-faith estimate based on our evaluation of the work to be performed at the installation address. It does not include potential material price changes or any additional labor or materials that may be required if unforeseen conditions arise during installation.</p>
                <p style={{ marginTop: 8 }}>I understand that the final cost of the work may differ from this estimate if extra materials, modifications, or labor are required. This estimate does not guarantee the final price of the work to be performed.</p>
                <p style={{ marginTop: 8 }}>By approving this estimate, I authorize Zenith Pure Solutions to proceed as outlined and agree to pay the full amount for all services rendered.</p>
                <p style={{ marginTop: 8 }}><a href="https://zenithpuresolutions.com/terms" target="_blank" rel="noopener noreferrer" style={{ color: '#0c4a6e', fontWeight: 600, textDecoration: 'underline' }}>Click here to view Terms &amp; Conditions</a></p>
              </div>
            </div>

            <div style={{ margin: '0 40px', borderTop: '1px solid #cbd5e1' }} />

            {/* ACH */}
            <div style={{ padding: '24px 40px' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>DIRECT TRANSFER / ACH DETAILS</div>
              <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 480 }}>
                {[['Bank Name:', 'Old National Bank'], ['ACH ABA Number:', '086300012'], ['Account Number:', '0127726846'], ['Account Name:', 'ZENITH PURE SOLUTIONS LLC'], ['Email:', 'accounts@zenithpuresolutions.com'], ['Phone Number:', '+1 (317) 690-4172']].map(([l, v]) => (
                  <tr key={l} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: 700, color: '#1e293b', background: '#f8fafc', width: 180 }}>{l}</td>
                    <td style={{ padding: '8px 12px', fontSize: 13, color: '#475569' }}>{v}</td>
                  </tr>
                ))}
              </table>
            </div>

            {/* Accept/Decline */}
            {isActionable && !isExpired && (
              <>
                <div style={{ margin: '0 40px', borderTop: '2px solid #0c4a6e' }} />
                <div style={{ padding: '28px 40px 32px' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 16 }}>
                    {quote.commercial_type === 'rental' ? 'STEP 1: ACCEPT THIS QUOTE' : 'ACCEPT THIS QUOTE'}
                  </div>
                  {quote.commercial_type === 'rental' && (
                    <div style={{ padding: '10px 16px', background: '#f0f9ff', borderRadius: 8, border: '1px solid #bae6fd', fontSize: 13, color: '#0369a1', marginBottom: 16 }}>
                      After accepting, you'll be asked to review and sign the rental agreement.
                    </div>
                  )}
                  {!showDecline ? (
                    <div>
                      <SignatureBlock
                        sigMode={qSigMode} setSigMode={setQSigMode}
                        typedSig={qTypedSig} setTypedSig={setQTypedSig}
                        drawnSig={qDrawnSig} setDrawnSig={setQDrawnSig}
                        agreedTerms={qAgreed} setAgreedTerms={setQAgreed}
                        agreedLabel="I have read and agree to the terms above. I authorize Zenith Pure Solutions to proceed as outlined in this quote."
                      />
                      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
                        <button onClick={handleAccept} disabled={busy || !qAgreed || !qHasSig}
                          style={{ padding: '14px 48px', borderRadius: 6, border: 'none', cursor: qAgreed && qHasSig ? 'pointer' : 'not-allowed', fontSize: 15, fontWeight: 700, color: '#fff', background: qAgreed && qHasSig ? '#16a34a' : '#94a3b8', opacity: busy ? 0.6 : 1, boxShadow: qAgreed && qHasSig ? '0 2px 8px rgba(22,163,74,0.3)' : 'none' }}>
                          {busy ? 'Processing…' : quote.commercial_type === 'rental' ? '✓ Accept & Continue to Agreement' : '✓ Accept & Authorize'}
                        </button>
                        <button onClick={() => setShowDecline(true)} disabled={busy}
                          style={{ padding: '14px 28px', borderRadius: 6, border: '1px solid #fecaca', background: '#fff', color: '#dc2626', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                          Decline
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ maxWidth: 460 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', marginBottom: 8 }}>Would you like to tell us why? (optional)</div>
                      <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)} placeholder="e.g. Price too high, timing isn't right…" rows={3}
                        style={{ width: '100%', borderRadius: 6, border: '1px solid #cbd5e1', padding: '10px 14px', fontSize: 14, resize: 'none', outline: 'none', boxSizing: 'border-box' as const, marginBottom: 12 }} />
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button onClick={() => setShowDecline(false)} style={{ padding: '10px 24px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Go Back</button>
                        <button onClick={handleDecline} disabled={busy} style={{ padding: '10px 24px', borderRadius: 6, border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: busy ? 0.6 : 1 }}>{busy ? 'Processing…' : 'Confirm Decline'}</button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {isExpired && step === 'quote' && (
              <div style={{ padding: '24px 40px', background: '#fefce8', borderTop: '1px solid #fde68a' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#92400e' }}>This Quote Has Expired</div>
                <div style={{ fontSize: 13, color: '#a16207', marginTop: 4 }}>Please contact Zenith Pure Solutions at <strong>+1 (317) 690-4172</strong> for an updated quote.</div>
              </div>
            )}

            <div style={{ padding: '16px 40px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>Engineered for purity. Installed with care. Backed by Zenith Pure Solutions.</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Quote Version: {new Date(quote.created_at).toLocaleString('en-US')}</div>
            </div>
          </div>
        </div>
      )}

      {error && quote && <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 20px', textAlign: 'center' }}><div style={{ color: '#dc2626', fontSize: 14, fontWeight: 600 }}>{error}</div></div>}
    </div>
  )
}

/* ─── Sub-components ───────────────────────────────────────── */
function Header() {
  return (
    <div style={{ background: '#0c4a6e', padding: '12px 0', textAlign: 'center' }}>
      <img src={LOGO_URL} alt="Zenith Pure Solutions" style={{ height: 50, objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
    </div>
  )
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700,
        background: done ? '#16a34a' : active ? '#0c4a6e' : '#e2e8f0',
        color: done || active ? '#fff' : '#94a3b8',
      }}>
        {done ? '✓' : active ? '●' : '○'}
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: active ? '#0c4a6e' : done ? '#16a34a' : '#94a3b8' }}>{label}</span>
    </div>
  )
}
