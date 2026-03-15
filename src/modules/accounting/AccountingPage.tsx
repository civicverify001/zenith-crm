// src/modules/accounting/AccountingPage.tsx
// Sales tax & revenue reporting for monthly/yearly accountant exports

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const Z = {
  navy:    '#0c1e35',
  navyMid: '#162232',
  navyLight:'#1e3a4f',
  teal:    '#0d7ea3',
  tealDim: '#0a5f7a',
  gold:    '#d4a843',
  white:   '#ffffff',
  light:   '#f0f4f8',
  border:  '#1e3a4f',
  text:    '#e2e8f0',
  muted:   '#64748b',
  success: '#16a34a',
  danger:  '#dc2626',
}

const TAX_RATE = 0.07
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

type MonthRow = {
  month: number
  year: number
  label: string
  taxable_sales: number
  tax_collected: number
  total_collected: number
  transaction_count: number
  rental_revenue: number
  purchase_revenue: number
  install_revenue: number
}

function fmt(n: number) {
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

async function downloadTaxReport(year: number, month: number, mode: string) {
  const params = new URLSearchParams({ year: String(year), month: String(month), mode })
  const res = await fetch(`/api/export/sales-tax-report?${params}`)
  if (!res.ok) { alert('Export failed — check console'); return }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const cd = res.headers.get('content-disposition') || ''
  const match = cd.match(/filename="(.+)"/)
  a.download = match ? match[1] : `Zenith_SalesTax.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

async function downloadBookOfBusiness() {
  const res = await fetch('/api/export/book-of-business')
  if (!res.ok) { alert('Export failed — check console'); return }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `Zenith_Book_of_Business_${new Date().toISOString().slice(0,10)}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

export function AccountingPage() {
  const currentYear = new Date().getFullYear()
  const currentMonth = new Date().getMonth() + 1

  const [mode, setMode] = useState<'monthly' | 'yearly'>('monthly')
  const [selectedYear, setSelectedYear] = useState(currentYear)
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [rows, setRows] = useState<MonthRow[]>([])
  const [loading, setLoading] = useState(false)
  const [dataSource, setDataSource] = useState<'transactions' | 'quotes'>('transactions')

  const years = Array.from({ length: 4 }, (_, i) => currentYear - i)

  useEffect(() => { load() }, [mode, selectedYear, selectedMonth, dataSource])

  async function load() {
    setLoading(true)
    try {
      if (dataSource === 'quotes') {
        await loadFromQuotes()
      } else {
        await loadFromTransactions()
      }
    } catch(e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function loadFromTransactions() {
    // Build date range
    let start: string, end: string
    if (mode === 'monthly') {
      const d = new Date(selectedYear, selectedMonth - 1, 1)
      start = d.toISOString()
      end = new Date(selectedYear, selectedMonth, 1).toISOString()
    } else {
      start = new Date(selectedYear, 0, 1).toISOString()
      end = new Date(selectedYear + 1, 0, 1).toISOString()
    }

    const { data, error } = await supabase
      .from('payment_transactions')
      .select('amount, type, status, completed_at, description')
      .eq('status', 'succeeded')
      .gte('completed_at', start)
      .lt('completed_at', end)
      .order('completed_at', { ascending: true })

    if (error || !data) { setRows([]); return }

    if (mode === 'monthly') {
      // Group by day
      const dayMap: Record<string, MonthRow> = {}
      for (const tx of data) {
        const d = new Date(tx.completed_at)
        const key = d.toISOString().slice(0, 10)
        if (!dayMap[key]) dayMap[key] = emptyRow(d.getFullYear(), d.getMonth()+1, key)
        addTxToRow(dayMap[key], tx)
      }
      setRows(Object.values(dayMap).sort((a,b) => a.label.localeCompare(b.label)))
    } else {
      // Group by month
      const monthMap: Record<string, MonthRow> = {}
      for (let m = 1; m <= 12; m++) {
        const key = `${selectedYear}-${String(m).padStart(2,'0')}`
        monthMap[key] = emptyRow(selectedYear, m, `${MONTHS[m-1]} ${selectedYear}`)
      }
      for (const tx of data) {
        const d = new Date(tx.completed_at)
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
        if (monthMap[key]) addTxToRow(monthMap[key], tx)
      }
      setRows(Object.values(monthMap))
    }
  }

  async function loadFromQuotes() {
    // Use accepted quotes as revenue proxy (when no transaction data yet)
    let start: string, end: string
    if (mode === 'monthly') {
      start = new Date(selectedYear, selectedMonth - 1, 1).toISOString()
      end = new Date(selectedYear, selectedMonth, 1).toISOString()
    } else {
      start = new Date(selectedYear, 0, 1).toISOString()
      end = new Date(selectedYear + 1, 0, 1).toISOString()
    }

    const { data, error } = await supabase
      .from('quotes')
      .select('subtotal, tax_amount, total, commercial_type, accepted_at, created_at, status')
      .in('status', ['accepted', 'sent'])
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at', { ascending: true })

    if (error || !data) { setRows([]); return }

    if (mode === 'monthly') {
      const dayMap: Record<string, MonthRow> = {}
      for (const q of data) {
        const d = new Date(q.accepted_at || q.created_at)
        const key = d.toISOString().slice(0, 10)
        if (!dayMap[key]) dayMap[key] = emptyRow(d.getFullYear(), d.getMonth()+1, key)
        addQuoteToRow(dayMap[key], q)
      }
      setRows(Object.values(dayMap).sort((a,b) => a.label.localeCompare(b.label)))
    } else {
      const monthMap: Record<string, MonthRow> = {}
      for (let m = 1; m <= 12; m++) {
        const key = `${selectedYear}-${String(m).padStart(2,'0')}`
        monthMap[key] = emptyRow(selectedYear, m, `${MONTHS[m-1]} ${selectedYear}`)
      }
      for (const q of data) {
        const d = new Date(q.accepted_at || q.created_at)
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
        if (monthMap[key]) addQuoteToRow(monthMap[key], q)
      }
      setRows(Object.values(monthMap))
    }
  }

  function emptyRow(year: number, month: number, label: string): MonthRow {
    return { month, year, label, taxable_sales:0, tax_collected:0, total_collected:0, transaction_count:0, rental_revenue:0, purchase_revenue:0, install_revenue:0 }
  }

  function addTxToRow(row: MonthRow, tx: any) {
    const amt = parseFloat(tx.amount) || 0
    const isRental = tx.type === 'autopay' || (tx.description || '').toLowerCase().includes('rental')
    const isInstall = (tx.description || '').toLowerCase().includes('install')
    if (isInstall) row.install_revenue += amt
    else if (isRental) row.rental_revenue += amt
    else row.purchase_revenue += amt
    const preTax = amt / (1 + TAX_RATE)
    const tax = amt - preTax
    row.taxable_sales += preTax
    row.tax_collected += tax
    row.total_collected += amt
    row.transaction_count += 1
  }

  function addQuoteToRow(row: MonthRow, q: any) {
    const subtotal = parseFloat(q.subtotal) || 0
    const tax = parseFloat(q.tax_amount) || subtotal * TAX_RATE
    const total = parseFloat(q.total) || subtotal + tax
    if (q.commercial_type === 'rental') row.rental_revenue += subtotal
    else row.purchase_revenue += subtotal
    row.taxable_sales += subtotal
    row.tax_collected += tax
    row.total_collected += total
    row.transaction_count += 1
  }

  const totalTaxable  = rows.reduce((s,r) => s + r.taxable_sales, 0)
  const totalTax      = rows.reduce((s,r) => s + r.tax_collected, 0)
  const totalCollected= rows.reduce((s,r) => s + r.total_collected, 0)
  const totalTx       = rows.reduce((s,r) => s + r.transaction_count, 0)
  const totalRental   = rows.reduce((s,r) => s + r.rental_revenue, 0)
  const totalPurchase = rows.reduce((s,r) => s + r.purchase_revenue, 0)
  const totalInstall  = rows.reduce((s,r) => s + r.install_revenue, 0)

  const reportTitle = mode === 'monthly'
    ? `Sales Tax Report — ${MONTHS[selectedMonth-1]} ${selectedYear}`
    : `Annual Sales Tax Report — ${selectedYear}`

  const nonZeroRows = rows.filter(r => r.total_collected > 0 || r.transaction_count > 0)

  return (
    <div style={{ background: '#0f1923', minHeight: '100vh', fontFamily: "'DM Sans', system-ui, sans-serif", color: Z.text }}>

      {/* Header */}
      <div style={{ background: Z.navyMid, borderBottom: `1px solid ${Z.border}`, padding: '20px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 20, color: Z.white }}>Accounting & Tax Reports</div>
            <div style={{ color: Z.muted, fontSize: 13, marginTop: 2 }}>
              Indiana Sales Tax Rate: <span style={{ color: Z.gold, fontWeight: 700 }}>7.00%</span>
              &nbsp;·&nbsp;Zenith Pure Solutions LLC
            </div>
          </div>
          <button
            onClick={() => downloadTaxReport(selectedYear, selectedMonth, mode)}
            style={{
              padding: '10px 22px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: Z.teal, color: '#fff', fontWeight: 700, fontSize: 14,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            ⬇ Export Tax Report
          </button>
          <button
            onClick={downloadBookOfBusiness}
            style={{
              padding: '10px 22px', borderRadius: 8, border: '1px solid #1e3a4f', cursor: 'pointer',
              background: '#162232', color: '#94a3b8', fontWeight: 700, fontSize: 14,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            📊 Book of Business
          </button>
        </div>
      </div>

      <div style={{ padding: '24px 28px', width: '100%' }}>

        {/* Controls */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24, alignItems: 'center' }}>
          {/* Mode toggle */}
          <div style={{ display: 'flex', background: Z.navyMid, borderRadius: 8, padding: 3, border: `1px solid ${Z.border}` }}>
            {(['monthly','yearly'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                padding: '7px 20px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontWeight: 600, fontSize: 13, transition: 'all 0.15s',
                background: mode === m ? Z.teal : 'transparent',
                color: mode === m ? '#fff' : Z.muted,
              }}>
                {m === 'monthly' ? '📅 Monthly' : '📆 Yearly'}
              </button>
            ))}
          </div>

          {/* Year picker */}
          <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} style={{
            padding: '8px 14px', borderRadius: 8, border: `1px solid ${Z.border}`,
            background: Z.navyMid, color: Z.text, fontSize: 13, cursor: 'pointer',
          }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          {/* Month picker — only for monthly mode */}
          {mode === 'monthly' && (
            <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))} style={{
              padding: '8px 14px', borderRadius: 8, border: `1px solid ${Z.border}`,
              background: Z.navyMid, color: Z.text, fontSize: 13, cursor: 'pointer',
            }}>
              {MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
            </select>
          )}

          {/* Data source toggle */}
          <div style={{ display: 'flex', background: Z.navyMid, borderRadius: 8, padding: 3, border: `1px solid ${Z.border}`, marginLeft: 'auto' }}>
            {([['transactions','💳 Payments'],['quotes','📋 Quotes']] as const).map(([src, label]) => (
              <button key={src} onClick={() => setDataSource(src)} style={{
                padding: '7px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontWeight: 600, fontSize: 12, transition: 'all 0.15s',
                background: dataSource === src ? Z.navyLight : 'transparent',
                color: dataSource === src ? Z.text : Z.muted,
              }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 28 }}>
          {[
            { label: 'Total Collected', value: fmt(totalCollected), color: Z.teal, sub: `${totalTx} transactions` },
            { label: 'Taxable Sales', value: fmt(totalTaxable), color: '#60a5fa', sub: 'Pre-tax revenue' },
            { label: 'Sales Tax (7%)', value: fmt(totalTax), color: Z.gold, sub: 'Remit to Indiana DOR' },
            { label: 'Rental Revenue', value: fmt(totalRental), color: '#a78bfa', sub: 'Autopay / monthly' },
            { label: 'Purchase Revenue', value: fmt(totalPurchase), color: '#34d399', sub: 'One-time sales' },
          ].map(card => (
            <div key={card.label} style={{
              background: Z.navyMid, border: `1px solid ${Z.border}`,
              borderRadius: 10, padding: '16px 20px',
            }}>
              <div style={{ color: Z.muted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{card.label}</div>
              <div style={{ color: card.color, fontSize: 22, fontWeight: 800 }}>{card.value}</div>
              <div style={{ color: Z.muted, fontSize: 11, marginTop: 4 }}>{card.sub}</div>
            </div>
          ))}
        </div>

        {/* Sales Tax Filing Box */}
        <div style={{
          background: Z.navyMid, border: `2px solid ${Z.gold}`,
          borderRadius: 10, padding: '20px 24px', marginBottom: 28,
        }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: Z.gold, marginBottom: 12 }}>
            📬 Indiana Sales Tax Filing Summary — {reportTitle}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            {[
              ['Gross Sales', fmt(totalCollected)],
              ['Taxable Sales', fmt(totalTaxable)],
              ['Tax Rate', '7.00%'],
              ['Sales Tax Due', fmt(totalTax)],
              ['Non-Taxable', fmt(totalInstall > 0 ? totalInstall : 0)],
              ['Period', reportTitle.replace('Sales Tax Report — ','')],
            ].map(([k,v]) => (
              <div key={k}>
                <div style={{ color: Z.muted, fontSize: 11, fontWeight: 600, marginBottom: 3 }}>{k}</div>
                <div style={{ color: Z.text, fontSize: 15, fontWeight: 700 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${Z.border}`, fontSize: 12, color: Z.muted }}>
            File at: <span style={{ color: Z.teal }}>intime.dor.in.gov</span>
            &nbsp;·&nbsp; Indiana DOR ST-103 Monthly Sales Tax Return
            &nbsp;·&nbsp; Due: 20th of the following month
          </div>
        </div>

        {/* Table */}
        <div style={{ background: Z.navyMid, border: `1px solid ${Z.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${Z.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: Z.white }}>
              {mode === 'monthly' ? 'Daily Breakdown' : 'Monthly Breakdown'} — {selectedYear}
              {mode === 'monthly' ? ` ${MONTHS[selectedMonth-1]}` : ''}
            </div>
            <div style={{ color: Z.muted, fontSize: 12 }}>
              Data source: {dataSource === 'quotes' ? 'Accepted/Sent Quotes' : 'Completed Payments'}
            </div>
          </div>

          {loading ? (
            <div style={{ padding: 48, textAlign: 'center', color: Z.muted }}>Loading…</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#0f1923' }}>
                    {['Period','Rental','Purchase','Install','Taxable Sales','Tax @ 7%','Total','Txns'].map(h => (
                      <th key={h} style={{
                        padding: '10px 16px', textAlign: h === 'Period' ? 'left' : 'right',
                        color: Z.muted, fontSize: 11, fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: 0.5,
                        borderBottom: `1px solid ${Z.border}`,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: Z.muted }}>
                        No data for this period. Switch data source to "Quotes" if payments aren't recorded yet.
                      </td>
                    </tr>
                  ) : rows.map((row, i) => {
                    const isEmpty = row.total_collected === 0 && row.transaction_count === 0
                    return (
                      <tr key={row.label} style={{
                        background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                        opacity: isEmpty ? 0.35 : 1,
                      }}>
                        <td style={{ padding: '10px 16px', color: isEmpty ? Z.muted : Z.text, fontSize: 13, fontWeight: 600 }}>{row.label}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: '#a78bfa', fontSize: 13 }}>{row.rental_revenue > 0 ? fmt(row.rental_revenue) : '—'}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: '#34d399', fontSize: 13 }}>{row.purchase_revenue > 0 ? fmt(row.purchase_revenue) : '—'}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: '#94a3b8', fontSize: 13 }}>{row.install_revenue > 0 ? fmt(row.install_revenue) : '—'}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: '#60a5fa', fontSize: 13 }}>{row.taxable_sales > 0 ? fmt(row.taxable_sales) : '—'}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: Z.gold, fontSize: 13, fontWeight: 700 }}>{row.tax_collected > 0 ? fmt(row.tax_collected) : '—'}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: Z.teal, fontSize: 13, fontWeight: 700 }}>{row.total_collected > 0 ? fmt(row.total_collected) : '—'}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: Z.muted, fontSize: 13 }}>{row.transaction_count || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr style={{ background: '#0a1520', borderTop: `2px solid ${Z.border}` }}>
                      <td style={{ padding: '12px 16px', fontWeight: 800, color: Z.white, fontSize: 13 }}>TOTAL</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: '#a78bfa', fontWeight: 700, fontSize: 13 }}>{fmt(totalRental)}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: '#34d399', fontWeight: 700, fontSize: 13 }}>{fmt(totalPurchase)}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: '#94a3b8', fontWeight: 700, fontSize: 13 }}>{fmt(totalInstall)}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: '#60a5fa', fontWeight: 700, fontSize: 13 }}>{fmt(totalTaxable)}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: Z.gold, fontWeight: 800, fontSize: 14 }}>{fmt(totalTax)}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: Z.teal, fontWeight: 800, fontSize: 14 }}>{fmt(totalCollected)}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: Z.muted, fontWeight: 700, fontSize: 13 }}>{totalTx}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>

        {/* Footer note */}
        <div style={{ marginTop: 16, color: Z.muted, fontSize: 11, textAlign: 'center' }}>
          This report is generated from CRM data. Always reconcile against Stripe dashboard before filing.
          &nbsp;·&nbsp; Indiana DOR: intime.dor.in.gov &nbsp;·&nbsp; Due 20th of each month.
        </div>
      </div>
    </div>
  )
}
