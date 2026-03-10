// api/export/sales-tax-report.ts
// Vercel serverless API route — generates live Sales Tax Report Excel

import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const TAX_RATE = 0.07

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { year, month, mode = 'monthly' } = req.query

    const y = parseInt(year as string) || new Date().getFullYear()
    const m = parseInt(month as string) || new Date().getMonth() + 1

    // ── Date range ──────────────────────────────────────────────────────────
    let startDate: string, endDate: string, reportLabel: string

    if (mode === 'yearly') {
      startDate   = `${y}-01-01`
      endDate     = `${y + 1}-01-01`
      reportLabel = `Annual ${y}`
    } else {
      const pad = (n: number) => String(n).padStart(2, '0')
      startDate   = `${y}-${pad(m)}-01`
      const nextM = m === 12 ? 1 : m + 1
      const nextY = m === 12 ? y + 1 : y
      endDate     = `${nextY}-${pad(nextM)}-01`
      reportLabel = `${new Date(y, m - 1).toLocaleString('en-US', { month: 'long' })} ${y}`
    }

    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const dueMonth = m === 12 ? 'January' : new Date(y, m).toLocaleString('en-US', { month: 'long' })
    const dueYear  = m === 12 ? y + 1 : y

    // ── Fetch completed transactions ────────────────────────────────────────
    const { data: transactions, error: txErr } = await supabase
      .from('payment_transactions')
      .select('amount, type, status, completed_at, description, customer_id')
      .eq('status', 'succeeded')
      .gte('completed_at', startDate)
      .lt('completed_at', endDate)
      .order('completed_at', { ascending: true })

    if (txErr) throw txErr

    // ── Fetch accepted quotes as fallback ───────────────────────────────────
    const { data: quotes } = await supabase
      .from('quotes')
      .select('subtotal, tax_amount, total, commercial_type, accepted_at, created_at')
      .in('status', ['accepted', 'sent'])
      .gte('created_at', startDate)
      .lt('created_at', endDate)
      .order('created_at', { ascending: true })

    // ── Aggregate by period ─────────────────────────────────────────────────
    const MONTHS = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December']

    type PeriodRow = {
      label: string
      rental: number; purchase: number; install: number
      taxable: number; tax: number; total: number; count: number
    }

    const periodMap: Record<string, PeriodRow> = {}

    const getKey = (dateStr: string) => {
      const d = new Date(dateStr)
      return mode === 'yearly'
        ? `${y}-${String(d.getMonth()+1).padStart(2,'0')}`
        : d.toISOString().slice(0,10)
    }

    const getLabel = (key: string) => {
      if (mode === 'yearly') {
        const mNum = parseInt(key.split('-')[1]) - 1
        return `${MONTHS[mNum]} ${y}`
      }
      return key
    }

    const ensureKey = (key: string) => {
      if (!periodMap[key]) {
        periodMap[key] = { label: getLabel(key), rental:0, purchase:0, install:0, taxable:0, tax:0, total:0, count:0 }
      }
    }

    // Init yearly slots
    if (mode === 'yearly') {
      for (let mi = 1; mi <= 12; mi++) {
        const key = `${y}-${String(mi).padStart(2,'0')}`
        ensureKey(key)
      }
    }

    // From transactions (most accurate)
    for (const tx of transactions || []) {
      const key = getKey(tx.completed_at)
      ensureKey(key)
      const amt = parseFloat(tx.amount) || 0
      const preTax = amt / (1 + TAX_RATE)
      const tax = amt - preTax
      const isRental = tx.type === 'autopay' || (tx.description||'').toLowerCase().includes('rental')
      const isInstall = (tx.description||'').toLowerCase().includes('install')
      if (isInstall) periodMap[key].install += preTax
      else if (isRental) periodMap[key].rental += preTax
      else periodMap[key].purchase += preTax
      periodMap[key].taxable += preTax
      periodMap[key].tax     += tax
      periodMap[key].total   += amt
      periodMap[key].count   += 1
    }

    // From quotes if no transactions
    if ((transactions || []).length === 0) {
      for (const q of quotes || []) {
        const key = getKey(q.accepted_at || q.created_at)
        ensureKey(key)
        const sub  = parseFloat(q.subtotal) || 0
        const tax  = parseFloat(q.tax_amount) || sub * TAX_RATE
        const tot  = parseFloat(q.total) || sub + tax
        if (q.commercial_type === 'rental') periodMap[key].rental += sub
        else periodMap[key].purchase += sub
        periodMap[key].taxable += sub
        periodMap[key].tax     += tax
        periodMap[key].total   += tot
        periodMap[key].count   += 1
      }
    }

    const sortedRows = Object.entries(periodMap)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([,v]) => v)

    const totals = sortedRows.reduce((acc, r) => ({
      rental: acc.rental + r.rental, purchase: acc.purchase + r.purchase,
      install: acc.install + r.install, taxable: acc.taxable + r.taxable,
      tax: acc.tax + r.tax, total: acc.total + r.total, count: acc.count + r.count
    }), { rental:0, purchase:0, install:0, taxable:0, tax:0, total:0, count:0 })

    const fmt = (n: number) => `$${n.toFixed(2)}`

    // ── Build Excel ─────────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new()

    // Sheet 1 — Report
    const wsData = [
      [`ZENITH PURE SOLUTIONS LLC — INDIANA SALES TAX REPORT`],
      [`Period: ${reportLabel}  ·  Indiana Tax Rate: 7.00%`],
      [`Generated: ${today}  ·  File with Indiana DOR by ${dueMonth} 20, ${dueYear}`],
      [],
      ['INDIANA ST-103 FILING SUMMARY'],
      ['Gross Sales (Total Collected)', fmt(totals.total)],
      ['Taxable Sales (Pre-Tax)', fmt(totals.taxable)],
      ['Non-Taxable Revenue', fmt(totals.install)],
      ['Indiana Sales Tax @ 7.00%', fmt(totals.tax)],
      ['Tax Period', reportLabel],
      ['Filing Due Date', `${dueMonth} 20, ${dueYear}`],
      [],
      ['Period', 'Rental Revenue', 'Purchase Revenue', 'Install Revenue',
       'Taxable Sales', 'Sales Tax (7%)', 'Total Collected', 'Transactions'],
      ...sortedRows.map(r => [
        r.label,
        r.rental > 0 ? fmt(r.rental) : '—',
        r.purchase > 0 ? fmt(r.purchase) : '—',
        r.install > 0 ? fmt(r.install) : '—',
        r.taxable > 0 ? fmt(r.taxable) : '—',
        r.tax > 0 ? fmt(r.tax) : '—',
        r.total > 0 ? fmt(r.total) : '—',
        r.count || '—',
      ]),
      [],
      ['TOTALS', fmt(totals.rental), fmt(totals.purchase), fmt(totals.install),
       fmt(totals.taxable), fmt(totals.tax), fmt(totals.total), totals.count],
      [],
      ['NOTE: Reconcile against Stripe dashboard before filing. intime.dor.in.gov  ·  Form ST-103'],
    ]

    const ws1 = XLSX.utils.aoa_to_sheet(wsData)
    ws1['!cols'] = [{wch:30},{wch:18},{wch:18},{wch:18},{wch:16},{wch:16},{wch:18},{wch:14}]
    XLSX.utils.book_append_sheet(wb, ws1, `${reportLabel}`)

    // Sheet 2 — Yearly overview if monthly mode
    if (mode === 'monthly') {
      const yrData = [
        [`ZENITH PURE SOLUTIONS LLC — ${y} ANNUAL OVERVIEW`],
        [],
        ['Month', 'Taxable Sales', 'Sales Tax (7%)', 'Total Collected', 'Transactions'],
        ...MONTHS.map((mn, mi) => {
          const key = `${y}-${String(mi+1).padStart(2,'0')}`
          const r = periodMap[key]
          const isCurrent = mi + 1 === m
          return [
            isCurrent ? `${mn} ${y} ◄` : `${mn} ${y}`,
            r?.taxable > 0 ? fmt(r.taxable) : '—',
            r?.tax > 0 ? fmt(r.tax) : '—',
            r?.total > 0 ? fmt(r.total) : '—',
            r?.count || '—',
          ]
        }),
        [],
        ['ANNUAL TOTAL', fmt(totals.taxable), fmt(totals.tax), fmt(totals.total), totals.count],
      ]
      const ws2 = XLSX.utils.aoa_to_sheet(yrData)
      ws2['!cols'] = [{wch:20},{wch:16},{wch:16},{wch:18},{wch:14}]
      XLSX.utils.book_append_sheet(wb, ws2, `${y} Annual Overview`)
    }

    // ── Send response ───────────────────────────────────────────────────────
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const filename = `Zenith_SalesTax_${reportLabel.replace(/\s+/g,'-')}.xlsx`

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Length', buffer.length)
    return res.send(buffer)

  } catch (err: any) {
    console.error('Sales tax export error:', err)
    return res.status(500).json({ error: err.message || 'Export failed' })
  }
}
