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
const AMBER = 'FFFBEB'

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December']
const pad = (n: number) => String(n).padStart(2, '0')
const usd = (n: number) => `$${n.toFixed(2)}`

// Helper to style a cell
const style = (cell: ExcelJS.Cell, opts: {
  value?: any; bold?: boolean; size?: number; color?: string;
  bg?: string; align?: ExcelJS.Alignment['horizontal']; italic?: boolean;
  borderColor?: string; borderStyle?: ExcelJS.BorderStyle;
}) => {
  if (opts.value !== undefined) cell.value = opts.value
  cell.font = {
    name: 'Arial',
    bold: opts.bold ?? false,
    size: opts.size ?? 10,
    italic: opts.italic ?? false,
    color: { argb: opts.color ?? '334155' },
  }
  if (opts.bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.bg } }
  if (opts.align) cell.alignment = { ...cell.alignment, horizontal: opts.align, vertical: 'middle' }
  if (opts.borderColor) {
    const b = { style: (opts.borderStyle ?? 'thin') as ExcelJS.BorderStyle, color: { argb: opts.borderColor } }
    cell.border = { top: b, bottom: b, left: b, right: b }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  try {
    const { year, month, mode = 'monthly' } = req.query
    const y = parseInt(year as string) || new Date().getFullYear()
    const m = parseInt(month as string) || new Date().getMonth() + 1

    const startDate = mode === 'yearly' ? `${y}-01-01` : `${y}-${pad(m)}-01`
    const nextM = m === 12 ? 1 : m + 1
    const nextY = m === 12 ? y + 1 : y
    const endDate  = mode === 'yearly' ? `${y+1}-01-01` : `${nextY}-${pad(nextM)}-01`
    const label    = mode === 'yearly' ? `Annual ${y}` : `${MONTHS[m-1]} ${y}`
    const dueMonth = m === 12 ? 'January' : MONTHS[m]
    const dueYear  = m === 12 ? y + 1 : y
    const today    = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    const { data: tx }     = await supabase.from('payment_transactions')
      .select('amount,type,status,completed_at,description')
      .eq('status', 'succeeded').gte('completed_at', startDate).lt('completed_at', endDate).order('completed_at')
    const { data: quotes } = await supabase.from('quotes')
      .select('subtotal,tax_amount,total,commercial_type,accepted_at,created_at')
      .in('status', ['accepted','sent']).gte('created_at', startDate).lt('created_at', endDate)

    type Row = { label:string; rental:number; purchase:number; install:number; taxable:number; tax:number; total:number; count:number }
    const map: Record<string, Row> = {}
    const getKey = (d: string) => mode === 'yearly' ? `${y}-${pad(new Date(d).getMonth()+1)}` : new Date(d).toISOString().slice(0,10)
    const getLabel = (k: string) => mode === 'yearly' ? `${MONTHS[parseInt(k.split('-')[1])-1]} ${y}` : k
    const ensure = (k: string) => { if (!map[k]) map[k] = { label: getLabel(k), rental:0,purchase:0,install:0,taxable:0,tax:0,total:0,count:0 } }

    if (mode === 'yearly') for (let i=1;i<=12;i++) ensure(`${y}-${pad(i)}`)

    if ((tx||[]).length > 0) {
      for (const t of tx!) {
        const k = getKey(t.completed_at); ensure(k)
        const amt = parseFloat(t.amount)||0; const pre = amt/(1+TAX); const tax = amt-pre
        const isI = (t.description||'').toLowerCase().includes('install')
        const isR = t.type==='autopay'||(t.description||'').toLowerCase().includes('rental')
        if (isI) map[k].install+=pre; else if (isR) map[k].rental+=pre; else map[k].purchase+=pre
        map[k].taxable+=pre; map[k].tax+=tax; map[k].total+=amt; map[k].count++
      }
    } else {
      for (const q of quotes||[]) {
        const k = getKey(q.accepted_at||q.created_at); ensure(k)
        const sub=parseFloat(q.subtotal)||0; const tax=parseFloat(q.tax_amount)||sub*TAX; const tot=parseFloat(q.total)||sub+tax
        if (q.commercial_type==='rental') map[k].rental+=sub; else map[k].purchase+=sub
        map[k].taxable+=sub; map[k].tax+=tax; map[k].total+=tot; map[k].count++
      }
    }

    const rows = Object.entries(map).sort(([a],[b])=>a.localeCompare(b)).map(([,v])=>v)
    const tot  = rows.reduce((a,r)=>({label:'',rental:a.rental+r.rental,purchase:a.purchase+r.purchase,install:a.install+r.install,taxable:a.taxable+r.taxable,tax:a.tax+r.tax,total:a.total+r.total,count:a.count+r.count}),{label:'',rental:0,purchase:0,install:0,taxable:0,tax:0,total:0,count:0})

    // ── Workbook ──────────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Zenith Pure Solutions LLC'
    wb.created = new Date()

    // ══════════════════════════════════════════════════════════════════════════
    // SHEET 1 — consistent 8-column layout throughout
    // Cols: A=Period/Label1(22), B=Value1(18), C=Label2(22), D=Value2(18),
    //       E=Label3(22), F=Value3(18), G=Label4(22), H=Value4(18)
    // ══════════════════════════════════════════════════════════════════════════
    const ws = wb.addWorksheet(label, { pageSetup: { orientation: 'landscape' } })
    ws.columns = [
      { width: 22 }, { width: 18 }, // A-B
      { width: 22 }, { width: 18 }, // C-D
      { width: 22 }, { width: 18 }, // E-F  (data table: Taxable Sales / Sales Tax)
      { width: 20 }, { width: 14 }, // G-H  (Total Collected / Transactions)
    ]

    // ── Row 1: Title ──────────────────────────────────────────────────────────
    ws.mergeCells('A1:H1')
    Object.assign(ws.getCell('A1'), {
      value: 'ZENITH PURE SOLUTIONS LLC — INDIANA SALES TAX REPORT',
      font: { name:'Arial', bold:true, size:15, color:{argb:WHITE} },
      fill: { type:'pattern', pattern:'solid', fgColor:{argb:NAVY} },
      alignment: { horizontal:'center', vertical:'middle' },
    }); ws.getRow(1).height = 34

    ws.mergeCells('A2:H2')
    Object.assign(ws.getCell('A2'), {
      value: `Period: ${label}  ·  Indiana Sales Tax Rate: 7.00%  ·  Form ST-103`,
      font: { name:'Arial', size:10, color:{argb:'B0C4D8'} },
      fill: { type:'pattern', pattern:'solid', fgColor:{argb:NAVY} },
      alignment: { horizontal:'center', vertical:'middle' },
    }); ws.getRow(2).height = 18

    ws.mergeCells('A3:H3')
    Object.assign(ws.getCell('A3'), {
      value: `Generated: ${today}  ·  File with Indiana DOR by ${dueMonth} 20, ${dueYear}  ·  intime.dor.in.gov`,
      font: { name:'Arial', size:10, color:{argb:'B0C4D8'} },
      fill: { type:'pattern', pattern:'solid', fgColor:{argb:NAVY} },
      alignment: { horizontal:'center', vertical:'middle' },
    }); ws.getRow(3).height = 18

    ws.addRow([]) // Row 4 spacer

    // ── Row 5: Filing Summary Title ───────────────────────────────────────────
    ws.mergeCells('A5:H5')
    Object.assign(ws.getCell('A5'), {
      value: '  INDIANA ST-103 FILING SUMMARY',
      font: { name:'Arial', bold:true, size:12, color:{argb:WHITE} },
      fill: { type:'pattern', pattern:'solid', fgColor:{argb:DARK} },
      alignment: { horizontal:'left', vertical:'middle' },
    }); ws.getRow(5).height = 26

    // ── Rows 6-9: Summary data (4 rows × 4 pairs = label/value/label/value) ──
    // Each row: A=label, B=value, C=label, D=value, E=label, F=value  (using A-F, 6 cols)
    // Actually let's use 2 pairs per row across A-D, leave E-H empty with bg

    const summaryData = [
      ['Gross Sales (Total Collected)', usd(tot.total),   'Taxable Sales (Pre-Tax)', usd(tot.taxable)],
      ['Sales Tax Due @ 7.00%',         usd(tot.tax),     'Non-Taxable Revenue',     usd(tot.install)],
      ['Tax Period',                    label,             'Filing Due Date',         `${dueMonth} 20, ${dueYear}`],
      ['Filing Portal',                 'intime.dor.in.gov','Form',                  'ST-103 Monthly Sales Tax Return'],
    ]

    summaryData.forEach(([l1,v1,l2,v2], i) => {
      const rn = 6 + i
      const bg = i % 2 === 0 ? LIGHT : WHITE
      ws.getRow(rn).height = 22

      // A: label 1
      Object.assign(ws.getCell(`A${rn}`), {
        value: l1,
        font: { name:'Arial', size:10, color:{argb:'334155'} },
        fill: { type:'pattern', pattern:'solid', fgColor:{argb:bg} },
        alignment: { horizontal:'left', vertical:'middle', indent:1 },
        border: { left:{style:'medium',color:{argb:TEAL}}, bottom:{style:'thin',color:{argb:MID}} },
      })
      // B: value 1
      Object.assign(ws.getCell(`B${rn}`), {
        value: v1,
        font: { name:'Arial', bold:true, size:11, color:{argb:TEAL} },
        fill: { type:'pattern', pattern:'solid', fgColor:{argb:bg} },
        alignment: { horizontal:'right', vertical:'middle' },
        border: { right:{style:'thin',color:{argb:MID}}, bottom:{style:'thin',color:{argb:MID}} },
      })
      // C: label 2
      Object.assign(ws.getCell(`C${rn}`), {
        value: l2,
        font: { name:'Arial', size:10, color:{argb:'334155'} },
        fill: { type:'pattern', pattern:'solid', fgColor:{argb:bg} },
        alignment: { horizontal:'left', vertical:'middle', indent:1 },
        border: { bottom:{style:'thin',color:{argb:MID}} },
      })
      // D: value 2
      Object.assign(ws.getCell(`D${rn}`), {
        value: v2,
        font: { name:'Arial', bold:true, size:11, color:{argb:GOLD} },
        fill: { type:'pattern', pattern:'solid', fgColor:{argb:bg} },
        alignment: { horizontal:'right', vertical:'middle' },
        border: { right:{style:'medium',color:{argb:TEAL}}, bottom:{style:'thin',color:{argb:MID}} },
      })
      // E-H: empty with bg
      for (const col of ['E','F','G','H']) {
        ws.getCell(`${col}${rn}`).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'F8FAFC'} }
      }
    })

    // Top/bottom border on summary box
    for (const col of ['A','B','C','D','E','F','G','H']) {
      const top = ws.getCell(`${col}5`)
      const bot = ws.getCell(`${col}9`)
      top.border = { ...top.border, top:{style:'medium',color:{argb:TEAL}} }
      bot.border = { ...bot.border, bottom:{style:'medium',color:{argb:TEAL}} }
    }

    ws.addRow([]) // Row 10 spacer

    // ── Row 11: Data table headers ────────────────────────────────────────────
    const hRow = ws.addRow(['Period','Rental Revenue','Purchase Revenue','Install Revenue','Taxable Sales','Sales Tax (7%)','Total Collected','Transactions'])
    hRow.height = 24
    hRow.eachCell(cell => {
      cell.font  = { name:'Arial', bold:true, size:10, color:{argb:WHITE} }
      cell.fill  = { type:'pattern', pattern:'solid', fgColor:{argb:TEAL} }
      cell.alignment = { horizontal:'center', vertical:'middle' }
      cell.border = { bottom:{style:'medium',color:{argb:NAVY}} }
    })

    // Data rows
    rows.forEach((r, i) => {
      const bg    = i % 2 === 0 ? LIGHT : WHITE
      const isCur = r.total > 0 && mode === 'monthly'
      const row   = ws.addRow([
        r.label,
        r.rental   > 0 ? usd(r.rental)   : '—',
        r.purchase > 0 ? usd(r.purchase) : '—',
        r.install  > 0 ? usd(r.install)  : '—',
        r.taxable  > 0 ? usd(r.taxable)  : '—',
        r.tax      > 0 ? usd(r.tax)      : '—',
        r.total    > 0 ? usd(r.total)    : '—',
        r.count    > 0 ? r.count         : '—',
      ])
      row.height = 18
      row.eachCell((cell, col) => {
        cell.fill  = { type:'pattern', pattern:'solid', fgColor:{argb: isCur ? AMBER : bg} }
        cell.font  = { name:'Arial', size:9, color:{argb: isCur ? NAVY : '475569'} }
        cell.alignment = { vertical:'middle', horizontal: col === 1 ? 'left' : 'right' }
        cell.border = { bottom:{style:'thin',color:{argb:MID}} }
        if (col === 6) cell.font = { name:'Arial', size:9, bold:!!isCur, color:{argb:TEAL} }
        if (col === 7) cell.font = { name:'Arial', size:9, bold:!!isCur, color:{argb:GREEN} }
      })
    })

    // Totals
    const totRow = ws.addRow(['TOTALS', usd(tot.rental), usd(tot.purchase), usd(tot.install), usd(tot.taxable), usd(tot.tax), usd(tot.total), tot.count])
    totRow.height = 26
    totRow.eachCell((cell, col) => {
      cell.font  = { name:'Arial', bold:true, size:11, color:{argb:WHITE} }
      cell.fill  = { type:'pattern', pattern:'solid', fgColor:{argb:DARK} }
      cell.alignment = { vertical:'middle', horizontal: col===1 ? 'left' : 'right' }
      cell.border = { top:{style:'medium',color:{argb:TEAL}} }
      if (col===6) cell.font = { name:'Arial', bold:true, size:11, color:{argb:GOLD} }
      if (col===7) cell.font = { name:'Arial', bold:true, size:11, color:{argb:'4ADE80'} }
    })

    ws.addRow([])
    const noteRow = ws.addRow(['NOTE: Always reconcile against your Stripe dashboard before filing.  intime.dor.in.gov  ·  Form ST-103  ·  Due 20th of each month'])
    ws.mergeCells(`A${noteRow.number}:H${noteRow.number}`)
    noteRow.getCell(1).font = { name:'Arial', size:8, italic:true, color:{argb:'94A3B8'} }
    noteRow.getCell(1).alignment = { horizontal:'center' }

    // ══════════════════════════════════════════════════════════════════════════
    // SHEET 2 — Annual Overview
    // ══════════════════════════════════════════════════════════════════════════
    const ws2 = wb.addWorksheet(`${y} Annual Overview`)
    ws2.columns = [{ width:22 },{ width:18 },{ width:16 },{ width:20 },{ width:14 }]

    ws2.mergeCells('A1:E1')
    Object.assign(ws2.getCell('A1'), {
      value: `ZENITH PURE SOLUTIONS LLC — ${y} ANNUAL OVERVIEW`,
      font:  { name:'Arial', bold:true, size:13, color:{argb:WHITE} },
      fill:  { type:'pattern', pattern:'solid', fgColor:{argb:NAVY} },
      alignment: { horizontal:'center', vertical:'middle' },
    }); ws2.getRow(1).height = 30

    ws2.mergeCells('A2:E2')
    Object.assign(ws2.getCell('A2'), {
      value: `Indiana Sales Tax Rate: 7.00%  ·  Generated ${today}`,
      font:  { name:'Arial', size:9, color:{argb:'B0C4D8'} },
      fill:  { type:'pattern', pattern:'solid', fgColor:{argb:NAVY} },
      alignment: { horizontal:'center' },
    }); ws2.getRow(2).height = 16

    ws2.addRow([])
    const h2 = ws2.addRow(['Month','Taxable Sales','Sales Tax (7%)','Total Collected','Transactions'])
    h2.height = 22
    h2.eachCell(cell => {
      cell.font  = { name:'Arial', bold:true, size:10, color:{argb:WHITE} }
      cell.fill  = { type:'pattern', pattern:'solid', fgColor:{argb:TEAL} }
      cell.alignment = { horizontal:'center', vertical:'middle' }
    })

    let aTaxable=0,aTax=0,aTotal=0,aCount=0
    MONTHS.forEach((mn, mi) => {
      const k    = `${y}-${pad(mi+1)}`
      const r    = map[k]
      const isCur = mi+1===m && mode==='monthly'
      if (r) { aTaxable+=r.taxable; aTax+=r.tax; aTotal+=r.total; aCount+=r.count }
      const row = ws2.addRow([
        isCur ? `${mn} ${y}  ◄` : `${mn} ${y}`,
        r?.taxable>0 ? usd(r.taxable) : '—',
        r?.tax>0     ? usd(r.tax)     : '—',
        r?.total>0   ? usd(r.total)   : '—',
        r?.count>0   ? r.count        : '—',
      ])
      row.height = 18
      row.eachCell((cell, col) => {
        cell.fill  = { type:'pattern', pattern:'solid', fgColor:{argb: isCur ? AMBER : (mi%2===0 ? LIGHT : WHITE)} }
        cell.font  = { name:'Arial', size:9, ...(isCur ? {bold:true,color:{argb:NAVY}} : {color:{argb:'475569'}}) }
        cell.alignment = { vertical:'middle', horizontal: col===1 ? 'left' : 'right' }
        cell.border = { bottom:{style:'thin',color:{argb:MID}} }
        if (col===3 && r?.tax>0)   cell.font = { name:'Arial', size:9, color:{argb:TEAL},  bold:!!isCur }
        if (col===4 && r?.total>0) cell.font = { name:'Arial', size:9, color:{argb:GREEN}, bold:!!isCur }
      })
    })

    ws2.addRow([])
    const aRow = ws2.addRow(['ANNUAL TOTAL', usd(aTaxable), usd(aTax), usd(aTotal), aCount])
    aRow.height = 26
    aRow.eachCell((cell, col) => {
      cell.font  = { name:'Arial', bold:true, size:11, color:{argb:WHITE} }
      cell.fill  = { type:'pattern', pattern:'solid', fgColor:{argb:DARK} }
      cell.alignment = { vertical:'middle', horizontal: col===1 ? 'left' : 'right' }
      if (col===3) cell.font = { name:'Arial', bold:true, size:11, color:{argb:GOLD} }
      if (col===4) cell.font = { name:'Arial', bold:true, size:11, color:{argb:'4ADE80'} }
    })

    const filename = `Zenith_SalesTax_${label.replace(/\s+/g,'-')}.xlsx`
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`)
    const buffer = await wb.xlsx.writeBuffer()
    return res.send(Buffer.from(buffer))

  } catch (err: any) {
    console.error('Sales tax export error:', err)
    return res.status(500).json({ error: err.message })
  }
}
