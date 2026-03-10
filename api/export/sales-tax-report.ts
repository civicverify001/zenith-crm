// api/export/sales-tax-report.ts
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const TAX_RATE = 0.07
const NAVY  = '0F1E2E'
const TEAL  = '0EA5E9'
const GOLD  = 'F59E0B'
const WHITE = 'FFFFFF'
const LIGHT = 'F0F4F8'
const MID   = 'CBD5E1'
const DARK  = '1E3A4F'
const GREEN = '16A34A'
const RED   = 'DC2626'

const fmt = (n: number) => n > 0 ? `$${n.toFixed(2)}` : '—'

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December']

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  try {
    const { year, month, mode = 'monthly' } = req.query
    const y = parseInt(year as string) || new Date().getFullYear()
    const m = parseInt(month as string) || new Date().getMonth() + 1
    const pad = (n: number) => String(n).padStart(2, '0')

    const startDate = mode === 'yearly' ? `${y}-01-01` : `${y}-${pad(m)}-01`
    const nextM = m === 12 ? 1 : m + 1
    const nextY = m === 12 ? y + 1 : y
    const endDate = mode === 'yearly' ? `${y + 1}-01-01` : `${nextY}-${pad(nextM)}-01`
    const reportLabel = mode === 'yearly' ? `Annual ${y}` : `${MONTHS[m - 1]} ${y}`
    const dueMonth = m === 12 ? 'January' : MONTHS[m]
    const dueYear  = m === 12 ? y + 1 : y
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    const { data: transactions } = await supabase
      .from('payment_transactions')
      .select('amount, type, status, completed_at, description, customer_id')
      .eq('status', 'succeeded')
      .gte('completed_at', startDate)
      .lt('completed_at', endDate)
      .order('completed_at', { ascending: true })

    const { data: quotes } = await supabase
      .from('quotes')
      .select('subtotal, tax_amount, total, commercial_type, accepted_at, created_at')
      .in('status', ['accepted', 'sent'])
      .gte('created_at', startDate)
      .lt('created_at', endDate)

    type Row = { label: string; rental: number; purchase: number; install: number; taxable: number; tax: number; total: number; count: number }
    const periodMap: Record<string, Row> = {}

    const getKey = (d: string) => {
      const dt = new Date(d)
      return mode === 'yearly' ? `${y}-${pad(dt.getMonth() + 1)}` : dt.toISOString().slice(0, 10)
    }
    const getLabel = (k: string) => mode === 'yearly' ? `${MONTHS[parseInt(k.split('-')[1]) - 1]} ${y}` : k
    const ensure = (k: string) => { if (!periodMap[k]) periodMap[k] = { label: getLabel(k), rental:0, purchase:0, install:0, taxable:0, tax:0, total:0, count:0 } }

    if (mode === 'yearly') for (let i = 1; i <= 12; i++) ensure(`${y}-${pad(i)}`)

    const useTx = (transactions || []).length > 0
    if (useTx) {
      for (const tx of transactions!) {
        const k = getKey(tx.completed_at); ensure(k)
        const amt = parseFloat(tx.amount) || 0
        const pre = amt / (1 + TAX_RATE)
        const tax = amt - pre
        const isInstall = (tx.description || '').toLowerCase().includes('install')
        const isRental  = tx.type === 'autopay' || (tx.description || '').toLowerCase().includes('rental')
        if (isInstall) periodMap[k].install += pre
        else if (isRental) periodMap[k].rental += pre
        else periodMap[k].purchase += pre
        periodMap[k].taxable += pre; periodMap[k].tax += tax; periodMap[k].total += amt; periodMap[k].count++
      }
    } else {
      for (const q of quotes || []) {
        const k = getKey(q.accepted_at || q.created_at); ensure(k)
        const sub = parseFloat(q.subtotal) || 0
        const tax = parseFloat(q.tax_amount) || sub * TAX_RATE
        const tot = parseFloat(q.total) || sub + tax
        if (q.commercial_type === 'rental') periodMap[k].rental += sub
        else periodMap[k].purchase += sub
        periodMap[k].taxable += sub; periodMap[k].tax += tax; periodMap[k].total += tot; periodMap[k].count++
      }
    }

    const rows = Object.entries(periodMap).sort(([a],[b]) => a.localeCompare(b)).map(([,v]) => v)
    const totals = rows.reduce((a, r) => ({
      rental: a.rental + r.rental, purchase: a.purchase + r.purchase,
      install: a.install + r.install, taxable: a.taxable + r.taxable,
      tax: a.tax + r.tax, total: a.total + r.total, count: a.count + r.count,
      label: '', // unused
    }), { label:'', rental:0, purchase:0, install:0, taxable:0, tax:0, total:0, count:0 })

    // ── Workbook ─────────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Zenith Pure Solutions LLC'
    wb.created = new Date()

    // ── Sheet 1 ──────────────────────────────────────────────────────────────
    const ws = wb.addWorksheet(reportLabel, { pageSetup: { orientation: 'landscape' } })
    ws.columns = [
      { width: 28 }, { width: 18 }, { width: 18 }, { width: 18 },
      { width: 16 }, { width: 16 }, { width: 18 }, { width: 12 },
    ]

    // Title
    ws.mergeCells('A1:H1')
    Object.assign(ws.getCell('A1'), {
      value: 'ZENITH PURE SOLUTIONS LLC — INDIANA SALES TAX REPORT',
      font: { name: 'Arial', bold: true, size: 15, color: { argb: WHITE } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    })
    ws.getRow(1).height = 34

    ws.mergeCells('A2:H2')
    Object.assign(ws.getCell('A2'), {
      value: `Period: ${reportLabel}  ·  Indiana Sales Tax Rate: 7.00%`,
      font: { name: 'Arial', size: 10, color: { argb: 'B0C4D8' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    })
    ws.getRow(2).height = 18

    ws.mergeCells('A3:H3')
    Object.assign(ws.getCell('A3'), {
      value: `Generated: ${today}  ·  File with Indiana DOR by ${dueMonth} 20, ${dueYear}`,
      font: { name: 'Arial', size: 10, color: { argb: 'B0C4D8' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    })
    ws.getRow(3).height = 18

    ws.addRow([])

    // Filing summary box
    const summaryTitle = ws.addRow(['INDIANA ST-103 FILING SUMMARY'])
    ws.mergeCells(`A${summaryTitle.number}:H${summaryTitle.number}`)
    summaryTitle.height = 24
    Object.assign(summaryTitle.getCell(1), {
      font: { name: 'Arial', bold: true, size: 12, color: { argb: WHITE } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    })

    const summaryData = [
      ['Gross Sales (Total Collected)', `$${totals.total.toFixed(2)}`, 'Taxable Sales (Pre-Tax)', `$${totals.taxable.toFixed(2)}`],
      ['Sales Tax Due @ 7.00%', `$${totals.tax.toFixed(2)}`, 'Non-Taxable Revenue', `$${totals.install.toFixed(2)}`],
      ['Tax Period', reportLabel, 'Filing Due Date', `${dueMonth} 20, ${dueYear}`],
      ['Filing Link', 'intime.dor.in.gov', 'Form', 'ST-103 Monthly Sales Tax Return'],
    ]

    summaryData.forEach((rowData, i) => {
      const r = ws.addRow(rowData)
      r.height = 20
      const bg = i % 2 === 0 ? 'EAF4FB' : WHITE
      r.eachCell((cell, col) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
        cell.font = { name: 'Arial', size: 10 }
        cell.alignment = { vertical: 'middle', horizontal: col % 2 === 0 ? 'right' : 'left' }
        cell.border = { bottom: { style: 'thin', color: { argb: MID } } }
        if (col % 2 === 0) {
          cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: TEAL } }
        }
      })
    })

    ws.addRow([])

    // Data headers
    const hRow = ws.addRow(['Period', 'Rental Revenue', 'Purchase Revenue', 'Install Revenue',
      'Taxable Sales', 'Sales Tax (7%)', 'Total Collected', 'Transactions'])
    hRow.height = 22
    hRow.eachCell(cell => {
      cell.font  = { name: 'Arial', bold: true, size: 10, color: { argb: WHITE } }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    })

    rows.forEach((r, i) => {
      const bg   = i % 2 === 0 ? LIGHT : WHITE
      const isCurrent = mode === 'monthly' && r.label.includes(MONTHS[m - 1])
      const row = ws.addRow([
        r.label,
        r.rental > 0 ? `$${r.rental.toFixed(2)}` : '—',
        r.purchase > 0 ? `$${r.purchase.toFixed(2)}` : '—',
        r.install > 0 ? `$${r.install.toFixed(2)}` : '—',
        r.taxable > 0 ? `$${r.taxable.toFixed(2)}` : '—',
        r.tax > 0 ? `$${r.tax.toFixed(2)}` : '—',
        r.total > 0 ? `$${r.total.toFixed(2)}` : '—',
        r.count || '—',
      ])
      row.height = 18
      row.eachCell((cell, col) => {
        cell.font = { name: 'Arial', size: 9, color: { argb: isCurrent ? NAVY : '334155' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isCurrent ? 'FFF9E6' : bg } }
        cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'right' }
        cell.border = { bottom: { style: 'thin', color: { argb: MID } } }
        if (col === 6) cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: isCurrent ? GOLD : TEAL } }
        if (col === 7) cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: isCurrent ? '0A7D3E' : GREEN } }
      })
    })

    // Totals row
    const totRow = ws.addRow([
      'TOTALS',
      `$${totals.rental.toFixed(2)}`, `$${totals.purchase.toFixed(2)}`, `$${totals.install.toFixed(2)}`,
      `$${totals.taxable.toFixed(2)}`, `$${totals.tax.toFixed(2)}`, `$${totals.total.toFixed(2)}`,
      totals.count,
    ])
    totRow.height = 24
    totRow.eachCell((cell, col) => {
      cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: WHITE } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }
      cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'right' }
      if (col === 6) cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: GOLD } }
      if (col === 7) cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: '4ADE80' } }
    })

    ws.addRow([])
    const note = ws.addRow(['NOTE: Always reconcile against your Stripe dashboard before filing. intime.dor.in.gov  ·  Form ST-103  ·  Due 20th of each month'])
    ws.mergeCells(`A${note.number}:H${note.number}`)
    note.getCell(1).font = { name: 'Arial', size: 8, italic: true, color: { argb: '94A3B8' } }
    note.getCell(1).alignment = { horizontal: 'center' }

    // ── Sheet 2: Annual Overview ──────────────────────────────────────────────
    const ws2 = wb.addWorksheet(`${y} Annual Overview`)
    ws2.columns = [{ width: 22 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 14 }]

    ws2.mergeCells('A1:E1')
    Object.assign(ws2.getCell('A1'), {
      value: `ZENITH PURE SOLUTIONS LLC — ${y} ANNUAL OVERVIEW`,
      font: { name: 'Arial', bold: true, size: 13, color: { argb: WHITE } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    })
    ws2.getRow(1).height = 30
    ws2.addRow([])

    const h2 = ws2.addRow(['Month', 'Taxable Sales', 'Sales Tax (7%)', 'Total Collected', 'Transactions'])
    h2.height = 20
    h2.eachCell(cell => {
      cell.font  = { name: 'Arial', bold: true, size: 10, color: { argb: WHITE } }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    })

    let annTaxable = 0, annTax = 0, annTotal = 0, annCount = 0

    MONTHS.forEach((mn, mi) => {
      const key = `${y}-${pad(mi + 1)}`
      const r = periodMap[key]
      const isCur = mi + 1 === m && mode === 'monthly'
      const bg = mi % 2 === 0 ? LIGHT : WHITE

      if (r) { annTaxable += r.taxable; annTax += r.tax; annTotal += r.total; annCount += r.count }

      const row = ws2.addRow([
        isCur ? `${mn} ${y} ◄ Current` : `${mn} ${y}`,
        r?.taxable > 0 ? `$${r.taxable.toFixed(2)}` : '—',
        r?.tax > 0 ? `$${r.tax.toFixed(2)}` : '—',
        r?.total > 0 ? `$${r.total.toFixed(2)}` : '—',
        r?.count || '—',
      ])
      row.height = 18
      row.eachCell((cell, col) => {
        cell.font = { name: 'Arial', size: 9 }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isCur ? 'FFF9E6' : bg } }
        cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'right' }
        cell.border = { bottom: { style: 'thin', color: { argb: MID } } }
        if (isCur) cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: NAVY } }
        if (col === 3 && r?.tax > 0) cell.font = { name: 'Arial', size: 9, color: { argb: TEAL } }
        if (col === 4 && r?.total > 0) cell.font = { name: 'Arial', size: 9, color: { argb: GREEN } }
      })
    })

    ws2.addRow([])
    const aTot = ws2.addRow(['ANNUAL TOTAL', `$${annTaxable.toFixed(2)}`, `$${annTax.toFixed(2)}`, `$${annTotal.toFixed(2)}`, annCount])
    aTot.height = 24
    aTot.eachCell((cell, col) => {
      cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: WHITE } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }
      cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'right' }
      if (col === 3) cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: GOLD } }
      if (col === 4) cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: '4ADE80' } }
    })

    const filename = `Zenith_SalesTax_${reportLabel.replace(/\s+/g, '-')}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    const buffer = await wb.xlsx.writeBuffer()
    return res.send(Buffer.from(buffer))

  } catch (err: any) {
    console.error('Sales tax export error:', err)
    return res.status(500).json({ error: err.message })
  }
}
