const Stripe = require('stripe')

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
    const { stripe_customer_id, customer_name, customer_email } = req.body

    let customerId = stripe_customer_id

    // Create Stripe customer if doesn't exist
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: customer_name,
        email: customer_email || undefined,
      })
      customerId = customer.id
    }

    // Create SetupIntent for ACH/bank account
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['us_bank_account'],
      payment_method_options: {
        us_bank_account: {
          financial_connections: {
            permissions: ['payment_method'],
          },
        },
      },
    })

    res.json({
      client_secret: setupIntent.client_secret,
      stripe_customer_id: customerId,
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
}
