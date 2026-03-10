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
const LIGHT = 'F0F4F8'
const MID   = 'CBD5E1'
const DARK  = '1E3A4F'

const money = (n: number) => n > 0 ? `$${n.toFixed(2)}` : '$0.00'

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
      .select('customer_id, commercial_type, subtotal, status')
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
    const totalRevenue = (transactions || []).reduce((s, t) => s + parseFloat(t.amount), 0)
    const rentalCount  = customers.filter(c => quoteMap[c.id]?.commercial_type === 'rental').length

    const wb = new ExcelJS.Workbook()
    wb.creator = 'Zenith Pure Solutions LLC'
    wb.created = new Date()

    // ── Sheet 1 ─────────────────────────────────────────────────────────────
    const ws = wb.addWorksheet('Book of Business', {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
    })

    ws.columns = [
      { width: 5 }, { width: 24 }, { width: 16 }, { width: 30 }, { width: 34 },
      { width: 26 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 14 },
      { width: 16 }, { width: 14 },
    ]

    // Title
    ws.mergeCells('A1:L1')
    Object.assign(ws.getCell('A1'), {
      value: 'ZENITH PURE SOLUTIONS LLC — BOOK OF BUSINESS',
      font: { name: 'Arial', bold: true, size: 16, color: { argb: WHITE } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    })
    ws.getRow(1).height = 36

    // Subtitle
    ws.mergeCells('A2:L2')
    Object.assign(ws.getCell('A2'), {
      value: `Generated: ${today}  ·  CONFIDENTIAL — Internal Use Only`,
      font: { name: 'Arial', size: 10, color: { argb: 'B0C4D8' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    })
    ws.getRow(2).height = 20

    // KPI row
    const kpiData = [
      ['A3:C3', `Total Customers: ${customers.length}`],
      ['D3:F3', `Rental Accounts: ${rentalCount}`],
      ['G3:I3', `Revenue Collected: ${money(totalRevenue)}`],
      ['J3:L3', `Report Date: ${today}`],
    ]
    kpiData.forEach(([range, value]) => {
      ws.mergeCells(range as string)
      const cell = ws.getCell((range as string).split(':')[0])
      cell.value = value
      cell.font  = { name: 'Arial', bold: true, size: 11, color: { argb: NAVY } }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E8F4FD' } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.border = { bottom: { style: 'medium', color: { argb: TEAL } } }
    })
    ws.getRow(3).height = 28

    // Headers
    const hRow = ws.addRow(['#', 'Customer Name', 'Phone', 'Email', 'Service Address',
      'System Type', 'Install Date', 'Contract Type', 'Monthly Amt',
      'Total Paid', 'Pay Status', 'Lifecycle'])
    hRow.height = 22
    hRow.eachCell(cell => {
      cell.font  = { name: 'Arial', bold: true, size: 10, color: { argb: WHITE } }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    })

    // Data
    customers.forEach((c, i) => {
      const lead  = leadMap[c.lead_id] || {}
      const job   = jobMap[c.lead_id]  || {}
      const quote = quoteMap[c.id]     || {}
      const paid  = txMap[c.id]        || 0
      const address = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ') || job.service_address_snapshot || '—'
      const system    = job.system_type || job.equipment_summary || '—'
      const installDt = job.completed_at ? new Date(job.completed_at).toLocaleDateString('en-US') : '—'
      const ctype     = quote.commercial_type ? quote.commercial_type.charAt(0).toUpperCase() + quote.commercial_type.slice(1) : '—'
      const mAmt      = lead.rental_monthly_amount ? parseFloat(lead.rental_monthly_amount) : ctype === 'Rental' ? parseFloat(quote.subtotal) || 0 : 0
      const monthly   = mAmt > 0 ? money(mAmt) : '—'
      const payStatus = paid > 0 ? 'Current' : 'No Payments'
      const bg        = i % 2 === 0 ? LIGHT : WHITE

      const row = ws.addRow([i + 1, c.full_name || '—', c.phone || '—', c.email || '—',
        address, system, installDt, ctype, monthly, money(paid), payStatus, c.lifecycle_status || '—'])
      row.height = 18
      row.eachCell((cell, col) => {
        cell.font = { name: 'Arial', size: 9 }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
        cell.alignment = { vertical: 'middle' }
        cell.border = { bottom: { style: 'thin', color: { argb: MID } } }
        if (col === 1) cell.alignment.horizontal = 'center'
        if (col === 9 && monthly !== '—') cell.font = { name: 'Arial', size: 9, color: { argb: TEAL } }
        if (col === 10) cell.font = { name: 'Arial', size: 9, color: { argb: GOLD } }
        if (col === 11) cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: payStatus === 'Current' ? '16A34A' : 'DC2626' } }
      })
    })

    // Footer
    ws.addRow([])
    const fr = ws.addRow(['This report is CONFIDENTIAL. For internal use only. Zenith Pure Solutions LLC — Indianapolis, IN'])
    ws.mergeCells(`A${fr.number}:L${fr.number}`)
    fr.getCell(1).font = { name: 'Arial', size: 8, italic: true, color: { argb: '94A3B8' } }
    fr.getCell(1).alignment = { horizontal: 'center' }

    // ── Sheet 2: MRR ────────────────────────────────────────────────────────
    const ws2 = wb.addWorksheet('MRR Summary')
    ws2.columns = [{ width: 26 }, { width: 28 }, { width: 16 }, { width: 16 }, { width: 16 }]

    ws2.mergeCells('A1:E1')
    Object.assign(ws2.getCell('A1'), {
      value: 'ZENITH PURE SOLUTIONS LLC — MRR SUMMARY',
      font: { name: 'Arial', bold: true, size: 14, color: { argb: WHITE } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    })
    ws2.getRow(1).height = 32

    ws2.mergeCells('A2:E2')
    Object.assign(ws2.getCell('A2'), {
      value: `Rental accounts only  ·  ${today}`,
      font: { name: 'Arial', size: 10, color: { argb: 'B0C4D8' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } },
      alignment: { horizontal: 'center' },
    })
    ws2.getRow(2).height = 18

    ws2.addRow([])
    const h2 = ws2.addRow(['Customer', 'System', 'Monthly Amount', 'Annual Value', 'Status'])
    h2.height = 20
    h2.eachCell(cell => {
      cell.font  = { name: 'Arial', bold: true, size: 10, color: { argb: WHITE } }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    })

    const rentalCusts = customers.filter(c => quoteMap[c.id]?.commercial_type === 'rental')
    let mrrTotal = 0

    rentalCusts.forEach((c, i) => {
      const lead   = leadMap[c.lead_id] || {}
      const job    = jobMap[c.lead_id]  || {}
      const quote  = quoteMap[c.id]     || {}
      const paid   = txMap[c.id]        || 0
      const system = job.system_type || job.equipment_summary || '—'
      const mAmt   = lead.rental_monthly_amount ? parseFloat(lead.rental_monthly_amount) : parseFloat(quote.subtotal) || 0
      mrrTotal    += mAmt
      const payStatus = paid > 0 ? 'Current' : 'No Payments'
      const bg = i % 2 === 0 ? LIGHT : WHITE

      const row = ws2.addRow([c.full_name, system, money(mAmt), money(mAmt * 12), payStatus])
      row.height = 18
      row.eachCell((cell, col) => {
        cell.font = { name: 'Arial', size: 9 }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
        cell.alignment = { vertical: 'middle' }
        if (col === 3 || col === 4) { cell.font = { name: 'Arial', size: 9, color: { argb: TEAL } }; cell.alignment.horizontal = 'right' }
        if (col === 5) { cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: payStatus === 'Current' ? '16A34A' : 'DC2626' } }; cell.alignment.horizontal = 'center' }
      })
    })

    ws2.addRow([])
    const totRow = ws2.addRow(['TOTAL MRR', '', money(mrrTotal), money(mrrTotal * 12), ''])
    totRow.height = 22
    totRow.eachCell((cell, col) => {
      cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: WHITE } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }
      if (col === 3 || col === 4) { cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: GOLD } }; cell.alignment = { horizontal: 'right' } }
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
