// documentsService.ts
// Auto-numbering for all Zenith document types
// Called whenever a new quote, agreement, or invoice is created

import { supabase } from '../lib/supabase'

// ─────────────────────────────────────────────
// DOCUMENT NUMBER GENERATORS
// These call Supabase functions that use sequences
// ─────────────────────────────────────────────

export async function generateRentalQuoteNumber(): Promise<string> {
  const { data, error } = await supabase.rpc('generate_rental_quote_number')
  if (error) throw new Error('Failed to generate rental quote number: ' + error.message)
  return data as string
  // Returns: Q-2026-0001
}

export async function generatePurchaseOrderNumber(): Promise<string> {
  const { data, error } = await supabase.rpc('generate_purchase_order_number')
  if (error) throw new Error('Failed to generate purchase order number: ' + error.message)
  return data as string
  // Returns: SO00111, SO00112...
}

export async function generateRentalAgreementNumber(): Promise<string> {
  const { data, error } = await supabase.rpc('generate_rental_agreement_number')
  if (error) throw new Error('Failed to generate rental agreement number: ' + error.message)
  return data as string
  // Returns: RA-2026-0001
}

export async function generateInvoiceNumber(): Promise<string> {
  const { data, error } = await supabase.rpc('generate_invoice_number')
  if (error) throw new Error('Failed to generate invoice number: ' + error.message)
  return data as string
  // Returns: INV-2026-0001
}

// ─────────────────────────────────────────────
// CREATE DOCUMENTS
// ─────────────────────────────────────────────

interface CreateRentalQuoteParams {
  customerId: string
  productId?: string
  lineItems: { description: string; quantity: number; unit_price: number; total: number; product_id?: string }[]
  monthlyAmount: number
  installFee: number
  notes?: string
  createdBy: string
}

export async function createRentalQuote(params: CreateRentalQuoteParams) {
  const quoteNumber = await generateRentalQuoteNumber()
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 30) // 30 day expiry

  const { data, error } = await supabase
    .from('quotes')
    .insert({
      quote_number: quoteNumber,
      quote_type: 'rental',
      customer_id: params.customerId,
      product_id: params.productId,
      status: 'draft',
      monthly_amount: params.monthlyAmount,
      install_fee: params.installFee,
      notes: params.notes,
      expires_at: expiresAt.toISOString(),
      created_by: params.createdBy,
    })
    .select()
    .single()

  if (error) throw error

  // Insert line items
  if (params.lineItems.length > 0) {
    await supabase.from('document_line_items').insert(
      params.lineItems.map((item, i) => ({
        document_id: data.id,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.total,
        product_id: item.product_id,
        sort_order: i,
      }))
    )
  }

  return data
}

interface CreatePurchaseQuoteParams {
  customerId: string
  lineItems: { description: string; quantity: number; unit_price: number; total: number; product_id?: string; sku?: string }[]
  subtotal: number
  taxAmount: number
  total: number
  depositType: '50_percent' | 'full'
  notes?: string
  salesConsultant?: string
  createdBy: string
}

export async function createPurchaseQuote(params: CreatePurchaseQuoteParams) {
  const quoteNumber = await generatePurchaseOrderNumber()
  const depositAmount = params.depositType === '50_percent'
    ? Math.round(params.total * 0.5 * 100) / 100
    : params.total

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 30)

  const { data, error } = await supabase
    .from('quotes')
    .insert({
      quote_number: quoteNumber,
      quote_type: 'purchase',
      customer_id: params.customerId,
      status: 'draft',
      subtotal: params.subtotal,
      tax_amount: params.taxAmount,
      total: params.total,
      deposit_type: params.depositType,
      deposit_amount: depositAmount,
      notes: params.notes,
      expires_at: expiresAt.toISOString(),
      created_by: params.createdBy,
    })
    .select()
    .single()

  if (error) throw error

  if (params.lineItems.length > 0) {
    await supabase.from('document_line_items').insert(
      params.lineItems.map((item, i) => ({
        document_id: data.id,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.total,
        product_id: item.product_id,
        sort_order: i,
      }))
    )
  }

  return data
}

// ─────────────────────────────────────────────
// SIGN QUOTE → AUTO-GENERATE NEXT DOCUMENT
// ─────────────────────────────────────────────

