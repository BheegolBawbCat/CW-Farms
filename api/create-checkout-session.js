const Stripe = require('stripe');

// Canonical prices, kept server-side so a shopper can't alter what they pay
// by editing the page in their browser. Update this alongside the `products`
// array in index.html whenever prices or the catalog change.
const CATALOG = {
  p1: { title: '100% Pure Maple Syrup', unitAmount: 1499 },
  p2: { title: 'Flavored Maple Syrup — 2 Pack', unitAmount: 2699 },
  p4: { title: 'Chocolate Infused Maple Syrup', unitAmount: 1399 },
  p5: { title: 'Vanilla Infused Maple Syrup', unitAmount: 1399 },
  p3: { title: 'Maple Syrup — 12 Pack Case', unitAmount: 15500 },
};

const SHIPPING_COST_CENTS = 699;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    res.status(500).json({ error: 'Stripe is not configured on this deployment yet.' });
    return;
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { items, fulfillment, customer } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Cart is empty.' });
      return;
    }

    const line_items = items.map((item) => {
      const known = CATALOG[item.id];
      const title = known ? known.title : String(item.title || 'CW Farms Product').slice(0, 200);
      // Known catalog items are priced server-side. Items added through the
      // "Add Product" form have no server-side record (there's no product
      // database), so their price is trusted from the client at checkout.
      const unitAmount = known ? known.unitAmount : Math.round(Number(item.price) * 100);
      const quantity = Math.max(1, Math.min(50, parseInt(item.quantity, 10) || 1));

      if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
        throw new Error(`Invalid price for item "${title}".`);
      }

      return {
        quantity,
        price_data: {
          currency: 'usd',
          unit_amount: unitAmount,
          product_data: { name: title },
        },
      };
    });

    if (fulfillment === 'shipping') {
      line_items.push({
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: SHIPPING_COST_CENTS,
          product_data: { name: 'Shipping' },
        },
      });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      customer_email: customer && customer.email ? customer.email : undefined,
      phone_number_collection: { enabled: true },
      shipping_address_collection: fulfillment === 'shipping' ? { allowed_countries: ['US'] } : undefined,
      metadata: {
        fulfillment: fulfillment || 'pickup',
        customerName: (customer && customer.name) || '',
        customerPhone: (customer && customer.phone) || '',
        orderNotes: (customer && customer.notes) || '',
      },
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancelled`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout session error:', err);
    res.status(500).json({ error: 'Could not start checkout. Please try again or call +1 320-905-6150.' });
  }
};
