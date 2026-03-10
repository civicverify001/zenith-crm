// src/services/quotesService.ts

import { supabase } from '../lib/supabase'

// ─── Types ───────────────────────────────────────────────────

export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired' | 'superseded'
export type CommercialType = 'rental' | 'purchase' | 'financed'
export type LineItemType = 'product' | 'install_fee' | 'maintenance' | 'discount' | 'custom'

export interface QuoteLineItem {
  id?: string
  quote_id?: string
  product_id?: string | null
  description: string
  quantity: number
  unit_price: number
  total: number
  item_type: LineItemType
  sort_order: number
  sku?: string
}

export interface Quote {
  id: string
  quote_number: string
  customer_id: string
  opportunity_id?: string | null
  created_by?: string | null
  commercial_type: CommercialType
  status: QuoteStatus
  term_set_id?: string | null
  line_items_snapshot?: any
  terms_snapshot?: any
  subtotal: number
  tax_amount: number
  total: number
  notes?: string | null
  valid_until?: string | null
  sent_at?: string | null
  viewed_at?: string | null
  accepted_at?: string | null
  declined_at?: string | null
  accept_token?: string | null
  decline_reason?: string | null
  created_at: string
  updated_at: string
  customer_name?: string
  customer_email?: string
  customer_phone?: string
  customer_address?: string
  line_items?: QuoteLineItem[]
}

export interface Product {
  id: string
  name: string
  sku?: string | null
  category?: string | null
  description?: string | null
  retail_price?: number | null
  rental_price_monthly?: number | null
  install_fee?: number | null
  maintenance_price_monthly?: number | null
  filter_interval_months?: number | null
  warranty_months?: number | null
  is_active: boolean
}

// ─── Products ────────────────────────────────────────────────

export async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return data || []
}

// ─── Quotes — list ───────────────────────────────────────────

export async function fetchQuotes(customerId?: string): Promise<Quote[]> {
  let q = supabase
    .from('quotes')
    .select('*')
    .order('created_at', { ascending: false })

  if (customerId) q = q.eq('customer_id', customerId)

  const { data: quotes, error } = await q
  if (error) throw error
  if (!quotes || quotes.length === 0) return []

  const customerIds = [...new Set(quotes.map((r: any) => r.customer_id).filter(Boolean))] as string[]
  const { data: customers } = customerIds.length
    ? await supabase.from('customers').select('id, full_name, email, phone').in('id', customerIds)
    : { data: [] }

  const custMap: Record<string, any> = {}
  for (const c of customers || []) custMap[c.id] = c

  return quotes.map((row: any) => {
    const c = custMap[row.customer_id] || {}
    return {
      ...row,
      customer_name:    c.full_name || '',
      customer_email:   c.email || '',
      customer_phone:   c.phone || '',
      customer_address: '',
    }
  })
}

// ─── Quote — single with line items ──────────────────────────

export async function fetchQuote(quoteId: string): Promise<Quote | null> {
  const { data, error } = await supabase
    .from('quotes')
    .select(`*, quote_line_items ( * )`)
    .eq('id', quoteId)
    .single()

  if (error) throw error
  if (!data) return null

  const { data: cust } = await supabase
    .from('customers')
    .select('id, full_name, email, phone')
    .eq('id', data.customer_id)
    .single()

  return {
    ...data,
    customer_name:    cust?.full_name || '',
    customer_email:   cust?.email || '',
    customer_phone:   cust?.phone || '',
    customer_address: cust?.service_address || '',
    line_items: (data.quote_line_items || []).sort((a: any, b: any) => a.sort_order - b.sort_order),
  }
}

// ─── Create quote (draft) ────────────────────────────────────

export async function createQuote(params: {
  customer_id: string
  commercial_type: CommercialType
  opportunity_id?: string | null
  created_by?: string | null
  notes?: string
  valid_until?: string
  line_items: Omit<QuoteLineItem, 'id' | 'quote_id'>[]
}): Promise<Quote> {
  const subtotal = params.line_items.reduce((s, li) => s + li.total, 0)
  const tax_amount = parseFloat((subtotal * 0.07).toFixed(2))
  const total = parseFloat((subtotal + tax_amount).toFixed(2))

  const { data: quote, error: qErr } = await supabase
    .from('quotes')
    .insert({
      customer_id:     params.customer_id,
      commercial_type: params.commercial_type,
      opportunity_id:  params.opportunity_id || null,
      created_by:      params.created_by || null,
      notes:           params.notes || null,
      valid_until:     params.valid_until || null,
      subtotal,
      tax_amount,
      total,
      status:          'draft',
    })
    .select()
    .single()

  if (qErr) throw qErr

  if (params.line_items.length > 0) {
    const lineItems = params.line_items.map((li, i) => ({
      quote_id:    quote.id,
      product_id:  li.product_id || null,
      description: li.description,
      quantity:    li.quantity,
      unit_price:  li.unit_price,
      total:       li.total,
      item_type:   li.item_type,
      sort_order:  i,
    }))

    const { error: liErr } = await supabase.from('quote_line_items').insert(lineItems)
    if (liErr) throw liErr
  }

  return quote
}

