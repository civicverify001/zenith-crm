const { createClient } = require('@supabase/supabase-js')

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key)
}

function validatePhone(phone) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return digits
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return null
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// ── Phase 6: Resolve branch_id from ZIP territory ────────────
async function resolveBranchId(supabase, zipCode) {
  try {
    if (zipCode) {
      const { data: territory } = await supabase
        .from('zip_territories')
        .select('branch_id, assigned_rep_id')
        .eq('zip_code', zipCode.trim())
        .maybeSingle()
      if (territory?.branch_id) return territory
    }
    // Fall back to default (first active branch — INDY)
    const { data: defaultBranch } = await supabase
      .from('branches')
      .select('id')
      .eq('is_active', true)
      .order('created_at')
      .limit(1)
      .maybeSingle()
    if (defaultBranch?.id) return { branch_id: defaultBranch.id, assigned_rep_id: null }
  } catch (e) { /* fire-and-forget */ }
  return { branch_id: null, assigned_rep_id: null }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed. Use POST.' })

  try {
    const body = req.body || {}

    const fullName = (body.full_name || body.name || '').trim()
    const phone = (body.phone || '').trim()
    const email = (body.email || '').trim()
    const address = (body.address || '').trim()
    const city = (body.city || '').trim()
    const state = (body.state || '').trim()
    const zipCode = (body.zip_code || body.zip || '').trim()
    const waterConcern = (body.water_concern || '').trim()
    const notes = (body.notes || '').trim()

    if (!fullName) return res.status(400).json({ error: 'full_name is required' })
    if (!phone) return res.status(400).json({ error: 'phone is required' })

    const cleanPhone = validatePhone(phone)
    if (!cleanPhone) return res.status(400).json({ error: 'Invalid phone number. Must be 10 digits.' })
    if (email && !validateEmail(email)) return res.status(400).json({ error: 'Invalid email format' })

    const supabase = getSupabase()

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

    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id, full_name')
      .eq('phone', cleanPhone)
      .limit(1)
      .maybeSingle()

    // ── Phase 6: Auto-resolve branch from ZIP territory ──────────
    const { branch_id, assigned_rep_id } = await resolveBranchId(supabase, zipCode)

    const leadData = {
      full_name: fullName,
      phone: cleanPhone,
      stage: 'new_lead',
      source: 'website_form',
    }

    if (email) leadData.email = email
    if (address) leadData.address = address
    if (city) leadData.city = city
    if (state) leadData.state = state
    if (zipCode) leadData.zip_code = zipCode
    if (waterConcern) leadData.water_concern = waterConcern
    if (notes) leadData.notes = notes
    if (branch_id) leadData.branch_id = branch_id
    if (assigned_rep_id) leadData.assigned_rep_id = assigned_rep_id

    const { data: lead, error: insertError } = await supabase
      .from('leads')
      .insert(leadData)
      .select('id, full_name, phone, email, stage, created_at')
      .single()

    if (insertError) {
      console.error('Lead insert failed:', insertError)
      return res.status(500).json({ error: 'Failed to create lead', detail: insertError.message })
    }

    // ── GAP 14: Auto-create follow-up task for new lead ──────────
    try {
      const followUpDate = new Date(Date.now() + 2 * 60 * 60 * 1000) // +2 hours
      await supabase.from('follow_up_tasks').insert({
        entity_type: 'lead',
        entity_id: lead.id,
        title: `Contact new lead: ${fullName}`,
        description: `New lead from ${leadData.source || 'unknown source'}. Phone: ${cleanPhone}${email ? '. Email: ' + email : ''}`,
        due_date: followUpDate.toISOString().split('T')[0],
        status: 'pending',
        priority: 'high',
      })
    } catch (e) { /* fire-and-forget */ }

    const response = {
      success: true,
      lead_id: lead.id,
      message: 'Lead created successfully',
      branch_id: branch_id || null,
    }

    if (existingCustomer) {
      response.warning = 'This phone number matches an existing customer'
      response.existing_customer_id = existingCustomer.id
      response.existing_customer_name = existingCustomer.full_name
    }

    return res.status(201).json(response)

  } catch (err) {
    console.error('Lead capture error:', err)
    return res.status(500).json({ error: 'Internal server error', detail: err.message })
  }
}
