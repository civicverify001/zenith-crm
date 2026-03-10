// src/modules/invoices/InvoicesPage.tsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import {
  fetchInvoices, fetchInvoice, createInvoiceFromQuote,
  markInvoicePaid, voidInvoice, updateInvoiceStatus,
  refreshOverdueInvoices, balanceDue,
  STATUS_LABELS, STATUS_COLORS,
  type Invoice, type InvoiceStatus,
} from '../../services/invoicesService'
import { fetchQuotes } from '../../services/quotesService'
import { supabase } from '../../lib/supabase'
import { createInvoice } from '../../services/invoicesService'

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

function Badge({ status }: { status: InvoiceStatus }) {
  const color = STATUS_COLORS[status]
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold"
      style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}40` }}>
      {STATUS_LABELS[status]}
    </span>
  )
}

function InvoiceDrawer({ invoice, onClose, onRefresh }: { invoice: Invoice; onClose: () => void; onRefresh: () => void }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const isAdmin = profile?.role === 'admin'
  const [busy, setBusy] = useState(false)
  const [payModal, setPayModal] = useState(false)
  const [payAmt, setPayAmt] = useState('')
  const [emailing, setEmailing] = useState(false)
  const [emailMsg, setEmailMsg] = useState('')
  const balance = balanceDue(invoice)
  const paidPct = invoice.total > 0 ? (invoice.amount_paid / invoice.total) * 100 : 0

  async function handleVoid() {
    if (!confirm('Void this invoice?')) return
    setBusy(true)
    try { await voidInvoice(invoice.id); onRefresh(); onClose() }
    catch (e: any) { alert(e.message) } finally { setBusy(false) }
  }
  async function handleMarkSent() {
    setBusy(true)
    try { await updateInvoiceStatus(invoice.id, 'sent'); onRefresh() }
    catch (e: any) { alert(e.message) } finally { setBusy(false) }
  }
  async function handlePay() {
    const amt = parseFloat(payAmt) || invoice.total
    setBusy(true)
    try { await markInvoicePaid(invoice.id, amt); setPayModal(false); onRefresh() }
    catch (e: any) { alert(e.message) } finally { setBusy(false) }
  }
  async function handleEmail() {
    setEmailing(true); setEmailMsg('')
    try {
      const res = await fetch('/api/email/send-invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id, senderEmail: profile?.email, senderName: profile?.full_name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send')
      await updateInvoiceStatus(invoice.id, 'sent')
      setEmailMsg('✓ Invoice emailed successfully'); onRefresh()
    } catch (e: any) { setEmailMsg(`✗ ${e.message}`) } finally { setEmailing(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div>
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Invoice</p>
            <h2 className="text-xl font-bold text-slate-800">{invoice.invoice_number}</h2>
          </div>
          <div className="flex items-center gap-3">
            <Badge status={invoice.status} />
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
          </div>
        </div>
        <div className="flex-1 p-6 space-y-5">
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-xs text-slate-400 uppercase font-medium tracking-wide mb-2">Bill To</p>
            <p className="font-semibold text-slate-800">{invoice.customer_name || '—'}</p>
            {invoice.customer_email && <p className="text-sm text-slate-500">{invoice.customer_email}</p>}
            {invoice.customer_phone && <p className="text-sm text-slate-500">{invoice.customer_phone}</p>}
            <button onClick={() => { onClose(); navigate(`/customers/${invoice.customer_id}`) }}
              className="text-xs text-sky-600 hover:text-sky-700 font-medium mt-1">View Customer →</button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Total', value: fmt(invoice.total), color: 'text-slate-800' },
              { label: 'Paid', value: fmt(invoice.amount_paid), color: 'text-green-600' },
              { label: 'Balance', value: fmt(balance), color: balance > 0 ? 'text-red-500' : 'text-green-600' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-slate-50 rounded-xl p-3 text-center">
                <p className="text-xs text-slate-400 mb-1">{label}</p>
                <p className={`text-lg font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>
          {invoice.total > 0 && (
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Payment progress</span><span>{Math.round(paidPct)}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100,paidPct)}%`, backgroundColor: paidPct >= 100 ? '#16A34A' : '#F59E0B' }} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[['Created',fmtDate(invoice.created_at)],['Due',fmtDate(invoice.due_date)],['Sent',invoice.sent_at?fmtDate(invoice.sent_at):'—'],['Paid',invoice.paid_at?fmtDate(invoice.paid_at):'—']].map(([l,v])=>(
              <div key={l}><p className="text-slate-400 text-xs">{l}</p><p className="font-medium text-slate-700">{v}</p></div>
            ))}
          </div>
          {invoice.line_items_snapshot.length > 0 && (
            <div>
              <p className="text-xs text-slate-400 uppercase font-medium tracking-wide mb-2">Line Items</p>
              <div className="border border-slate-100 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 text-xs text-slate-400">
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-right px-3 py-2">Qty</th>
                    <th className="text-right px-3 py-2">Unit</th>
                    <th className="text-right px-3 py-2">Total</th>
                  </tr></thead>
                  <tbody>
                    {invoice.line_items_snapshot.map((li,i)=>(
                      <tr key={i} className={i%2===0?'bg-white':'bg-slate-50/50'}>
                        <td className="px-3 py-2 text-slate-700">{li.description}</td>
                        <td className="px-3 py-2 text-right text-slate-500">{li.quantity}</td>
                        <td className="px-3 py-2 text-right text-slate-500">{fmt(li.unit_price)}</td>
                        <td className="px-3 py-2 text-right font-medium">{fmt(li.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-100 bg-slate-50"><td colSpan={3} className="px-3 py-1.5 text-right text-xs text-slate-400">Subtotal</td><td className="px-3 py-1.5 text-right font-medium">{fmt(invoice.subtotal)}</td></tr>
                    <tr className="bg-slate-50"><td colSpan={3} className="px-3 py-1.5 text-right text-xs text-slate-400">Tax (7%)</td><td className="px-3 py-1.5 text-right font-medium">{fmt(invoice.tax_amount)}</td></tr>
                    <tr className="bg-slate-50 border-t border-slate-200"><td colSpan={3} className="px-3 py-2 text-right text-sm font-semibold">Total</td><td className="px-3 py-2 text-right font-bold text-slate-800">{fmt(invoice.total)}</td></tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
          {invoice.notes && <div className="bg-amber-50 rounded-xl p-4"><p className="text-xs text-amber-600 font-medium mb-1">Notes</p><p className="text-sm text-amber-800">{invoice.notes}</p></div>}
          {emailMsg && <p className={`text-sm font-medium ${emailMsg.startsWith('✓')?'text-green-600':'text-red-500'}`}>{emailMsg}</p>}
        </div>
        {invoice.status !== 'void' && (
          <div className="p-6 border-t border-slate-100 space-y-2">
            {isAdmin && invoice.status === 'draft' && <button onClick={handleMarkSent} disabled={busy} className="w-full py-2.5 rounded-xl text-sm font-semibold bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-50">Mark as Sent</button>}
            {isAdmin && ['draft','sent','partial'].includes(invoice.status) && <button onClick={()=>{setPayAmt(balance.toFixed(2));setPayModal(true)}} className="w-full py-2.5 rounded-xl text-sm font-semibold bg-green-500 text-white hover:bg-green-600">Record Payment</button>}
            <button onClick={handleEmail} disabled={emailing} className="w-full py-2.5 rounded-xl text-sm font-semibold bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50">{emailing?'Sending…':'✉ Email Invoice'}</button>
            {isAdmin && invoice.status !== 'paid' && <button onClick={handleVoid} disabled={busy} className="w-full py-2.5 rounded-xl text-sm font-semibold border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50">Void Invoice</button>}
          </div>
        )}
      </div>
      {payModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={()=>setPayModal(false)} />
          <div className="relative bg-white rounded-2xl p-6 w-80 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold">Record Payment</h3>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Amount ($)</label>
              <input type="number" step="0.01" value={payAmt} onChange={e=>setPayAmt(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
              <p className="text-xs text-slate-400 mt-1">Balance due: {fmt(balance)}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={()=>setPayModal(false)} className="flex-1 py-2 rounded-xl text-sm border border-slate-200">Cancel</button>
              <button onClick={handlePay} disabled={busy} className="flex-1 py-2 rounded-xl text-sm font-semibold bg-green-500 text-white hover:bg-green-600 disabled:opacity-50">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CreateInvoiceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [customers, setCustomers] = useState<any[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState('')
  const [acceptedQuotes, setAcceptedQuotes] = useState<any[]>([])
  const [selectedQuote, setSelectedQuote] = useState('')
  const [mode, setMode] = useState<'from_quote'|'manual'>('from_quote')
  const [busy, setBusy] = useState(false)
  const [desc, setDesc] = useState('')
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('')
  const [notes, setNotes] = useState('')
  const [dueDate, setDueDate] = useState(new Date(Date.now()+14*86400000).toISOString().slice(0,10))

  useEffect(() => {
    supabase.from('customers').select('id,full_name').order('full_name').then(({data})=>setCustomers(data||[]))
  }, [])
  useEffect(() => {
    if (!selectedCustomer) return setAcceptedQuotes([])
    fetchQuotes(selectedCustomer).then(qs=>setAcceptedQuotes(qs.filter(q=>q.status==='accepted')))
  }, [selectedCustomer])

  async function handleSubmit() {
    if (!selectedCustomer) return alert('Select a customer')
    setBusy(true)
    try {
      if (mode === 'from_quote') {
        if (!selectedQuote) throw new Error('Select a quote')
        await createInvoiceFromQuote(selectedQuote)
      } else {
        const unitPrice = parseFloat(price)
        if (!desc || !unitPrice) throw new Error('Description and price required')
        const quantity = parseInt(qty)||1
        const subtotal = quantity*unitPrice
        const tax = subtotal*0.07
        await createInvoice({ customer_id:selectedCustomer, line_items:[{description:desc,quantity,unit_price:unitPrice,total:subtotal}], subtotal, tax_amount:tax, total:subtotal+tax, due_date:dueDate, notes:notes||undefined })
      }
      onCreated(); onClose()
    } catch(e:any) { alert(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-800">New Invoice</h2>
        <div className="flex gap-2 bg-slate-100 rounded-xl p-1">
          {(['from_quote','manual'] as const).map(v=>(
            <button key={v} onClick={()=>setMode(v)}
              className={`flex-1 py-1.5 text-sm rounded-lg font-medium transition-all ${mode===v?'bg-white shadow text-slate-800':'text-slate-400'}`}>
              {v==='from_quote'?'From Quote':'Manual'}
            </button>
          ))}
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Customer *</label>
          <select value={selectedCustomer} onChange={e=>setSelectedCustomer(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400">
            <option value="">Select customer…</option>
            {customers.map(c=><option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
        </div>
        {mode==='from_quote' ? (
          <div>
            <label className="block text-xs text-slate-500 mb-1">Accepted Quote *</label>
            <select value={selectedQuote} onChange={e=>setSelectedQuote(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400">
              <option value="">Select quote…</option>
              {acceptedQuotes.length===0&&selectedCustomer&&<option disabled value="">No accepted quotes</option>}
              {acceptedQuotes.map(q=><option key={q.id} value={q.id}>{q.quote_number} — ${parseFloat(q.total).toFixed(2)}</option>)}
            </select>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Description *</label>
              <input value={desc} onChange={e=>setDesc(e.target.value)} placeholder="e.g. Monthly rental – RO System"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Qty</label>
                <input type="number" value={qty} onChange={e=>setQty(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Unit Price ($) *</label>
                <input type="number" step="0.01" value={price} onChange={e=>setPrice(e.target.value)} placeholder="29.99"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Due Date</label>
              <input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Notes</label>
              <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none" />
            </div>
          </div>
        )}
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-600">Cancel</button>
          <button onClick={handleSubmit} disabled={busy}
            className="flex-1 py-2.5 rounded-xl bg-sky-500 text-white text-sm font-semibold hover:bg-sky-600 disabled:opacity-50">
            {busy?'Creating…':'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Invoice|null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [filter, setFilter] = useState<InvoiceStatus|'all'>('all')
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true)
    try { await refreshOverdueInvoices(); setInvoices(await fetchInvoices()) }
    catch(e){console.error(e)} finally { setLoading(false) }
  }

  useEffect(()=>{load()},[])

  const filtered = invoices.filter(inv=>{
    const mf = filter==='all'||inv.status===filter
    const q  = search.toLowerCase()
    return mf && (!q||(inv.customer_name||'').toLowerCase().includes(q)||inv.invoice_number.toLowerCase().includes(q))
  })

  const outstanding = invoices.filter(i=>['sent','partial','overdue'].includes(i.status)).reduce((a,i)=>a+balanceDue(i),0)
  const overdueCount = invoices.filter(i=>i.status==='overdue').length
  const now = new Date().toISOString().slice(0,7)
  const paidMtd = invoices.filter(i=>i.status==='paid'&&i.paid_at?.startsWith(now)).reduce((a,i)=>a+i.amount_paid,0)

  const FILTERS: [string, InvoiceStatus|'all'][] = [
    ['All','all'],['Draft','draft'],['Sent','sent'],['Paid','paid'],['Overdue','overdue'],['Partial','partial'],['Void','void'],
  ]

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Invoices</h1>
          <p className="text-sm text-slate-400 mt-0.5">Track billing, payments, and outstanding balances</p>
        </div>
        <button onClick={()=>setShowCreate(true)} className="px-4 py-2.5 bg-sky-500 text-white text-sm font-semibold rounded-xl hover:bg-sky-600 shadow-sm">
          + New Invoice
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          {label:'Outstanding',value:fmt(outstanding),color:'text-sky-600',sub:`${invoices.filter(i=>['sent','partial','overdue'].includes(i.status)).length} invoices`},
          {label:'Overdue',value:String(overdueCount),color:overdueCount>0?'text-red-500':'text-slate-400',sub:'need attention'},
          {label:'Paid This Month',value:fmt(paidMtd),color:'text-green-600',sub:'collected MTD'},
        ].map(({label,value,color,sub})=>(
          <div key={label} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-400 font-medium mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex gap-1 bg-white border border-slate-100 rounded-xl p-1 shadow-sm">
          {FILTERS.map(([label,val])=>(
            <button key={val} onClick={()=>setFilter(val)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${filter===val?'bg-sky-500 text-white shadow-sm':'text-slate-500 hover:bg-slate-50'}`}>
              {label}{val!=='all'&&<span className="ml-1 opacity-60">({invoices.filter(i=>i.status===val).length})</span>}
            </button>
          ))}
        </div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customer or invoice #…"
          className="flex-1 min-w-48 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white" />
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-slate-400 text-sm">Loading invoices…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-slate-400">
            <p className="text-2xl mb-2">📄</p>
            <p className="text-sm">No invoices found</p>
            <button onClick={()=>setShowCreate(true)} className="mt-3 text-xs text-sky-500 font-medium">Create one →</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-400 border-b border-slate-100">
                {['Invoice #','Customer','Status','Total','Balance Due','Due Date','Created'].map(h=>(
                  <th key={h} className="text-left px-4 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv,i)=>(
                <tr key={inv.id} onClick={()=>setSelected(inv)}
                  className={`cursor-pointer hover:bg-sky-50 transition-colors ${i%2===0?'':' bg-slate-50/40'}`}>
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-sky-600">{inv.invoice_number}</td>
                  <td className="px-4 py-3 font-medium text-slate-700">{inv.customer_name||'—'}</td>
                  <td className="px-4 py-3"><Badge status={inv.status} /></td>
                  <td className="px-4 py-3 font-semibold">{fmt(inv.total)}</td>
                  <td className="px-4 py-3"><span className={balanceDue(inv)>0?'text-red-500 font-semibold':'text-green-600 font-semibold'}>{fmt(balanceDue(inv))}</span></td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(inv.due_date)}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{fmtDate(inv.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <InvoiceDrawer invoice={selected} onClose={()=>setSelected(null)}
          onRefresh={async()=>{ await load(); if(selected){const u=await fetchInvoice(selected.id);if(u)setSelected(u)} }} />
      )}
      {showCreate && <CreateInvoiceModal onClose={()=>setShowCreate(false)} onCreated={load} />}
    </div>
  )
}
