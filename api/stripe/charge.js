// api/stripe/charge.js
// Charges a saved payment method (autopay or manual)
// Vercel serverless function

const Stripe = require('stripe')

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

  try {
    const {
      stripe_customer_id,
      payment_method_id, // Stripe PM id e.g. pm_xxx
      amount_cents,      // integer, e.g. 2999 = $29.99
      description,
      metadata,
    } = req.body

    if (!stripe_customer_id || !payment_method_id || !amount_cents) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount_cents,
      currency: 'usd',
      customer: stripe_customer_id,
      payment_method: payment_method_id,
      description: description || 'Zenith Pure Solutions payment',
      confirm: true,
      off_session: true, // autopay / no customer present
      metadata: metadata || {},
    })

    return res.status(200).json({
      payment_intent_id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
    })
  } catch (err) {
    console.error('charge error:', err)
    // Stripe error codes we care about
    const stripeCode = err?.code || err?.decline_code || 'unknown'
    return res.status(402).json({
      error: err.message,
      stripe_code: stripeCode,
    })
  }
}
