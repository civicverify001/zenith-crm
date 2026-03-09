const Stripe = require('stripe');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const { payment_method_id } = req.body;

    const pm = await stripe.paymentMethods.retrieve(payment_method_id);

    res.json({
      id: pm.id,
      last4: pm.card?.last4 || '????',
      exp_month: pm.card?.exp_month || 0,
      exp_year: pm.card?.exp_year || 0,
      brand: pm.card?.brand || 'card',
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
