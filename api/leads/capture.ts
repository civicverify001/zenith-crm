import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Server-side Supabase client with service role key (bypasses RLS)
function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key)
}

// Simple validation
function validatePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return digits
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return null
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers — allow any origin (website forms, landing pages)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  // Only POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' })
  }

  try {
    const body = req.body || {}

    // ─── Extract fields ────────────────────────────────────
    const fullName = (body.full_name || body.name || '').trim()
    const phone = (body.phone || '').trim()
    const email = (body.email || '').trim()
    const address = (body.address || '').trim()
    const city = (body.city || '').trim()
    const state = (body.state || '').trim()
    const zipCode = (body.zip_code || body.zip || '').trim()
    const waterConcern = (body.water_concern || '').trim()
    const notes = (body.notes || '').trim()

    // ─── Validate required fields ──────────────────────────
    if (!fullName) {
      return res.status(400).json({ error: 'full_name is required' })
    }
    if (!phone) {
      return res.status(400).json({ error: 'phone is required' })
    }

    const cleanPhone = validatePhone(phone)
    if (!cleanPhone) {
      return res.status(400).json({ error: 'Invalid phone number. Must be 10 digits.' })
    }

    if (email && !validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' })
    }

    // ─── Initialize Supabase ───────────────────────────────
    const supabase = getSupabase()

    // ─── Duplicate check — phone or email match ────────────
    const { data: existingByPhone } = await supabase
      .from('leads')
      .select('id, full_name, stage')
      .eq('phone', cleanPhone)
      .limit(1)
      .maybeSingle()

    if (existingByPhone) {
      return res.status(409).json({
        error: 'A lead with this phone number already exists',
        existing_lead_id: existingByPhone.id,
        existing_name: existingByPhone.full_name,
        existing_stage: existingByPhone.stage,
      })
    }

    if (email) {
      const { data: existingByEmail } = await supabase
        .from('leads')
        .select('id, full_name, stage')
        .eq('email', email)
        .limit(1)
        .maybeSingle()

      if (existingByEmail) {
        return res.status(409).json({
          error: 'A lead with this email already exists',
          existing_lead_id: existingByEmail.id,
          existing_name: existingByEmail.full_name,
          existing_stage: existingByEmail.stage,
        })
      }
    }

    // ─── Also check existing customers ─────────────────────
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id, full_name')
      .eq('phone', cleanPhone)
      .limit(1)
      .maybeSingle()

    // ─── Create lead ───────────────────────────────────────
    const leadData: Record<string, any> = {
      full_name: fullName,
      phone: cleanPhone,
      stage: 'new',
      source: 'website',
    }

    if (email) leadData.email = email
    if (address) leadData.address = address
    if (city) leadData.city = city
    if (state) leadData.state = state
    if (zipCode) leadData.zip_code = zipCode
    if (waterConcern) leadData.water_concern = waterConcern
    if (notes) leadData.notes = notes

    const { data: lead, error: insertError } = await supabase
      .from('leads')
      .insert(leadData)
      .select('id, full_name, phone, email, stage, created_at')
      .single()

    if (insertError) {
      console.error('Lead insert failed:', insertError)
      return res.status(500).json({ error: 'Failed to create lead', detail: insertError.message })
    }

    // ─── Response ──────────────────────────────────────────
    const response: Record<string, any> = {
      success: true,
      lead_id: lead.id,
      message: 'Lead created successfully',
    }

    // Flag if this person is already a customer
    if (existingCustomer) {
      response.warning = 'This phone number matches an existing customer'
      response.existing_customer_id = existingCustomer.id
      response.existing_customer_name = existingCustomer.full_name
    }

    return res.status(201).json(response)

  } catch (err: any) {
    console.error('Lead capture error:', err)
    return res.status(500).json({ error: 'Internal server error', detail: err.message })
  }
}
