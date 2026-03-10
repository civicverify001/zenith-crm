// api/export/sales-tax-report.ts
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const TAX   = 0.07
const NAVY  = '0F1E2E'
const TEAL  = '0EA5E9'
const GOLD  = 'F59E0B'
const WHITE = 'FFFFFF'
const LIGHT = 'EBF5FB'
const MID   = 'CBD5E1'
const DARK  = '1E3A4F'
const GREEN = '16A34A'
const RED   = 'DC2626'
const AMBER = 'FFFBEB'

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December']

const usd = (n: number) => `$${n.toFixed(2)}`
const pad = (n: number) => String(n).padStart(2, '0')

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  try {
    const { year, month, mode = 'monthly' } = req.query
    const y = parseInt(year as string) || new Date().getFullYear()
    const m = parseInt(month as string) || new Date().getMonth() + 1

    const startDate = mode === 'yearly' ? `${y}-01-01` : `${y}-${pad(m)}-01`
    const nextM = m === 12 ? 1 : m + 1
    const nextY = m === 12 ? y + 1 : y
    const endDate   = mode === 'yearly' ? `${y + 1}-01-01` : `${nextY}-${pad(nextM)}-01`
    const label     = mode === 'yearly' ? `Annual ${y}` : `${MONTHS[m - 1]} ${y}`
    const dueMonth  = m === 12 ? 'January' : MONTHS[m]
    const dueYear   = m === 12 ? y + 1 : y
    const today     = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    const { data: tx } = await supabase
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
    const map: Record<string, Row> = {}

    const key  = (d: string) => mode === 'yearly' ? `${y}-${pad(new Date(d).getMonth()+1)}` : new Date(d).toISOString().slice(0,10)
    const lbl  = (k: string) => mode === 'yearly' ? `${MONTHS[parseInt(k.split('-')[1])-1]} ${y}` : k
    const init = (k: string) => { if (!map[k]) map[k] = { label: lbl(k), rental:0, purchase:0, install:0, taxable:0, tax:0, total:0, count:0 } }

    if (mode === 'yearly') for (let i = 1; i <= 12; i++) init(`${y}-${pad(i)}`)

    const useTx = (tx || []).length > 0
    if (useTx) {
      for (const t of tx!) {
        const k = key(t.completed_at); init(k)
        const amt = parseFloat(t.amount) || 0
        const pre = amt / (1 + TAX); const tax = amt - pre
        const isI = (t.description||'').toLowerCase().includes('install')
        const isR = t.type === 'autopay' || (t.description||'').toLowerCase().includes('rental')
        if (isI) map[k].install += pre
        else if (isR) map[k].rental += pre
        else map[k].purchase += pre
        map[k].taxable += pre; map[k].tax += tax; map[k].total += amt; map[k].count++
      }
    } else {
      for (const q of quotes || []) {
        const k = key(q.accepted_at || q.created_at); init(k)
        const sub = parseFloat(q.subtotal)||0; const tax = parseFloat(q.tax_amount)||sub*TAX; const tot = parseFloat(q.total)||sub+tax
        if (q.commercial_type === 'rental') map[k].rental += sub; else map[k].purchase += sub
        map[k].taxable += sub; map[k].tax += tax; map[k].total += tot; map[k].count++
      }
    }

    const rows = Object.entries(map).sort(([a],[b]) => a.localeCompare(b)).map(([,v]) => v)
    const tot  = rows.reduce((a,r) => ({ label:'', rental:a.rental+r.rental, purchase:a.purchase+r.purchase, install:a.install+r.install, taxable:a.taxable+r.taxable, tax:a.tax+r.tax, total:a.total+r.total, count:a.count+r.count }), { label:'', rental:0, purchase:0, install:0, taxable:0, tax:0, total:0, count:0 })

    // ── Workbook ──────────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Zenith Pure Solutions LLC'
    wb.created = new Date()

    // ══════════════════════════════════════════════════════════════════════════
    // SHEET 1
    // ══════════════════════════════════════════════════════════════════════════
    const ws = wb.addWorksheet(label, { pageSetup: { orientation: 'landscape' } })

    // 6 columns: label | value | label | value | label | value
    ws.columns = [
      { width: 30 }, { width: 20 }, { width: 30 }, { width: 20 }, { width: 22 }, { width: 20 },
    ]

    // ── Title (row 1) ─────────────────────────────────────────────────────────
    ws.mergeCells('A1:F1')
    Object.assign(ws.getCell('A1'), {
      value: 'ZENITH PURE SOLUTIONS LLC — INDIANA SALES TAX REPORT',
      font: { name: 'Arial', bold: true, size: 15, color: { argb: WHITE } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    })
    ws.getRow(1).height = 34

    ws.mergeCells('A2:F2')
    Object.assign(ws.getCell('A2'), {
      value: `Period: ${label}  ·  Indiana Sales Tax Rate: 7.00%  ·  Form ST-103`,
      font: { name: 'Arial', size: 10, color: { argb: 'B0C4D8' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    })
    ws.getRow(2).height = 18

    ws.mergeCells('A3:F3')
    Object.assign(ws.getCell('A3'), {
      value: `Generated: ${today}  ·  File with Indiana DOR by ${dueMonth} 20, ${dueYear}  ·  intime.dor.in.gov`,
      font: { name: 'Arial', size: 10, color: { argb: 'B0C4D8' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    })
    ws.getRow(3).height = 18

    ws.addRow([]) // spacer

    // ── ST-103 Filing Summary Box (rows 5-10) ─────────────────────────────────
    ws.mergeCells('A5:F5')
    Object.assign(ws.getCell('A5'), {
      value: '🏛  INDIANA ST-103 FILING SUMMARY',
      font: { name: 'Arial', bold: true, size: 12, color: { argb: WHITE } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    })
    ws.getRow(5).height = 26

    const summaryRows: [string, string, string, string][] = [
      ['Gross Sales (Total Collected)',  usd(tot.total),   'Taxable Sales (Pre-Tax)',  usd(tot.taxable)],
      ['Sales Tax Due @ 7.00%',          usd(tot.tax),     'Non-Taxable Revenue',      usd(tot.install)],
      ['Tax Period',                     label,            'Filing Due Date',           `${dueMonth} 20, ${dueYear}`],
      ['Filing Portal',                  'intime.dor.in.gov', 'Form Number',            'ST-103 Monthly Sales Tax Return'],
    ]

    const summaryBorders: ExcelJS.Borders = {
      top:    { style: 'thin', color: { argb: MID } },
      bottom: { style: 'thin', color: { argb: MID } },
      left:   { style: 'thin', color: { argb: MID } },
      right:  { style: 'thin', color: { argb: MID } },
    }

    summaryRows.forEach(([l1, v1, l2, v2], i) => {
      const rn  = 6 + i
      const bg  = i % 2 === 0 ? LIGHT : WHITE
      ws.mergeCells(`A${rn}:B${rn}`) // intentionally NOT merging — using 4 cols
      ws.getRow(rn).height = 22

      // split into: A=label1, B=value1, C=label2, D=value2, E-F=empty
      ws.mergeCells(`E${rn}:F${rn}`)
      const cells = ['A', 'B', 'C', 'D']
      const vals  = [l1, v1, l2, v2]

      cells.forEach((col, ci) => {
        const cell = ws.getCell(`${col}${rn}`)
        cell.value = vals[ci]
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
        cell.border = summaryBorders
        if (ci % 2 === 0) {
          // Label cell
          cell.font = { name: 'Arial', size: 10, color: { argb: '334155' } }
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
        } else {
          // Value cell
          cell.font = { name: 'Arial', bold: true, size: 11, color: { argb: ci === 1 ? '0EA5E9' : GOLD } }
          cell.alignment = { vertical: 'middle', horizontal: 'right' }
        }
      })
      // Fill E-F
      ws.getCell(`E${rn}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
    })

    // outer border on summary box
    for (let r = 5; r <= 9; r++) {
      ws.getCell(`A${r}`).border = { ...ws.getCell(`A${r}`).border, left: { style: 'medium', color: { argb: TEAL } } }
      ws.getCell(`D${r}`).border = { ...ws.getCell(`D${r}`).border, right: { style: 'medium', color: { argb: TEAL } } }
    }
    for (let c of ['A','B','C','D','E','F']) {
      ws.getCell(`${c}5`).border  = { ...ws.getCell(`${c}5`).border,  top: { style: 'medium', color: { argb: TEAL } } }
      ws.getCell(`${c}9`).border  = { ...ws.getCell(`${c}9`).border,  bottom: { style: 'medium', color: { argb: TEAL } } }
    }

    ws.addRow([]) // spacer row 10

    // ── Data Table Headers (row 11) ───────────────────────────────────────────
    // Expand columns for data table
    ws.columns = [
      { width: 22 }, { width: 18 }, { width: 18 }, { width: 18 },
      { width: 16 }, { width: 16 }, { width: 18 }, { width: 14 },
    ]

    // Re-do merges for title/summary to span 8 cols
    // (Can't change after — instead rebuild with 8 cols from the start)
    // NOTE: We already set 6 cols, now we need 8 for the data table.
    // ExcelJS columns array sets initial widths; adding more cols is fine.
    // The summary used A:F. The data table will use A:H.

    const hRow = ws.addRow(['Period', 'Rental Revenue', 'Purchase Revenue', 'Install Revenue',
      'Taxable Sales', 'Sales Tax (7%)', 'Total Collected', 'Transactions'])
    hRow.height = 24
    hRow.eachCell(cell => {
      cell.font  = { name: 'Arial', bold: true, size: 10, color: { argb: WHITE } }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.border = { bottom: { style: 'medium', color: { argb: NAVY } } }
    })

    rows.forEach((r, i) => {
      const bg     = i % 2 === 0 ? LIGHT : WHITE
      const isCur  = label.includes(r.label.split(' ')[0]) && r.total > 0
      const row    = ws.addRow([
        r.label,
        r.rental > 0   ? usd(r.rental)   : '—',
        r.purchase > 0 ? usd(r.purchase) : '—',
        r.install > 0  ? usd(r.install)  : '—',
        r.taxable > 0  ? usd(r.taxable)  : '—',
        r.tax > 0      ? usd(r.tax)      : '—',
        r.total > 0    ? usd(r.total)    : '—',
        r.count > 0    ? r.count         : '—',
      ])
      row.height = 18
      row.eachCell((cell, col) => {
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: isCur ? AMBER : bg } }
        cell.font  = { name: 'Arial', size: 9, color: { argb: isCur ? NAVY : '334155' } }
        cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'right' }
        cell.border = { bottom: { style: 'thin', color: { argb: MID } } }
        if (col === 6) cell.font = { name: 'Arial', size: 9, bold: !!isCur, color: { argb: TEAL } }
        if (col === 7) cell.font = { name: 'Arial', size: 9, bold: !!isCur, color: { argb: GREEN } }
      })
    })

    // Totals row
    const totRow = ws.addRow([
      'TOTALS', usd(tot.rental), usd(tot.purchase), usd(tot.install),
      usd(tot.taxable), usd(tot.tax), usd(tot.total), tot.count,
    ])
    totRow.height = 26
    totRow.eachCell((cell, col) => {
      cell.font  = { name: 'Arial', bold: true, size: 11, color: { argb: WHITE } }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }
      cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'right' }
      cell.border = { top: { style: 'medium', color: { argb: TEAL } } }
      if (col === 6) cell.font = { name: 'Arial', bold: true, size: 11, color: { argb: GOLD } }
      if (col === 7) cell.font = { name: 'Arial', bold: true, size: 11, color: { argb: '4ADE80' } }
    })

    ws.addRow([])
    const note = ws.addRow(['NOTE: Always reconcile against your Stripe dashboard before filing.  intime.dor.in.gov  ·  Form ST-103  ·  Due 20th of each month'])
    ws.mergeCells(`A${note.number}:H${note.number}`)
    note.getCell(1).font = { name: 'Arial', size: 8, italic: true, color: { argb: '94A3B8' } }
    note.getCell(1).alignment = { horizontal: 'center' }

    // ══════════════════════════════════════════════════════════════════════════
    // SHEET 2 — Annual Overview
    // ══════════════════════════════════════════════════════════════════════════
    const ws2 = wb.addWorksheet(`${y} Annual Overview`)
    ws2.columns = [
      { width: 22 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 14 }
    ]

    ws2.mergeCells('A1:E1')
    Object.assign(ws2.getCell('A1'), {
      value: `ZENITH PURE SOLUTIONS LLC — ${y} ANNUAL OVERVIEW`,
      font: { name: 'Arial', bold: true, size: 13, color: { argb: WHITE } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    })
    ws2.getRow(1).height = 30

    ws2.mergeCells('A2:E2')
    Object.assign(ws2.getCell('A2'), {
      value: `Indiana Sales Tax Rate: 7.00%  ·  Generated ${today}`,
      font: { name: 'Arial', size: 9, color: { argb: 'B0C4D8' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
      alignment: { horizontal: 'center' },
    })
    ws2.getRow(2).height = 16

    ws2.addRow([])
    const h2 = ws2.addRow(['Month', 'Taxable Sales', 'Sales Tax (7%)', 'Total Collected', 'Transactions'])
    h2.height = 22
    h2.eachCell(cell => {
      cell.font  = { name: 'Arial', bold: true, size: 10, color: { argb: WHITE } }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    })

    let aTax = 0, aTot = 0, aTaxable = 0, aCount = 0
    MONTHS.forEach((mn, mi) => {
      const k    = `${y}-${pad(mi+1)}`
      const r    = map[k]
      const isCur = mi + 1 === m && mode === 'monthly'
      if (r) { aTaxable += r.taxable; aTax += r.tax; aTot += r.total; aCount += r.count }
      const row = ws2.addRow([
        isCur ? `${mn} ${y}  ◄ Current Period` : `${mn} ${y}`,
        r?.taxable > 0 ? usd(r.taxable) : '—',
        r?.tax     > 0 ? usd(r.tax)     : '—',
        r?.total   > 0 ? usd(r.total)   : '—',
        r?.count   > 0 ? r.count        : '—',
      ])
      row.height = 18
      row.eachCell((cell, col) => {
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: isCur ? AMBER : (mi % 2 === 0 ? LIGHT : WHITE) } }
        cell.font  = { name: 'Arial', size: 9, ...(isCur ? { bold: true, color: { argb: NAVY } } : {}) }
        cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'right' }
        cell.border = { bottom: { style: 'thin', color: { argb: MID } } }
        if (col === 3 && r?.tax > 0)   cell.font = { name: 'Arial', size: 9, color: { argb: TEAL }, bold: !!isCur }
        if (col === 4 && r?.total > 0) cell.font = { name: 'Arial', size: 9, color: { argb: GREEN }, bold: !!isCur }
      })
    })

    ws2.addRow([])
    const aRow = ws2.addRow(['ANNUAL TOTAL', usd(aTaxable), usd(aTax), usd(aTot), aCount])
    aRow.height = 26
    aRow.eachCell((cell, col) => {
      cell.font  = { name: 'Arial', bold: true, size: 11, color: { argb: WHITE } }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }
      cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'right' }
      if (col === 3) cell.font = { name: 'Arial', bold: true, size: 11, color: { argb: GOLD } }
      if (col === 4) cell.font = { name: 'Arial', bold: true, size: 11, color: { argb: '4ADE80' } }
    })

    // ── Send ──────────────────────────────────────────────────────────────────
    const filename = `Zenith_SalesTax_${label.replace(/\s+/g,'-')}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    const buffer = await wb.xlsx.writeBuffer()
    return res.send(Buffer.from(buffer))

  } catch (err: any) {
    console.error('Sales tax export error:', err)
    return res.status(500).json({ error: err.message })
  }
}
