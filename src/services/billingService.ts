// src/services/billingService.ts
// Client-side service layer for billing operations
// All Stripe secret key operations go through /api/stripe/* serverless functions

import { supabase } from '../lib/supabase'
import { loadStripe } from '@stripe/stripe-js'

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)

// ─── Types ───────────────────────────────────────────────────
export interface PaymentMethod {
  id: string
  customer_id: string
  type: string
  provider: string
  external_id: string
  last_four: string
  exp_month: number
  exp_year: number
  is_default: boolean
  status: string
  created_at: string
}

export interface PaymentTransaction {
  id: string
  customer_id: string
  contract_id: string | null
  payment_method_id: string | null
  amount: number
  status: 'pending' | 'succeeded' | 'failed' | 'refunded'
  type: 'autopay' | 'manual' | 'link'
  external_id: string | null
  description: string | null
  attempted_at: string
  completed_at: string | null
  failure_reason: string | null
}

// ─── Setup Intent — save a card ──────────────────────────────
export async function createSetupIntent(params: {
  stripe_customer_id?: string
  customer_name?: string
  customer_email?: string
}) {
  const res = await fetch('/api/stripe/setup-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to create setup intent')
  }
  return res.json() as Promise<{ client_secret: string; stripe_customer_id: string }>
}

// ─── Confirm card setup (frontend Stripe.js) ─────────────────
export async function confirmCardSetup(clientSecret: string, cardElement: any) {
  const stripe = await stripePromise
  if (!stripe) throw new Error('Stripe not loaded')

  const result = await stripe.confirmCardSetup(clientSecret, {
    payment_method: { card: cardElement },
  })

  if (result.error) throw new Error(result.error.message)
  return result.setupIntent
}

// ─── Save payment method to Supabase ─────────────────────────
export async function savePaymentMethod(params: {
  customer_id: string
  stripe_payment_method_id: string
  last_four: string
  exp_month: number
  exp_year: number
  make_default: boolean
}) {
  // If making default, unset existing defaults
  if (params.make_default) {
    await supabase
      .from('payment_methods')
      .update({ is_default: false })
      .eq('customer_id', params.customer_id)
  }

  const { data, error } = await supabase
    .from('payment_methods')
    .insert({
      customer_id: params.customer_id,
      type: 'card',
      provider: 'stripe',
      external_id: params.stripe_payment_method_id,
      last_four: params.last_four,
      exp_month: params.exp_month,
      exp_year: params.exp_year,
      is_default: params.make_default,
      status: 'active',
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// ─── Update customer stripe_customer_id ──────────────────────
export async function updateStripeCustomerId(customerId: string, stripeCustomerId: string) {
  const { error } = await supabase
    .from('customers')
    .update({ stripe_customer_id: stripeCustomerId })
    .eq('id', customerId)
  if (error) throw error
}

// ─── Charge a payment method ─────────────────────────────────
export async function chargePaymentMethod(params: {
  stripe_customer_id: string
  payment_method_id: string // Stripe PM id
  amount_cents: number
  description: string
  customer_id: string        // Supabase customer id
  contract_id?: string
  supabase_pm_id?: string   // Supabase payment_methods.id
}) {
  // 1. Call serverless charge endpoint
  const res = await fetch('/api/stripe/charge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stripe_customer_id: params.stripe_customer_id,
      payment_method_id: params.payment_method_id,
      amount_cents: params.amount_cents,
      description: params.description,
      metadata: {
        customer_id: params.customer_id,
        contract_id: params.contract_id || '',
      },
    }),
  })

  const json = await res.json()

  // 2. Log transaction regardless of success/failure
  const status = res.ok ? 'succeeded' : 'failed'
  const { data: tx, error: txError } = await supabase
    .from('payment_transactions')
    .insert({
      customer_id: params.customer_id,
      contract_id: params.contract_id || null,
      payment_method_id: params.supabase_pm_id || null,
      amount: params.amount_cents / 100,
      status,
      type: 'autopay',
      external_id: json.payment_intent_id || null,
      description: params.description,
      attempted_at: new Date().toISOString(),
      completed_at: res.ok ? new Date().toISOString() : null,
      failure_reason: !res.ok ? (json.error || json.stripe_code || 'unknown') : null,
    })
    .select()
    .single()

  if (txError) console.error('Failed to log transaction:', txError)

  if (!res.ok) throw new Error(json.error || 'Payment failed')
  return { transaction: tx, paymentIntent: json }
}

// ─── Create invoice payment link ─────────────────────────────
export async function createInvoicePaymentLink(params: {
  amount_cents: number
  description: string
  customer_name: string
  contract_number?: string
  customer_id: string
  contract_id?: string
}) {
  const res = await fetch('/api/stripe/payment-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to create payment link')
  }
  return res.json() as Promise<{ url: string; payment_link_id: string }>
}

// ─── Fetch payment methods from Supabase ─────────────────────
export async function fetchPaymentMethods(customerId: string): Promise<PaymentMethod[]> {
  const { data, error } = await supabase
    .from('payment_methods')
    .select('*')
    .eq('customer_id', customerId)
    .eq('status', 'active')
    .order('is_default', { ascending: false })
  if (error) throw error
  return data || []
}

// ─── Fetch payment transactions from Supabase ────────────────
export async function fetchPaymentTransactions(customerId: string): Promise<PaymentTransaction[]> {
  const { data, error } = await supabase
    .from('payment_transactions')
    .select('*')
    .eq('customer_id', customerId)
    .order('attempted_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data || []
}

// ─── Fetch failed payments (last 48h) for dashboard ─────────
export async function fetchRecentFailedPayments() {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('payment_transactions')
    .select(`
      *,
      customers!inner(id, full_name, phone)
    `)
    .eq('status', 'failed')
    .gte('attempted_at', cutoff)
    .order('amount', { ascending: false })
    .limit(20)
  if (error) throw error
  return data || []
}

// ─── Set default payment method ──────────────────────────────
export async function setDefaultPaymentMethod(customerId: string, pmId: string) {
  await supabase
    .from('payment_methods')
    .update({ is_default: false })
    .eq('customer_id', customerId)

  const { error } = await supabase
    .from('payment_methods')
    .update({ is_default: true })
    .eq('id', pmId)

  if (error) throw error
}

// ─── Remove payment method ───────────────────────────────────
export async function removePaymentMethod(pmId: string) {
  const { error } = await supabase
    .from('payment_methods')
    .update({ status: 'removed' })
    .eq('id', pmId)
  if (error) throw error
}
