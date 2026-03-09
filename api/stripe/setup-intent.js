// api/stripe/setup-intent.js
// Creates a Stripe SetupIntent so the frontend can collect and save a card
// Vercel serverless function

const Stripe = require('stripe')

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

  try {
    const { stripe_customer_id, customer_name, customer_email } = req.body

    let stripeCustomerId = stripe_customer_id

    // Create Stripe customer if not yet created
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        name: customer_name || undefined,
        email: customer_email || undefined,
        metadata: { source: 'zenith_crm' },
      })
      stripeCustomerId = customer.id
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      usage: 'off_session', // enables future autopay charges
    })

    return res.status(200).json({
      client_secret: setupIntent.client_secret,
      stripe_customer_id: stripeCustomerId,
    })
  } catch (err) {
    console.error('setup-intent error:', err)
    return res.status(500).json({ error: err.message })
  }
}
