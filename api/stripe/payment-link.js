// api/stripe/payment-link.js
// Creates a Stripe Payment Link for manual invoice payment
// Vercel serverless function

const Stripe = require('stripe')

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

  try {
    const {
      amount_cents,
      description,
      customer_name,
      contract_number,
      metadata,
    } = req.body

    if (!amount_cents || !description) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Create a one-time price
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: amount_cents,
      product_data: {
        name: description,
        metadata: { contract_number: contract_number || '', source: 'zenith_crm' },
      },
    })

    // Create a payment link
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: metadata || {},
      after_completion: {
        type: 'hosted_confirmation',
        hosted_confirmation: {
          custom_message: `Thank you, ${customer_name || 'valued customer'}! Your payment has been received by Zenith Pure Solutions.`,
        },
      },
    })

    return res.status(200).json({
      url: paymentLink.url,
      payment_link_id: paymentLink.id,
    })
  } catch (err) {
    console.error('payment-link error:', err)
    return res.status(500).json({ error: err.message })
  }
}