// ─── Update draft quote ───────────────────────────────────────

export async function updateQuote(quoteId: string, params: {
  commercial_type?: CommercialType
  notes?: string
  valid_until?: string
  line_items?: Omit<QuoteLineItem, 'id' | 'quote_id'>[]
}): Promise<void> {
  const { data: existing } = await supabase
    .from('quotes')
    .select('status')
    .eq('id', quoteId)
    .single()

  if (existing?.status !== 'draft') throw new Error('Cannot edit a non-draft quote')

  if (params.line_items !== undefined) {
    await supabase.from('quote_line_items').delete().eq('quote_id', quoteId)

    const subtotal = params.line_items.reduce((s, li) => s + li.total, 0)
    const tax_amount = parseFloat((subtotal * 0.07).toFixed(2))
    const total = parseFloat((subtotal + tax_amount).toFixed(2))

    if (params.line_items.length > 0) {
      const lineItems = params.line_items.map((li, i) => ({
        quote_id:    quoteId,
        product_id:  li.product_id || null,
        description: li.description,
        quantity:    li.quantity,
        unit_price:  li.unit_price,
        total:       li.total,
        item_type:   li.item_type,
        sort_order:  i,
      }))
      await supabase.from('quote_line_items').insert(lineItems)
    }

    await supabase
      .from('quotes')
      .update({
        commercial_type: params.commercial_type,
        notes:           params.notes,
        valid_until:     params.valid_until,
        subtotal,
        tax_amount,
        total,
      })
      .eq('id', quoteId)
  }
}

// ─── Send quote (freeze snapshot + generate accept token) ────

export async function sendQuote(quoteId: string): Promise<string> {
  // Generate a unique accept token
  const accept_token = crypto.randomUUID()

  // Fetch line items to snapshot
  const { data: lineItems } = await supabase
    .from('quote_line_items')
    .select('*')
    .eq('quote_id', quoteId)
    .order('sort_order')

  const snapshot = lineItems || []

  const { error } = await supabase
    .from('quotes')
    .update({
      status:              'sent',
      sent_at:             new Date().toISOString(),
      line_items_snapshot: snapshot,
      accept_token,
    })
    .eq('id', quoteId)
    .eq('status', 'draft') // guard: only send drafts

  if (error) throw error

  // Log audit
  await supabase.from('document_audit_log').insert({
    entity_type: 'quote',
    entity_id:   quoteId,
    event:       'sent',
    actor_type:  'staff',
  })

  // Return the token so the UI can show/copy the link
  return accept_token
}

// ─── Get public review URL ───────────────────────────────────

export function getQuoteReviewUrl(accept_token: string): string {
  const base = window.location.origin
  return `${base}/q/${accept_token}`
}

// ─── Status helpers ───────────────────────────────────────────

export const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft:       'Draft',
  sent:        'Sent',
  viewed:      'Viewed',
  accepted:    'Accepted',
  declined:    'Declined',
  expired:     'Expired',
  superseded:  'Superseded',
}

export const STATUS_COLORS: Record<QuoteStatus, { bg: string; text: string }> = {
  draft:      { bg: '#1e293b', text: '#94a3b8' },
  sent:       { bg: '#1e3a5f', text: '#60a5fa' },
  viewed:     { bg: '#1c3a2e', text: '#34d399' },
  accepted:   { bg: '#14532d', text: '#4ade80' },
  declined:   { bg: '#3b1414', text: '#f87171' },
  expired:    { bg: '#27272a', text: '#71717a' },
  superseded: { bg: '#27272a', text: '#71717a' },
}

export const TYPE_LABELS: Record<CommercialType, string> = {
  rental:   'Rental',
  purchase: 'Purchase',
  financed: 'Financed',
}

export const TYPE_COLORS: Record<CommercialType, string> = {
  rental:   '#22d3ee',
  purchase: '#4ade80',
  financed: '#f472b6',
}
