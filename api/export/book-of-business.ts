// api/export/book-of-business.ts
// Vercel serverless API route — generates live Book of Business Excel

import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // ── 1. Fetch all customers ──────────────────────────────────────────────
    const { data: customers, error: custErr } = await supabase
      .from('customers')
      .select('id, full_name, phone, email, lead_id, lifecycle_status, created_at')
      .order('created_at', { ascending: true })

    if (custErr) throw custErr
    if (!customers || customers.length === 0) {
      return res.status(200).json({ error: 'No customers found' })
    }

    // ── 2. Fetch jobs for system + install info ─────────────────────────────
    const { data: jobs } = await supabase
      .from('jobs')
      .select('lead_id, system_type, completed_at, equipment_summary, serial_number, service_address_snapshot, payment_method_snapshot, quote_total_snapshot')
      .eq('status', 'completed')

    // ── 3. Fetch payment totals per customer ────────────────────────────────
    const { data: transactions } = await supabase
      .from('payment_transactions')
      .select('customer_id, amount, status, type, completed_at')
      .eq('status', 'succeeded')

    // ── 4. Fetch lead addresses ─────────────────────────────────────────────
    const leadIds = customers.map(c => c.lead_id).filter(Boolean)
    const { data: leads } = leadIds.length > 0
      ? await supabase.from('leads').select('id, address, city, state, zip, rental_monthly_amount, rental_term_months').in('id', leadIds)
      : { data: [] }

    // ── 5. Fetch accepted quotes for contract info ──────────────────────────
    const custIds = customers.map(c => c.id)
    const { data: quotes } = await supabase
      .from('quotes')
      .select('customer_id, commercial_type, total, subtotal, status, accepted_at')
      .in('customer_id', custIds)
      .in('status', ['accepted', 'sent'])

    // ── 6. Build lookup maps ────────────────────────────────────────────────
    const leadMap: Record<string, any>   = {}
    const txMap: Record<string, number>  = {}
    const quoteMap: Record<string, any>  = {}
    const jobMap: Record<string, any>    = {}

    for (const l of leads || [])        leadMap[l.id] = l
    for (const t of transactions || []) {
      txMap[t.customer_id] = (txMap[t.customer_id] || 0) + parseFloat(t.amount)
    }
    for (const q of quotes || []) {
      if (!quoteMap[q.customer_id]) quoteMap[q.customer_id] = q
    }
    for (const j of jobs || []) {
      if (j.lead_id && !jobMap[j.lead_id]) jobMap[j.lead_id] = j
    }

    // ── 7. Build report rows ────────────────────────────────────────────────
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    const rows = customers.map((c, i) => {
      const lead   = leadMap[c.lead_id] || {}
      const job    = jobMap[c.lead_id]  || {}
      const quote  = quoteMap[c.id]     || {}
      const totalPaid = txMap[c.id]     || 0

      const address = [lead.address, lead.city, lead.state, lead.zip]
        .filter(Boolean).join(', ') || job.service_address_snapshot || '—'

      const systemType    = job.system_type || job.equipment_summary || '—'
      const installDate   = job.completed_at
        ? new Date(job.completed_at).toLocaleDateString('en-US') : '—'
      const contractType  = quote.commercial_type
        ? quote.commercial_type.charAt(0).toUpperCase() + quote.commercial_type.slice(1)
        : '—'
      const monthlyAmt    = lead.rental_monthly_amount
        ? `$${parseFloat(lead.rental_monthly_amount).toFixed(2)}/mo`
        : quote.commercial_type === 'rental' ? `$${(parseFloat(quote.subtotal)||0).toFixed(2)}/mo`
        : '—'
      const serial        = job.serial_number || '—'
      const payStatus     = totalPaid > 0 ? 'Current' : 'No Payments'

      return {
        '#': i + 1,
        'Customer Name': c.full_name || '—',
        'Phone': c.phone || '—',
        'Email': c.email || '—',
        'Service Address': address,
        'System Type': systemType,
        'Install Date': installDate,
        'Contract Type': contractType,
        'Monthly Amount': monthlyAmt,
        'Total Paid': totalPaid > 0 ? `$${totalPaid.toFixed(2)}` : '$0.00',
        'Payment Status': payStatus,
        'Lifecycle': c.lifecycle_status || '—',
      }
    })

    // ── 8. Build Excel workbook ─────────────────────────────────────────────
    const wb = XLSX.utils.book_new()

    // Summary stats
    const rentalCount   = rows.filter(r => r['Contract Type'] === 'Rental').length
    const totalRevenue  = (transactions || []).reduce((s, t) => s + parseFloat(t.amount), 0)

    // Sheet 1 — Book of Business
    const headerRows = [
      [`ZENITH PURE SOLUTIONS LLC — BOOK OF BUSINESS`],
      [`Generated: ${today}  ·  CONFIDENTIAL — Internal Use Only`],
      [],
      [`Total Customers: ${customers.length}`, '', `Rental Accounts: ${rentalCount}`, '',
       `Total Revenue Collected: $${totalRevenue.toFixed(2)}`],
      [],
    ]

    const dataHeaders = Object.keys(rows[0] || {})
    const dataRows    = rows.map(r => Object.values(r))

    const wsData = [...headerRows, dataHeaders, ...dataRows]
    const ws1 = XLSX.utils.aoa_to_sheet(wsData)

    // Column widths
    ws1['!cols'] = [
      {wch:4},{wch:22},{wch:16},{wch:28},{wch:32},
      {wch:24},{wch:14},{wch:14},{wch:14},{wch:14},{wch:16},{wch:14}
    ]

    XLSX.utils.book_append_sheet(wb, ws1, 'Book of Business')

    // Sheet 2 — MRR Summary (rental only)
    const rentalRows = rows.filter(r => r['Contract Type'] === 'Rental')
    const mrrHeaders = ['Customer', 'System', 'Monthly Amount', 'Annual Value', 'Status']
    const mrrData = rentalRows.map(r => [
      r['Customer Name'],
      r['System Type'],
      r['Monthly Amount'],
      r['Monthly Amount'] !== '—'
        ? `$${(parseFloat(r['Monthly Amount'].replace(/[^0-9.]/g,'')) * 12).toFixed(2)}`
        : '—',
      r['Payment Status'],
    ])

    const ws2Data = [
      [`ZENITH PURE SOLUTIONS LLC — MRR SUMMARY`],
      [`Rental accounts only  ·  ${today}`],
      [],
      mrrHeaders,
      ...mrrData,
    ]
    const ws2 = XLSX.utils.aoa_to_sheet(ws2Data)
    ws2['!cols'] = [{wch:24},{wch:28},{wch:16},{wch:16},{wch:16}]
    XLSX.utils.book_append_sheet(wb, ws2, 'MRR Summary')

    // ── 9. Send response ────────────────────────────────────────────────────
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const filename = `Zenith_Book_of_Business_${new Date().toISOString().slice(0,10)}.xlsx`

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Length', buffer.length)
    return res.send(buffer)

  } catch (err: any) {
    console.error('Book of Business export error:', err)
    return res.status(500).json({ error: err.message || 'Export failed' })
  }
}
