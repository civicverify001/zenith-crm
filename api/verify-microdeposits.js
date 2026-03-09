const Stripe = require('stripe')

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
    const { client_secret, amounts } = req.body

    // Extract setup intent ID from client secret
    const setupIntentId = client_secret.split('_secret_')[0]

    const setupIntent = await stripe.setupIntents.verifyMicrodeposits(
      setupIntentId,
      { amounts }
    )

    res.json({ status: setupIntent.status })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
}
