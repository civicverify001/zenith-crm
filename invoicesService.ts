// src/services/invoicesService.ts
import { supabase } from '../lib/supabase'

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'partial' | 'overdue' | 'void'

export interface InvoiceLineItem {
  description: string
  quantity: number
  unit_price: number
  total: number
  item_type?: string
}

export interface Invoice {
  id: string
  invoice_number: string
  customer_id: string
  quote_id: string | null
  agreement_id: string | null
  status: InvoiceStatus
  line_items_snapshot: InvoiceLineItem[]
  subtotal: number
  tax_amount: number
  total: number
  amount_paid: number
  due_date: string | null
  sent_at: string | null
  paid_at: string | null
  payment_link_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
  // Joined
  customer_name?: string
  customer_email?: string
  customer_phone?: string
}

export type CreateInvoiceInput = {
  customer_id: string
  quote_id?: string
  agreement_id?: string
  line_items: InvoiceLineItem[]
  subtotal: number
  tax_amount: number
  total: number
  due_date?: string
  notes?: string
}

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft:   'Draft',
  sent:    'Sent',
  paid:    'Paid',
  partial: 'Partial',
  overdue: 'Overdue',
  void:    'Void',
}

export const STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft:   '#64748B',
  sent:    '#0EA5E9',
  paid:    '#16A34A',
  partial: '#F59E0B',
  overdue: '#DC2626',
  void:    '#94A3B8',
}

export async function fetchInvoices(customerId?: string): Promise<Invoice[]> {
  let q = supabase
    .from('invoices')
    .select('*, customers!invoices_customer_id_fkey(full_name, email, phone)')
    .order('created_at', { ascending: false })
  if (customerId) q = q.eq('customer_id', customerId)
  const { data, error } = await q
  if (error) throw error
  return (data || []).map((r: any) => ({
    ...r,
    customer_name:  r.customers?.full_name,
    customer_email: r.customers?.email,
    customer_phone: r.customers?.phone,
    line_items_snapshot: r.line_items_snapshot || [],
    subtotal:    parseFloat(r.subtotal)    || 0,
    tax_amount:  parseFloat(r.tax_amount)  || 0,
    total:       parseFloat(r.total)       || 0,
    amount_paid: parseFloat(r.amount_paid) || 0,
  }))
}

export async function fetchInvoice(id: string): Promise<Invoice | null> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*, customers!invoices_customer_id_fkey(full_name, email, phone)')
    .eq('id', id).single()
  if (error) return null
  return {
    ...data,
    customer_name:  data.customers?.full_name,
    customer_email: data.customers?.email,
    customer_phone: data.customers?.phone,
    line_items_snapshot: data.line_items_snapshot || [],
    subtotal:    parseFloat(data.subtotal)    || 0,
    tax_amount:  parseFloat(data.tax_amount)  || 0,
    total:       parseFloat(data.total)       || 0,
    amount_paid: parseFloat(data.amount_paid) || 0,
  }
}

export async function createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
  const { data, error } = await supabase.from('invoices').insert({
    customer_id:         input.customer_id,
    quote_id:            input.quote_id    || null,
    agreement_id:        input.agreement_id || null,
    status:              'draft',
    line_items_snapshot: input.line_items,
    subtotal:            input.subtotal,
    tax_amount:          input.tax_amount,
    total:               input.total,
    due_date:            input.due_date || null,
    notes:               input.notes    || null,
  }).select().single()
  if (error) throw error
  return data
}

export async function createInvoiceFromQuote(quoteId: string): Promise<Invoice> {
  const { data: quote, error } = await supabase
    .from('quotes').select('*, quote_line_items(*)').eq('id', quoteId).single()
  if (error || !quote) throw new Error('Quote not found')
  const lineItems: InvoiceLineItem[] = (quote.quote_line_items || []).map((li: any) => ({
    description: li.description,
    quantity:    li.quantity,
    unit_price:  parseFloat(li.unit_price),
    total:       parseFloat(li.total),
    item_type:   li.item_type,
  }))
  return createInvoice({
    customer_id: quote.customer_id,
    quote_id:    quoteId,
    line_items:  lineItems,
    subtotal:    parseFloat(quote.subtotal),
    tax_amount:  parseFloat(quote.tax_amount),
    total:       parseFloat(quote.total),
    due_date:    new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
  })
}

export async function updateInvoiceStatus(id: string, status: InvoiceStatus, extra?: Partial<Invoice>): Promise<void> {
  const updates: any = { status, ...extra }
  if (status === 'sent' && !extra?.sent_at) updates.sent_at = new Date().toISOString()
  if (status === 'paid' && !extra?.paid_at) updates.paid_at = new Date().toISOString()
  const { error } = await supabase.from('invoices').update(updates).eq('id', id)
  if (error) throw error
}

export async function markInvoicePaid(id: string, amount?: number): Promise<void> {
  const inv = await fetchInvoice(id)
  if (!inv) throw new Error('Invoice not found')
  const paid   = amount ?? inv.total
  const status: InvoiceStatus = paid >= inv.total ? 'paid' : 'partial'
  await supabase.from('invoices').update({
    status, amount_paid: paid, paid_at: new Date().toISOString()
  }).eq('id', id)
}

export async function voidInvoice(id: string): Promise<void> {
  const { error } = await supabase.from('invoices').update({ status: 'void' }).eq('id', id)
  if (error) throw error
}

export async function refreshOverdueInvoices(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  await supabase.from('invoices').update({ status: 'overdue' })
    .in('status', ['sent', 'partial']).lt('due_date', today)
}

export function balanceDue(inv: Invoice): number {
  return Math.max(0, inv.total - inv.amount_paid)
}
