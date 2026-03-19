// src/modules/communications/CommunicationsPage.tsx
// SMS Inbox — view all conversations, send to any number or linked lead/customer
// Threads grouped by phone number, matched to leads/customers automatically

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useNavigate } from 'react-router-dom'

// ─── Types ────────────────────────────────────────────────────
interface CommRecord {
  id: string
  entity_type: string
  entity_id: string | null
  direction: string
  channel: string
  from_number: string
  to_number: string
  body: string
  status: string
  sent_by: string | null
  created_at: string
}

interface Thread {
  phone: string
  name: string | null
  entity_type: string | null
  entity_id: string | null
  lastMessage: string
  lastTime: string
  direction: string
  unread: number
}

// ─── Helpers ──────────────────────────────────────────────────
function formatPhone(p: string) {
  if (!p) return ''
  const d = p.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
  return p
}

function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function timeStamp(dateStr: string): string {
  const d = new Date(dateStr)
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (isToday) return time
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`
}

const OPENPHONE_NUMBER = '4633005100'

const SMS_TEMPLATES = [
  { label: 'Appointment Reminder', body: 'Hi {name}, this is Zenith Pure Solutions. Just a reminder about your upcoming appointment. Please reply to confirm or call us at (317) 690-4172 to reschedule.' },
  { label: 'Quote Follow-Up', body: 'Hi {name}, this is Zenith Pure Solutions. We sent you a quote recently — did you have any questions? We\'d love to help. Reply here or call (317) 690-4172.' },
  { label: 'Payment Reminder', body: 'Hi {name}, this is Zenith Pure Solutions. We noticed a payment is due on your account. Please call us at (317) 690-4172 or reply to this message for assistance.' },
  { label: 'Install Scheduled', body: 'Hi {name}, your installation with Zenith Pure Solutions is scheduled! Our technician will arrive at the confirmed time. Questions? Call (317) 690-4172.' },
  { label: 'Thank You', body: 'Hi {name}, thank you for choosing Zenith Pure Solutions! If you have any questions about your water system, reply here or call (317) 690-4172.' },
]

// ─── New Message Modal ────────────────────────────────────────

function NewMessageModal({ onClose, onSent, profile }: {
  onClose: () => void
  onSent: () => void
  profile: any
}) {
  const [phone, setPhone] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

  async function handleSend() {
    if (!phone || !body) return
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 10) { setError('Enter a valid 10-digit phone number'); return }
    setSending(true); setError('')
    try {
      const res = await fetch('/api/openphone/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: digits,
          body,
          entity_type: 'unknown',
          entity_id: null,
          sent_by: profile?.id || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to send'); setSending(false); return }
      setSuccess(true)
      setTimeout(() => { onSent(); onClose() }, 1000)
    } catch (e: any) {
      setError(e.message || 'Network error')
    }
    setSending(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
      <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 16, width: '100%', maxWidth: 480, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #1e3a4f', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 17 }}>New Text Message</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 6, fontWeight: 600 }}>Phone Number</label>
          <input
            value={phone} onChange={e => setPhone(e.target.value)}
            placeholder="(317) 555-1234"
            style={{ width: '100%', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 16 }}
          />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <label style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Message</label>
            <button onClick={() => setShowTemplates(!showTemplates)}
              style={{ fontSize: 11, color: '#0d7ea3', background: 'rgba(13,126,163,0.1)', border: '1px solid rgba(13,126,163,0.25)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontWeight: 600 }}>
              {showTemplates ? 'Hide Templates' : 'Use Template'}
            </button>
          </div>

          {showTemplates && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {SMS_TEMPLATES.map(t => (
                <button key={t.label} onClick={() => { setBody(t.body); setShowTemplates(false) }}
                  style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, border: '1px solid #1e3a4f', background: '#162232', color: '#94a3b8', cursor: 'pointer' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#0d7ea3'; (e.currentTarget as HTMLElement).style.color = '#e2e8f0' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1e3a4f'; (e.currentTarget as HTMLElement).style.color = '#94a3b8' }}>
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <textarea
            value={body} onChange={e => setBody(e.target.value)}
            placeholder="Type your message…"
            rows={4}
            style={{ width: '100%', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
          />
          <div style={{ fontSize: 11, color: '#334155', marginTop: 4 }}>{body.length} characters · {Math.ceil(body.length / 160) || 0} segment{Math.ceil(body.length / 160) !== 1 ? 's' : ''}</div>

          {error && <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', fontSize: 13 }}>{error}</div>}
          {success && <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', color: '#4ade80', fontSize: 13 }}>Message sent!</div>}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid #1e3a4f', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 18px', fontSize: 13, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSend} disabled={sending || !phone || !body || success}
            style={{ padding: '10px 24px', borderRadius: 8, border: 'none', cursor: 'pointer', background: (!phone || !body || success) ? '#334155' : '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 14, opacity: sending ? 0.5 : 1 }}>
            {sending ? 'Sending…' : success ? 'Sent!' : 'Send SMS'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Conversation View ────────────────────────────────────────

function ConversationView({ phone, name, entityType, entityId, profile, onBack }: {
  phone: string; name: string | null; entityType: string | null; entityId: string | null; profile: any; onBack: () => void
}) {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<CommRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('communications_log')
      .select('*')
      .or(`from_number.eq.${phone},to_number.eq.${phone}`)
      .eq('channel', 'sms')
      .order('created_at', { ascending: true })
      .limit(100)
    setMessages(data || [])
    setLoading(false)
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }, [phone])

  useEffect(() => { load() }, [load])

  async function handleReply() {
    if (!reply.trim()) return
    setSending(true)
    try {
      const res = await fetch('/api/openphone/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: phone,
          body: reply,
          entity_type: entityType || 'unknown',
          entity_id: entityId || null,
          sent_by: profile?.id || null,
        }),
      })
      if (res.ok) {
        setReply('')
        setShowTemplates(false)
        setTimeout(load, 500) // reload after short delay for webhook to log
      }
    } catch (e) { console.error(e) }
    setSending(false)
  }

  const displayName = name || formatPhone(phone)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: '#162232', borderBottom: '1px solid #1e3a4f', borderRadius: '12px 12px 0 0' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 14, cursor: 'pointer', padding: '4px 8px' }}>← Back</button>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(13,126,163,0.2)', border: '2px solid rgba(13,126,163,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0d7ea3', fontWeight: 800, fontSize: 14 }}>
          {(name || '?').charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>{displayName}</div>
          <div style={{ color: '#475569', fontSize: 11 }}>{formatPhone(phone)}{entityType && entityType !== 'unknown' ? ` · ${entityType}` : ''}</div>
        </div>
        {entityType && entityId && entityType !== 'unknown' && (
          <button onClick={() => navigate(entityType === 'lead' ? `/leads?lead=${entityId}` : `/customers/${entityId}`)}
            style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(13,126,163,0.25)', background: 'rgba(13,126,163,0.1)', color: '#0d7ea3', cursor: 'pointer', fontWeight: 600 }}>
            View {entityType === 'lead' ? 'Lead' : 'Customer'} →
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Loading messages…</div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#334155', fontSize: 13 }}>No messages yet. Send the first text below.</div>
        ) : messages.map(m => {
          const isOutbound = m.direction === 'outbound'
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: isOutbound ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '75%',
                padding: '10px 14px',
                borderRadius: isOutbound ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                background: isOutbound ? '#0d7ea3' : '#1e3a4f',
                color: isOutbound ? '#ffffff' : '#e2e8f0',
                fontSize: 14,
                lineHeight: 1.5,
              }}>
                <div>{m.body}</div>
                <div style={{ fontSize: 10, marginTop: 4, opacity: 0.6, textAlign: isOutbound ? 'right' : 'left' }}>
                  {timeStamp(m.created_at)}{isOutbound ? ' · Sent' : ''}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Templates */}
      {showTemplates && (
        <div style={{ flexShrink: 0, padding: '8px 18px', borderTop: '1px solid #1e3a4f', background: '#0f1923', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {SMS_TEMPLATES.map(t => (
            <button key={t.label} onClick={() => { setReply(t.body.replace('{name}', name || 'there')); setShowTemplates(false) }}
              style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, border: '1px solid #1e3a4f', background: '#162232', color: '#94a3b8', cursor: 'pointer' }}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Reply bar */}
      <div style={{ flexShrink: 0, padding: '12px 18px', borderTop: '1px solid #1e3a4f', background: '#0f1923', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <button onClick={() => setShowTemplates(!showTemplates)}
          style={{ padding: '8px', borderRadius: 8, border: '1px solid #1e3a4f', background: '#162232', color: '#64748b', cursor: 'pointer', fontSize: 14, flexShrink: 0 }}
          title="SMS Templates">
          ≡
        </button>
        <textarea
          value={reply} onChange={e => setReply(e.target.value)}
          placeholder="Type a message…"
          rows={1}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply() } }}
          style={{ flex: 1, background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', fontSize: 14, outline: 'none', resize: 'none', fontFamily: 'inherit', minHeight: 40, maxHeight: 120 }}
        />
        <button onClick={handleReply} disabled={sending || !reply.trim()}
          style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: (!reply.trim()) ? '#334155' : '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0, opacity: sending ? 0.5 : 1 }}>
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────

export default function CommunicationsPage() {
  const { profile } = useAuth()
  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null)
  const [showNewMessage, setShowNewMessage] = useState(false)

  const loadThreads = useCallback(async () => {
    setLoading(true)
    // Fetch recent communications
    const { data: comms } = await supabase
      .from('communications_log')
      .select('*')
      .eq('channel', 'sms')
      .order('created_at', { ascending: false })
      .limit(500)

    if (!comms || comms.length === 0) { setThreads([]); setLoading(false); return }

    // Group by the other party's phone number
    const threadMap: Record<string, Thread> = {}
    for (const c of comms) {
      const contactPhone = c.direction === 'inbound' ? c.from_number : c.to_number
      if (contactPhone === OPENPHONE_NUMBER) continue // skip our own number
      if (!threadMap[contactPhone]) {
        threadMap[contactPhone] = {
          phone: contactPhone,
          name: null,
          entity_type: c.entity_type !== 'unknown' ? c.entity_type : null,
          entity_id: c.entity_id,
          lastMessage: c.body || '',
          lastTime: c.created_at,
          direction: c.direction,
          unread: 0,
        }
      }
      if (c.direction === 'inbound' && new Date(c.created_at) > new Date(Date.now() - 86400000)) {
        threadMap[contactPhone].unread++
      }
    }

    // Resolve names from leads/customers
    const phones = Object.keys(threadMap)
    if (phones.length > 0) {
      const { data: leads } = await supabase.from('leads').select('id, full_name, phone').in('phone', phones)
      for (const l of (leads || [])) {
        if (threadMap[l.phone]) {
          threadMap[l.phone].name = l.full_name
          threadMap[l.phone].entity_type = 'lead'
          threadMap[l.phone].entity_id = l.id
        }
      }
      const { data: customers } = await supabase.from('customers').select('id, full_name, phone').in('phone', phones)
      for (const c of (customers || [])) {
        if (threadMap[c.phone]) {
          threadMap[c.phone].name = c.full_name
          threadMap[c.phone].entity_type = 'customer'
          threadMap[c.phone].entity_id = c.id
        }
      }
    }

    setThreads(Object.values(threadMap).sort((a, b) => new Date(b.lastTime).getTime() - new Date(a.lastTime).getTime()))
    setLoading(false)
  }, [])

  useEffect(() => { loadThreads() }, [loadThreads])

  // Auto-refresh every 15 seconds
  useEffect(() => {
    const interval = setInterval(loadThreads, 15000)
    return () => clearInterval(interval)
  }, [loadThreads])

  const filteredThreads = threads.filter(t => {
    if (!search) return true
    const q = search.toLowerCase()
    return (t.name || '').toLowerCase().includes(q) || t.phone.includes(q) || (t.lastMessage || '').toLowerCase().includes(q)
  })

  // If a thread is selected, show conversation view
  if (selectedPhone && selectedThread) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <ConversationView
          phone={selectedPhone}
          name={selectedThread.name}
          entityType={selectedThread.entity_type}
          entityId={selectedThread.entity_id}
          profile={profile}
          onBack={() => { setSelectedPhone(null); setSelectedThread(null); loadThreads() }}
        />
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0', margin: 0 }}>Messages</h1>
          <p style={{ fontSize: 13, color: '#475569', marginTop: 4, marginBottom: 0 }}>
            SMS conversations · (463) 300-5100 · {threads.length} thread{threads.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => setShowNewMessage(true)}
          style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          + New Message
        </button>
      </div>

      {/* Search */}
      <div style={{ flexShrink: 0, marginBottom: 14 }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, phone, or message…"
          style={{ width: '100%', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 10, color: '#e2e8f0', padding: '10px 14px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
        />
      </div>

      {/* Thread list */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 14, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Loading conversations…</div>
        ) : filteredThreads.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>💬</div>
            <div style={{ color: '#475569', fontSize: 14, marginBottom: 4 }}>{search ? 'No matches found' : 'No conversations yet'}</div>
            <div style={{ color: '#334155', fontSize: 12 }}>Send a text or have someone text (463) 300-5100</div>
          </div>
        ) : filteredThreads.map(t => (
          <div
            key={t.phone}
            onClick={() => { setSelectedPhone(t.phone); setSelectedThread(t) }}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', cursor: 'pointer', borderBottom: '1px solid #0d1a26' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(13,126,163,0.06)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            {/* Avatar */}
            <div style={{
              width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
              background: t.entity_type === 'customer' ? 'rgba(74,222,128,0.15)' : t.entity_type === 'lead' ? 'rgba(96,165,250,0.15)' : 'rgba(100,116,139,0.15)',
              border: `2px solid ${t.entity_type === 'customer' ? 'rgba(74,222,128,0.3)' : t.entity_type === 'lead' ? 'rgba(96,165,250,0.3)' : 'rgba(100,116,139,0.2)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: t.entity_type === 'customer' ? '#4ade80' : t.entity_type === 'lead' ? '#60a5fa' : '#64748b',
              fontWeight: 800, fontSize: 15, textTransform: 'uppercase',
            }}>
              {(t.name || t.phone).charAt(0)}
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.name || formatPhone(t.phone)}
                </div>
                <div style={{ fontSize: 11, color: '#475569', flexShrink: 0 }}>{timeAgo(t.lastTime)}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                {t.direction === 'outbound' && <span style={{ fontSize: 10, color: '#475569' }}>You:</span>}
                <div style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {t.lastMessage || 'No message'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                {t.entity_type && t.entity_type !== 'unknown' && (
                  <span style={{
                    fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 600,
                    background: t.entity_type === 'customer' ? 'rgba(74,222,128,0.12)' : 'rgba(96,165,250,0.12)',
                    color: t.entity_type === 'customer' ? '#4ade80' : '#60a5fa',
                    border: `1px solid ${t.entity_type === 'customer' ? 'rgba(74,222,128,0.25)' : 'rgba(96,165,250,0.25)'}`,
                  }}>
                    {t.entity_type}
                  </span>
                )}
                <span style={{ fontSize: 10, color: '#334155' }}>{formatPhone(t.phone)}</span>
              </div>
            </div>

            {/* Unread badge */}
            {t.unread > 0 && (
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#0d7ea3', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {t.unread}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* New Message Modal */}
      {showNewMessage && (
        <NewMessageModal onClose={() => setShowNewMessage(false)} onSent={loadThreads} profile={profile} />
      )}
    </div>
  )
}
