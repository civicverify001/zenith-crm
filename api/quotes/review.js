// api/quotes/review.js
// Public endpoint — no auth required. Uses service role key.
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

  const token = req.query.token || req.body?.token
  if (!token) return res.status(400).json({ error: 'Missing token' })

  // ─── GET: Fetch quote for public display ──────────────────
  if (req.method === 'GET') {
    try {
      const { data: quote, error } = await supabase
        .from('quotes')
        .select('*')
        .eq('accept_token', token)
        .single()

      if (error || !quote) return res.status(404).json({ error: 'Quote not found' })

      // Fetch customer name (limited info for public page)
      const { data: customer } = await supabase
        .from('customers')
        .select('id, full_name, email, phone, service_address')
        .eq('id', quote.customer_id)
        .single()

      // Fetch line items
      const { data: lineItems } = await supabase
        .from('quote_line_items')
        .select('*')
        .eq('quote_id', quote.id)
        .order('sort_order')

      // Mark as viewed if still "sent"
      if (quote.status === 'sent') {
        await supabase
          .from('quotes')
          .update({ status: 'viewed', viewed_at: new Date().toISOString() })
          .eq('id', quote.id)

        await supabase.from('document_audit_log').insert({
          entity_type: 'quote',
          entity_id: quote.id,
          event: 'viewed',
          actor_type: 'customer',
        })
      }

      // Return safe public data (no internal IDs exposed beyond what's needed)
      return res.status(200).json({
        id: quote.id,
        quote_number: quote.quote_number,
        status: quote.status === 'sent' ? 'viewed' : quote.status,
        commercial_type: quote.commercial_type,
        subtotal: quote.subtotal,
        tax_amount: quote.tax_amount,
        total: quote.total,
        notes: quote.notes,
        valid_until: quote.valid_until,
        sent_at: quote.sent_at,
        accepted_at: quote.accepted_at,
        declined_at: quote.declined_at,
        created_at: quote.created_at,
        line_items: quote.line_items_snapshot || lineItems || [],
        customer_name: customer?.full_name || '',
        customer_email: customer?.email || '',
        customer_address: customer?.service_address || '',
      })
    } catch (err) {
      console.error('Quote review GET error:', err)
      return res.status(500).json({ error: 'Server error' })
    }
  }

  // ─── POST: Accept or decline ──────────────────────────────
  if (req.method === 'POST') {
    const { action, decline_reason } = req.body
    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Use "accept" or "decline".' })
    }

    try {
      // Fetch current quote
      const { data: quote, error: fetchErr } = await supabase
        .from('quotes')
        .select('*')
        .eq('accept_token', token)
        .single()

      if (fetchErr || !quote) return res.status(404).json({ error: 'Quote not found' })

      // Only allow action on sent/viewed quotes
      if (!['sent', 'viewed'].includes(quote.status)) {
        return res.status(400).json({
          error: `This quote has already been ${quote.status}. No further action is possible.`,
          status: quote.status,
        })
      }

      // Check expiry
      if (quote.valid_until && new Date(quote.valid_until) < new Date()) {
        await supabase.from('quotes').update({ status: 'expired' }).eq('id', quote.id)
        return res.status(400).json({ error: 'This quote has expired.', status: 'expired' })
      }

      const now = new Date().toISOString()

      if (action === 'accept') {
        // Update quote
        const { error: updateErr } = await supabase
          .from('quotes')
          .update({ status: 'accepted', accepted_at: now })
          .eq('id', quote.id)

        if (updateErr) throw updateErr

        // Audit log
        await supabase.from('document_audit_log').insert({
          entity_type: 'quote',
          entity_id: quote.id,
          event: 'accepted',
          actor_type: 'customer',
        })

        // If rental — auto-create agreement stub in contracts table
        if (quote.commercial_type === 'rental') {
          const { data: customer } = await supabase
            .from('customers')
            .select('id, full_name')
            .eq('id', quote.customer_id)
            .single()

          await supabase.from('contracts').insert({
            customer_id: quote.customer_id,
            quote_id: quote.id,
            type: 'rental',
            status: 'pending_signature',
            monthly_amount: quote.line_items_snapshot?.find(li => li.item_type === 'product')?.unit_price || quote.total,
            start_date: new Date().toISOString().slice(0, 10),
            terms_snapshot: quote.terms_snapshot || {},
            line_items_snapshot: quote.line_items_snapshot || [],
            notes: `Auto-generated from accepted quote ${quote.quote_number}`,
          }).then(({ error }) => {
            if (error) console.error('Contract creation error:', error)
          })
        }

        return res.status(200).json({ success: true, status: 'accepted', message: 'Quote accepted!' })

      } else {
        // Decline
        const { error: updateErr } = await supabase
          .from('quotes')
          .update({
            status: 'declined',
            declined_at: now,
            decline_reason: decline_reason || null,
          })
          .eq('id', quote.id)

        if (updateErr) throw updateErr

        await supabase.from('document_audit_log').insert({
          entity_type: 'quote',
          entity_id: quote.id,
          event: 'declined',
          actor_type: 'customer',
          metadata: decline_reason ? { reason: decline_reason } : {},
        })

        return res.status(200).json({ success: true, status: 'declined', message: 'Quote declined.' })
      }
    } catch (err) {
      console.error('Quote review POST error:', err)
      return res.status(500).json({ error: 'Server error' })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