export async function signQuoteAndGenerateAgreement(
  quoteId: string,
  signedName: string,
  signedIp: string
) {
  // 1. Mark quote signed
  const { data: quote, error: quoteErr } = await supabase
    .from('quotes')
    .update({
      status: 'signed',
      signed_at: new Date().toISOString(),
      signed_name: signedName,
      signed_ip: signedIp,
    })
    .eq('id', quoteId)
    .select()
    .single()

  if (quoteErr) throw quoteErr

  // 2. Get line items for snapshot
  const { data: lineItems } = await supabase
    .from('document_line_items')
    .select('*')
    .eq('document_id', quoteId)

  // 3. Get term blocks snapshot (rental agreement articles)
  const { data: termBlocks } = await supabase
    .from('term_blocks')
    .select('slug, display_title, content, version')
    .eq('document_type', 'rental_agreement')
    .eq('is_active', true)
    .order('sort_order')

  // 4. Generate agreement number
  const agreementNumber = await generateRentalAgreementNumber()

  // 5. Create the rental agreement
  const { data: agreement, error: agErr } = await supabase
    .from('agreements')
    .insert({
      agreement_number: agreementNumber,
      quote_id: quoteId,
      customer_id: quote.customer_id,
      product_id: quote.product_id,
      agreement_type: 'rental',
      status: 'pending_signature',
      monthly_amount: quote.monthly_amount,
      install_fee: quote.install_fee,
      term_months: 36,
      terms_snapshot: { blocks: termBlocks || [] },
      line_items_snapshot: lineItems || [],
    })
    .select()
    .single()

  if (agErr) throw agErr
  return { quote, agreement }
}

export async function signQuoteAndGenerateInvoice(
  quoteId: string,
  signedName: string,
  signedIp: string,
  depositType: '50_percent' | 'full' = '50_percent'
) {
  // 1. Mark quote signed
  const { data: quote, error: quoteErr } = await supabase
    .from('quotes')
    .update({
      status: 'signed',
      signed_at: new Date().toISOString(),
      signed_name: signedName,
      signed_ip: signedIp,
    })
    .eq('id', quoteId)
    .select()
    .single()

  if (quoteErr) throw quoteErr

  // 2. Get line items
  const { data: lineItems } = await supabase
    .from('document_line_items')
    .select('*')
    .eq('document_id', quoteId)

  // 3. Get purchase T&C snapshot
  const { data: termBlocks } = await supabase
    .from('term_blocks')
    .select('slug, display_title, content, version')
    .eq('document_type', 'purchase_invoice')
    .eq('is_active', true)
    .order('sort_order')

  // 4. Calculate deposit
  const depositAmount = depositType === '50_percent'
    ? Math.round((quote.total || 0) * 0.5 * 100) / 100
    : quote.total || 0

  // 5. Generate invoice number
  const invoiceNumber = await generateInvoiceNumber()

  // 6. Create invoice
  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .insert({
      invoice_number: invoiceNumber,
      quote_id: quoteId,
      customer_id: quote.customer_id,
      invoice_type: 'purchase',
      status: 'draft',
      subtotal: quote.subtotal || 0,
      tax_amount: quote.tax_amount || 0,
      total: quote.total || 0,
      deposit_percent: depositType === '50_percent' ? 50 : 100,
      deposit_amount: depositAmount,
      amount_due: depositAmount,
      terms_snapshot: { blocks: termBlocks || [] },
      line_items_snapshot: lineItems || [],
    })
    .select()
    .single()

  if (invErr) throw invErr
  return { quote, invoice }
}

// ─────────────────────────────────────────────
// SIGN AGREEMENT → ENROLL AUTOPAY
// ─────────────────────────────────────────────

export async function signAgreement(
  agreementId: string,
  signedName: string,
  signedIp: string
) {
  const { data, error } = await supabase
    .from('agreements')
    .update({
      status: 'signed',
      signed_at: new Date().toISOString(),
      signed_name: signedName,
      signed_ip: signedIp,
    })
    .eq('id', agreementId)
    .select()
    .single()

  if (error) throw error
  // After this: redirect customer to Stripe checkout for first month payment
  return data
}

// ─────────────────────────────────────────────
// FETCH HELPERS
// ─────────────────────────────────────────────

export async function getQuoteByToken(token: string) {
  const { data, error } = await supabase
    .from('quotes')
    .select(`
      *,
      customers(first_name, last_name, email, phone, address, city, state, zip)
    `)
    .eq('public_token', token)
    .single()
  if (error) throw error
  return data
}

export async function getAgreementByToken(token: string) {
  const { data, error } = await supabase
    .from('agreements')
    .select(`
      *,
      customers(first_name, last_name, email, phone, address, city, state, zip)
    `)
    .eq('public_token', token)
    .single()
  if (error) throw error
  return data
}

export async function getInvoiceByToken(token: string) {
  const { data, error } = await supabase
    .from('invoices')
    .select(`
      *,
      customers(first_name, last_name, email, phone, address, city, state, zip)
    `)
    .eq('public_token', token)
    .single()
  if (error) throw error
  return data
}

export async function getQuotesForCustomer(customerId: string) {
  const { data, error } = await supabase
    .from('quotes')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getAgreementsForCustomer(customerId: string) {
  const { data, error } = await supabase
    .from('agreements')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getInvoicesForCustomer(customerId: string) {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}
