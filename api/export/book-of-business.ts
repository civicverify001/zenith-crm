// api/export/book-of-business.ts
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const NAVY  = '0F1E2E'
const TEAL  = '0EA5E9'
const GOLD  = 'F59E0B'
const WHITE = 'FFFFFF'
const LIGHT = 'EBF5FB'
const MID   = 'CBD5E1'
const DARK  = '1E3A4F'
const GREEN = '16A34A'
const RED   = 'DC2626'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  try {
    const { data: customers } = await supabase
      .from('customers')
      .select('id, full_name, phone, email, lead_id, lifecycle_status, created_at')
      .order('created_at', { ascending: true })

    if (!customers?.length) return res.status(200).json({ error: 'No customers' })

    const { data: jobs } = await supabase
      .from('jobs')
      .select('lead_id, system_type, completed_at, equipment_summary, serial_number, service_address_snapshot')
      .eq('status', 'completed')

    const { data: transactions } = await supabase
      .from('payment_transactions')
      .select('customer_id, amount, status, type')
      .eq('status', 'succeeded')

    const leadIds = customers.map(c => c.lead_id).filter(Boolean)
    const { data: leads } = leadIds.length
      ? await supabase.from('leads').select('id, address, city, state, zip, rental_monthly_amount').in('id', leadIds)
      : { data: [] }

    const { data: quotes } = await supabase
      .from('quotes')
      .select('customer_id, commercial_type, subtotal, total, status')
      .in('customer_id', customers.map(c => c.id))
      .in('status', ['accepted', 'sent'])

    const leadMap: Record<string, any>  = {}
    const txMap: Record<string, number> = {}
    const quoteMap: Record<string, any> = {}
    const jobMap: Record<string, any>   = {}

    for (const l of leads || [])        leadMap[l.id] = l
    for (const t of transactions || []) txMap[t.customer_id] = (txMap[t.customer_id] || 0) + parseFloat(t.amount)
    for (const q of quotes || [])       if (!quoteMap[q.customer_id]) quoteMap[q.customer_id] = q
    for (const j of jobs || [])         if (j.lead_id && !jobMap[j.lead_id]) jobMap[j.lead_id] = j

    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    let mrrTotal = 0, lifetimeTotal = 0, rentalCount = 0, purchaseCount = 0

    const rows = customers.map((c, i) => {
      const lead  = leadMap[c.lead_id] || {}
      const job   = jobMap[c.lead_id]  || {}
      const quote = quoteMap[c.id]     || {}
      const paid  = txMap[c.id]        || 0

      // Single-line address — no wrapping
      const address = [lead.address, lead.city ? `${lead.city}, ${lead.state}` : '']
        .filter(Boolean).join('  ') || job.service_address_snapshot || '—'

      const system    = job.system_type || job.equipment_summary || '—'
      const installDt = job.completed_at ? new Date(job.completed_at).toLocaleDateString('en-US') : '—'
      const ctype     = quote.commercial_type || '—'
      const mAmt      = lead.rental_monthly_amount
        ? parseFloat(lead.rental_monthly_amount)
        : ctype === 'rental' ? parseFloat(quote.subtotal) || 0 : 0
      const serial    = job.serial_number || '—'

      let contractLabel = ctype === '—' ? '—' : ctype.charAt(0).toUpperCase() + ctype.slice(1)
      let monthlyLabel  = mAmt > 0 ? `$${mAmt.toFixed(2)}/mo` : '—'
      let statusLabel   = 'No Payments'

      if (ctype === 'rental') {
        rentalCount++; mrrTotal += mAmt
        statusLabel = paid > 0 ? 'Current' : 'No Payments'
      } else if (ctype === 'purchase' || ctype === 'financed') {
        purchaseCount++
        const quoteTotal = parseFloat(quote.total) || 0
        statusLabel = paid > 0 && quoteTotal > 0 && paid >= quoteTotal ? 'Paid in Full' : paid > 0 ? 'Current' : 'No Payments'
      } else if (paid > 0) {
        statusLabel = 'Current'
      }

      lifetimeTotal += paid

      return { num: i+1, name: c.full_name||'—', phone: c.phone||'—', email: c.email||'—',
               address, system, installDt, contractLabel, monthlyLabel, mAmt, paid, statusLabel, serial,
               isRental: ctype === 'rental' }
    })

    // ── Workbook ──────────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Zenith Pure Solutions LLC'
    wb.created = new Date()

    // ── Sheet 1 ───────────────────────────────────────────────────────────────
    const ws = wb.addWorksheet('Book of Business', {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
    })

    ws.columns = [
      { width: 4  },   // #
      { width: 22 },   // Name
      { width: 15 },   // Phone
      { width: 28 },   // Email
      { width: 32 },   // Address (single line)
      { width: 24 },   // System
      { width: 13 },   // Install
      { width: 12 },   // Contract
      { width: 14 },   // Monthly
      { width: 13 },   // Total Paid
      { width: 14 },   // Status
      { width: 12 },   // Serial
    ]

    // Row 1 — Title
    ws.mergeCells('A1:L1')
    Object.assign(ws.getCell('A1'), {
      value: 'ZENITH PURE SOLUTIONS LLC — BOOK OF BUSINESS',
      font: { name: 'Arial', bold: true, size: 15, color: { argb: WHITE } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    })
    ws.getRow(1).height = 34

    // Row 2 — Subtitle
    ws.mergeCells('A2:L2')
    Object.assign(ws.getCell('A2'), {
      value: `As of ${today}  ·  All active customers, systems, and contract values  ·  CONFIDENTIAL`,
      font: { name: 'Arial', size: 9, color: { argb: 'B0C4D8' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    })
    ws.getRow(2).height = 16

    // Row 3 — KPI bar (2 cols each, 6 KPIs = 12 cols)
    const kpis: [string, string, string][] = [
      ['A3:B3', 'Total Customers',    String(customers.length)],
      ['C3:D3', 'Rental Accounts',    String(rentalCount)],
      ['E3:F3', 'Purchase Accounts',  String(purchaseCount)],
      ['G3:H3', 'Monthly Recurring',  `$${mrrTotal.toFixed(2)}`],
      ['I3:J3', 'Annual Run Rate',    `$${(mrrTotal * 12).toFixed(2)}`],
      ['K3:L3', 'Lifetime Collected', `$${lifetimeTotal.toFixed(2)}`],
    ]
    kpis.forEach(([range, lbl, val]) => {
      ws.mergeCells(range)
      const cell = ws.getCell(range.split(':')[0])
      cell.value = `${lbl}\n${val}`
      cell.font  = { name: 'Arial', bold: true, size: 10, color: { argb: NAVY } }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DFF0FA' } }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.border = {
        top:    { style: 'medium', color: { argb: TEAL } },
        bottom: { style: 'medium', color: { argb: TEAL } },
        left:   { style: 'thin',   color: { argb: MID } },
        right:  { style: 'thin',   color: { argb: MID } },
      }
    })
    ws.getRow(3).height = 38

    // Row 4 — Column headers
    const hRow = ws.addRow(['#', 'Customer Name', 'Phone', 'Email', 'Service Address',
      'System Type', 'Install Date', 'Contract', 'Monthly', 'Total Paid', 'Status', 'Serial #'])
    hRow.height = 22
    hRow.eachCell(cell => {
      cell.font  = { name: 'Arial', bold: true, size: 10, color: { argb: WHITE } }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.border = { bottom: { style: 'medium', color: { argb: NAVY } } }
    })

    // Data rows
    rows.forEach((r, i) => {
      const bg  = i % 2 === 0 ? LIGHT : WHITE
      const row = ws.addRow([
        r.num, r.name, r.phone, r.email, r.address, r.system,
        r.installDt, r.contractLabel, r.monthlyLabel,
        r.paid > 0 ? `$${r.paid.toFixed(2)}` : '$0.00',
        r.statusLabel, r.serial,
      ])
      row.height = 18
      row.eachCell((cell, col) => {
        cell.font = { name: 'Arial', size: 9 }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
        cell.alignment = { vertical: 'middle', wrapText: false }  // NO wrapping
        cell.border = { bottom: { style: 'thin', color: { argb: MID } } }
        if (col === 1) cell.alignment.horizontal = 'center'
        if (col === 9  && r.monthlyLabel !== '—') cell.font = { name: 'Arial', size: 9, color: { argb: TEAL } }
        if (col === 10 && r.paid > 0)             cell.font = { name: 'Arial', size: 9, color: { argb: GOLD } }
        if (col === 11) {
          const good = r.statusLabel === 'Current' || r.statusLabel === 'Paid in Full'
          cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: good ? GREEN : RED } }
          cell.alignment.horizontal = 'center'
        }
        if (col === 12) cell.font = { name: 'Arial', size: 9, color: { argb: '64748B' } }
      })
    })

    // Totals row — full width, no truncation
    const totRow = ws.addRow([
      'TOTALS', '', '', '', '', '', '', '',
      mrrTotal > 0 ? `$${mrrTotal.toFixed(2)}/mo` : '—',
      `$${lifetimeTotal.toFixed(2)}`, '', '',
    ])
    totRow.height = 26
    // Merge A-H for label
    ws.mergeCells(`A${totRow.number}:H${totRow.number}`)
    ws.getCell(`A${totRow.number}`).value = 'TOTALS'
    totRow.eachCell((cell, col) => {
      cell.font  = { name: 'Arial', bold: true, size: 11, color: { argb: WHITE } }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }
      cell.alignment = { vertical: 'middle', horizontal: col <= 8 ? 'left' : 'center' }
      cell.border = { top: { style: 'medium', color: { argb: TEAL } } }
    })
    ws.getCell(`I${totRow.number}`).font = { name: 'Arial', bold: true, size: 11, color: { argb: TEAL } }
    ws.getCell(`J${totRow.number}`).font = { name: 'Arial', bold: true, size: 11, color: { argb: GOLD } }

    // Footer
    ws.addRow([])
    const fr = ws.addRow([`Zenith Pure Solutions LLC  ·  Book of Business  ·  Generated ${today}  ·  CONFIDENTIAL — Internal Use Only`])
    ws.mergeCells(`A${fr.number}:L${fr.number}`)
    fr.getCell(1).font = { name: 'Arial', size: 8, italic: true, color: { argb: '94A3B8' } }
    fr.getCell(1).alignment = { horizontal: 'center' }

    // ── Sheet 2: MRR ─────────────────────────────────────────────────────────
    const ws2 = wb.addWorksheet('MRR Summary')
    ws2.columns = [{ width: 24 }, { width: 28 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 14 }]

    ws2.mergeCells('A1:F1')
    Object.assign(ws2.getCell('A1'), {
      value: 'ZENITH PURE SOLUTIONS LLC — MRR SUMMARY',
      font: { name: 'Arial', bold: true, size: 13, color: { argb: WHITE } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    })
    ws2.getRow(1).height = 30

    ws2.mergeCells('A2:F2')
    Object.assign(ws2.getCell('A2'), {
      value: `Rental accounts only  ·  ${today}`,
      font: { name: 'Arial', size: 9, color: { argb: 'B0C4D8' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
      alignment: { horizontal: 'center' },
    })
    ws2.getRow(2).height = 16

    ws2.addRow([])
    const h2 = ws2.addRow(['Customer', 'System', 'Monthly Amt', 'Annual Value', 'Total Paid', 'Status'])
    h2.height = 20
    h2.eachCell(cell => {
      cell.font  = { name: 'Arial', bold: true, size: 10, color: { argb: WHITE } }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    })

    rows.filter(r => r.isRental).forEach((r, i) => {
      const bg  = i % 2 === 0 ? LIGHT : WHITE
      const row = ws2.addRow([
        r.name, r.system,
        `$${r.mAmt.toFixed(2)}/mo`, `$${(r.mAmt * 12).toFixed(2)}`,
        r.paid > 0 ? `$${r.paid.toFixed(2)}` : '$0.00',
        r.statusLabel,
      ])
      row.height = 18
      row.eachCell((cell, col) => {
        cell.font = { name: 'Arial', size: 9 }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
        cell.alignment = { vertical: 'middle', horizontal: col <= 2 ? 'left' : 'right' }
        cell.border = { bottom: { style: 'thin', color: { argb: MID } } }
        if (col === 3) cell.font = { name: 'Arial', size: 9, color: { argb: TEAL } }
        if (col === 4) cell.font = { name: 'Arial', size: 9, color: { argb: GOLD } }
        if (col === 6) {
          const good = r.statusLabel === 'Current' || r.statusLabel === 'Paid in Full'
          cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: good ? GREEN : RED } }
          cell.alignment.horizontal = 'center'
        }
      })
    })

    ws2.addRow([])
    const t2 = ws2.addRow(['TOTAL MRR', '', `$${mrrTotal.toFixed(2)}/mo`, `$${(mrrTotal * 12).toFixed(2)}`, `$${lifetimeTotal.toFixed(2)}`, ''])
    t2.height = 24
    t2.eachCell((cell, col) => {
      cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: WHITE } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }
      cell.alignment = { vertical: 'middle', horizontal: col <= 2 ? 'left' : 'right' }
      if (col === 3) cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: TEAL } }
      if (col === 4 || col === 5) cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: GOLD } }
    })

    const filename = `Zenith_Book_of_Business_${new Date().toISOString().slice(0,10)}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    const buffer = await wb.xlsx.writeBuffer()
    return res.send(Buffer.from(buffer))

  } catch (err: any) {
    console.error('BoB export error:', err)
    return res.status(500).json({ error: err.message })
  }
}
