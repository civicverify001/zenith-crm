// api/contracts/sign.js
// Public endpoint — signs a rental agreement after quote acceptance
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method === 'GET') {
    // Fetch contract + agreement terms for display
    const { contract_id, token } = req.query
    if (!contract_id && !token) return res.status(400).json({ error: 'Missing contract_id or token' })

    try {
      let contract

      if (token) {
        // Look up contract via the quote's accept_token
        const { data: quote } = await supabase
          .from('quotes')
          .select('id')
          .eq('accept_token', token)
          .single()
        if (!quote) return res.status(404).json({ error: 'Quote not found' })

        const { data } = await supabase
          .from('contracts')
          .select('*')
          .eq('quote_id', quote.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()
        contract = data
      } else {
        const { data } = await supabase
          .from('contracts')
          .select('*')
          .eq('id', contract_id)
          .single()
        contract = data
      }

      if (!contract) return res.status(404).json({ error: 'Contract not found' })

      // Fetch customer
      const { data: customer } = await supabase
        .from('customers')
        .select('id, full_name, email, phone, address, city, state, zip')
        .eq('id', contract.customer_id)
        .single()

      // Fetch quote for product details
      let quoteData = null
      if (contract.quote_id) {
        const { data: q } = await supabase
          .from('quotes')
          .select('quote_number, commercial_type, line_items_snapshot, notes, subtotal, tax_amount, total')
          .eq('id', contract.quote_id)
          .single()
        quoteData = q
      }

      // Build address
      const addrParts = [customer?.address, customer?.city, customer?.state, customer?.zip].filter(Boolean)

      return res.status(200).json({
        contract: {
          id: contract.id,
          type: contract.type,
          status: contract.status,
          monthly_amount: contract.monthly_amount,
          start_date: contract.start_date,
          signed_at: contract.signed_at,
          billing_day: contract.billing_day || 1,
          contract_number: contract.contract_number,
        },
        customer: {
          name: customer?.full_name || '',
          email: customer?.email || '',
          phone: customer?.phone || '',
          address: addrParts.join(', '),
        },
        quote: quoteData ? {
          quote_number: quoteData.quote_number,
          line_items: quoteData.line_items_snapshot || [],
          subtotal: quoteData.subtotal,
          tax_amount: quoteData.tax_amount,
          total: quoteData.total,
        } : null,
        terms: {
          rental_duration: '12 months minimum, month-to-month thereafter',
          cancellation: 'Customer may cancel after the initial 12-month term with 30 days written notice. Early termination within the first 12 months requires payment of remaining months or a $250 early termination fee, whichever is less.',
          equipment_ownership: 'All equipment remains the property of Zenith Pure Solutions LLC throughout the rental period and until a buyout is completed.',
          buyout: 'Customer may purchase the equipment at any time. Buyout price = retail price minus total rental payments made (excluding maintenance fees). Minimum buyout is $0.',
          maintenance: 'Zenith Pure Solutions will provide routine maintenance including filter replacements on schedule at no additional charge during the rental period.',
          warranty: 'Equipment is warranted against defects in materials and workmanship for the duration of the rental agreement. Warranty does not cover damage from misuse, unauthorized modification, or Acts of God.',
          service_response: 'Zenith Pure Solutions will respond to service requests within 48 hours during normal business hours (Mon–Fri 8AM–6PM EST).',
          payment: `Monthly rental payments of $${contract.monthly_amount} are due on day ${contract.billing_day || 1} of each month via the payment method on file. Failed payments will be retried and may incur late fees after 10 days.`,
          liability: 'Customer is responsible for providing access to the equipment for scheduled maintenance. Zenith Pure Solutions is not liable for damages caused by customer modifications or improper use of the equipment.',
          governing_law: 'This agreement is governed by the laws of the State of Indiana. Any disputes shall be resolved in the courts of Marion County, Indiana.',
        },
      })
    } catch (err) {
      console.error('Contract GET error:', err)
      return res.status(500).json({ error: 'Server error' })
    }
  }

  if (req.method === 'POST') {
    const { contract_id, signature, signature_type } = req.body
    if (!contract_id || !signature) {
      return res.status(400).json({ error: 'Missing contract_id or signature' })
    }

    try {
      const { data: contract, error: fetchErr } = await supabase
        .from('contracts')
        .select('id, status, customer_id, quote_id, contract_number')
        .eq('id', contract_id)
        .single()

      if (fetchErr || !contract) return res.status(404).json({ error: 'Contract not found' })

      if (contract.status !== 'pending_signature') {
        return res.status(400).json({
          error: `This agreement has already been ${contract.status}.`,
          status: contract.status,
        })
      }

      const now = new Date().toISOString()

      // Activate the contract
      const { error: updateErr } = await supabase
        .from('contracts')
        .update({
          status: 'active',
          signed_at: now,
        })
        .eq('id', contract_id)

      if (updateErr) throw updateErr

      // Log audit
      await supabase.from('document_audit_log').insert({
        entity_type: 'contract',
        entity_id: contract_id,
        event: 'agreement_signed',
        actor_type: 'customer',
        metadata: {
          signature_type: signature_type || 'typed',
          signed_at: now,
          has_signature_data: !!signature,
        },
      })

      // Create a follow-up task for the team to schedule installation
      await supabase.from('follow_up_tasks').insert({
        entity_type: 'customer',
        entity_id: contract.customer_id,
        title: `Rental agreement signed — schedule installation`,
        description: `Customer signed rental agreement for contract ${contract.contract_number || contract.id.slice(0, 8)}. Schedule the installation.`,
        due_date: now.slice(0, 10),
        status: 'pending',
        priority: 'high',
      })

      return res.status(200).json({
        success: true,
        status: 'active',
        message: 'Rental agreement signed successfully!',
      })
    } catch (err) {
      console.error('Contract sign error:', err)
      return res.status(500).json({ error: 'Server error' })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
