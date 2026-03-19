// src/modules/invoices/InvoiceThankYouPage.tsx
// Redirect target after Stripe payment link is completed

export default function InvoiceThankYouPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f1923', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 64, marginBottom: 20 }}>✅</div>
        <h1 style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 26, marginBottom: 12 }}>Payment Received!</h1>
        <p style={{ color: '#64748b', fontSize: 15, lineHeight: 1.6, marginBottom: 24 }}>
          Thank you for your payment. Zenith Pure Solutions will be in touch shortly.
        </p>
        <p style={{ color: '#475569', fontSize: 13 }}>
          Questions? Call us at <a href="tel:3176904172" style={{ color: '#0d7ea3' }}>(317) 690-4172</a>
        </p>
      </div>
    </div>
  )
}
