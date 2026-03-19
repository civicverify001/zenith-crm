// api/stripe/buyout-invoice.js
// Creates a buyout invoice record + Stripe payment link in one call
// Called by ExecuteBuyoutModal when admin clicks "Generate Invoice"

const Stripe = require('stripe')
const { createClient } = require('@supabase/supabase-js')

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const APP_URL = process.env.VITE_APP_URL || 'https://zenith-crm-ten.vercel.app'

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const {
    contract_id,
    customer_id,
    calculation_id,
    line_items,        // Array of { description, quantity, unit_price, total, item_type }
    subtotal,
    total,
    notes,
    plans_to_cancel,   // Array of customer_service_plan IDs to cancel on payment
    plans_to_activate, // Array of { plan_id, price, billing_cycle } to activate on payment
  } = req.body

  if (!contract_id || !customer_id || !calculation_id || !line_items || total === undefined) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  try {
    // ── 1. Load customer ──────────────────────────────────────
    const { data: customer } = await supabase
      .from('customers')
      .select('full_name, email, phone, address, city, state, zip')
      .eq('id', customer_id)
      .single()

    if (!customer) return res.status(404).json({ error: 'Customer not found' })

    // ── 2. Load contract for number ───────────────────────────
    const { data: contract } = await supabase
      .from('contracts')
      .select('contract_number, monthly_amount')
      .eq('id', contract_id)
      .single()

    // ── 3. Generate invoice number ────────────────────────────
    const year = new Date().getFullYear()
    const { count } = await supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .like('invoice_number', `BO-${year}-%`)

    const invoiceNumber = `BO-${year}-${String((count || 0) + 1).padStart(4, '0')}`

    // ── 4. Create invoice record ──────────────────────────────
    const { data: invoice, error: invErr } = await supabase
      .from('invoices')
      .insert({
        customer_id,
        invoice_number:      invoiceNumber,
        invoice_type:        'buyout',
        status:              'draft',
        line_items_snapshot: line_items,
        subtotal:            subtotal,
        tax_amount:          0,
        tax:                 0,
        total:               total,
        amount_paid:         0,
        balance_due:         total,
        amount_due:          total,
        notes:               notes || `Equipment buyout — Contract ${contract?.contract_number || contract_id}`,
        customer_name:       customer.full_name,
        customer_email:      customer.email || null,
        customer_phone:      customer.phone || null,
        customer_address:    [customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(', '),
        payment_terms:       'Due upon receipt',
        reference_number:    contract?.contract_number || null,
        created_at:          new Date().toISOString(),
        updated_at:          new Date().toISOString(),
      })
      .select('id, invoice_number')
      .single()

    if (invErr) throw new Error(`Invoice creation failed: ${invErr.message}`)

    // ── 5. Create Stripe payment link ─────────────────────────
    const amountCents = Math.round(total * 100)

    const price = await stripe.prices.create({
      currency:     'usd',
      unit_amount:  amountCents,
      product_data: {
        name: `Equipment Buyout — ${contract?.contract_number || 'Contract'}`,
        metadata: { source: 'zenith_crm', invoice_type: 'buyout' },
      },
    })

    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: {
        invoice_type:      'buyout',
        invoice_id:        invoice.id,
        contract_id,
        customer_id,
        calculation_id,
        plans_to_cancel:   JSON.stringify(plans_to_cancel || []),
        plans_to_activate: JSON.stringify(plans_to_activate || []),
      },
      after_completion: {
        type: 'hosted_confirmation',
        hosted_confirmation: {
          custom_message: `Thank you, ${customer.full_name}! Your buyout payment has been received. Your equipment is now yours — congratulations on owning your water system!`,
        },
      },
    })

    // ── 6. Store payment link on invoice ──────────────────────
    await supabase
      .from('invoices')
      .update({
        stripe_invoice_id: paymentLink.id,
        status:            'sent',
        sent_at:           new Date().toISOString(),
      })
      .eq('id', invoice.id)

    // ── 7. Log activity ───────────────────────────────────────
    await supabase.from('customer_activity_log').insert({
      customer_id,
      event_type: 'buyout_invoice_created',
      title:      `Buyout invoice generated: ${invoiceNumber} — ${fmt(total)}`,
      actor_name: 'System',
      metadata: {
        invoice_id:     invoice.id,
        invoice_number: invoiceNumber,
        contract_id,
        calculation_id,
        total,
      },
    }).then(() => {}).catch(() => {})

    return res.status(200).json({
      invoice_id:      invoice.id,
      invoice_number:  invoiceNumber,
      payment_link_url: paymentLink.url,
      payment_link_id: paymentLink.id,
    })

  } catch (err) {
    console.error('buyout-invoice error:', err)
    return res.status(500).json({ error: err.message })
  }
}

function fmt(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}
