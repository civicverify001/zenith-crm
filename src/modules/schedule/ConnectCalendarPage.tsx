// src/modules/schedule/ConnectCalendarPage.tsx
// Team members land here after clicking the Google connect link
// Shows success/error state

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

export function ConnectCalendarPage() {
  const [params] = useSearchParams()
  const status = params.get('status')
  const email  = params.get('email')

  const [state, setState] = useState<'loading' | 'success' | 'denied' | 'error'>('loading')

  useEffect(() => {
    if (status === 'success') setState('success')
    else if (status === 'denied') setState('denied')
    else if (status === 'error') setState('error')
    else setState('loading')
  }, [status])

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0f1923',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 420,
        background: '#162232', border: '1px solid #1e3a4f',
        borderRadius: 20, padding: '40px 32px', textAlign: 'center',
      }}>
        {/* Zenith logo */}
        <div style={{
          width: 56, height: 56, borderRadius: 14, margin: '0 auto 20px',
          background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 24px #3b82f650',
        }}>
          <span style={{ color: '#fff', fontWeight: 900, fontSize: 22 }}>Z</span>
        </div>

        <div style={{ color: '#64748b', fontSize: 12, fontWeight: 600, marginBottom: 24, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          Zenith Pure Solutions CRM
        </div>

        {state === 'loading' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
            <h2 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 20, marginBottom: 8 }}>Connecting...</h2>
            <p style={{ color: '#64748b', fontSize: 14 }}>Setting up your Google Calendar sync.</p>
          </>
        )}

        {state === 'success' && (
          <>
            <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
            <h2 style={{ color: '#4ade80', fontWeight: 700, fontSize: 22, marginBottom: 8 }}>Calendar Connected!</h2>
            {email && (
              <div style={{
                background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)',
                borderRadius: 10, padding: '10px 16px', marginBottom: 20,
                color: '#4ade80', fontSize: 14, fontWeight: 600,
              }}>
                📧 {email}
              </div>
            )}
            <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.7, marginBottom: 24 }}>
              Your Google Calendar is now synced with Zenith CRM.
              <br /><br />
              Every job or site visit assigned to you will automatically appear in your calendar — with the customer's name, address, phone, products, and notes included.
            </p>
            <div style={{
              background: 'rgba(255,255,255,0.03)', border: '1px solid #1e3a4f',
              borderRadius: 10, padding: '12px 16px', textAlign: 'left', marginBottom: 24,
            }}>
              <div style={{ color: '#64748b', fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                What gets synced to your calendar
              </div>
              {[
                '📍 Customer name, address & phone',
                '💧 Products being installed',
                '📋 Lead notes & site visit notes',
                '🔗 Direct link back to the CRM record',
                '⏰ 1 hour + 15 min reminders',
              ].map((item, i) => (
                <div key={i} style={{ color: '#94a3b8', fontSize: 13, marginBottom: 5 }}>{item}</div>
              ))}
            </div>
            <p style={{ color: '#64748b', fontSize: 12 }}>You can close this window. You're all set.</p>
          </>
        )}

        {state === 'denied' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🚫</div>
            <h2 style={{ color: '#f87171', fontWeight: 700, fontSize: 20, marginBottom: 8 }}>Access Denied</h2>
            <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
              You cancelled the Google Calendar connection. No changes were made.
              <br /><br />
              If you want to connect later, ask your admin to resend the connect link.
            </p>
            <p style={{ color: '#64748b', fontSize: 12 }}>You can close this window.</p>
          </>
        )}

        {state === 'error' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h2 style={{ color: '#fbbf24', fontWeight: 700, fontSize: 20, marginBottom: 8 }}>Something Went Wrong</h2>
            <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
              The Google Calendar connection couldn't be completed.
              <br /><br />
              Please ask your admin to resend the connect link and try again.
            </p>
            <p style={{ color: '#64748b', fontSize: 12 }}>You can close this window.</p>
          </>
        )}
      </div>
    </div>
  )
}
