// Surge Apparel: builds a Stripe Checkout session from the cart.
// Prices always come from the database, never from the browser.
// Needs Netlify env var STRIPE_SECRET_KEY.
const { createClient } = require('@supabase/supabase-js');

const SUPA_URL = process.env.SUPABASE_URL || 'https://szdzbycppkavfwuzlljh.supabase.co';
const SUPA_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6ZHpieWNwcGthdmZ3dXpsbGpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1ODIxNzgsImV4cCI6MjA5NTE1ODE3OH0.Jw21eHChMDHlskSs2PegmBXLYNIQkjl8GByOIApadhA';

const json = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Stripe wants application/x-www-form-urlencoded with bracketed keys.
function form(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
  }
  return out.join('&');
}
const big = s => /^(2|3|4|5)XL$/.test(s);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return json(503, { error: 'Checkout is not switched on yet.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Bad request' }); }
  const items = Array.isArray(body.items) ? body.items.slice(0, 40) : [];
  if (!items.length) return json(400, { error: 'Your cart is empty.' });

  const sb = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });
  const ids = [...new Set(items.map(i => String(i.id)))];
  const [{ data: products, error }, { data: settings }] = await Promise.all([
    sb.from('store_products').select('id,name,price_cents,upcharge_cents,colors,sizes,active,sold_out,photos').in('id', ids),
    sb.from('store_settings').select('*').eq('id', 1).maybeSingle()
  ]);
  if (error) return json(500, { error: 'Could not load products.' });
  const byId = Object.fromEntries((products || []).map(p => [p.id, p]));

  const line_items = [], meta = {};
  let subtotal = 0;
  for (const [n, i] of items.entries()) {
    const p = byId[i.id];
    const qty = Math.max(1, Math.min(20, parseInt(i.qty, 10) || 1));
    if (!p || !p.active) return json(400, { error: 'Something in your cart is no longer available. Remove it and try again.' });
    if (p.sold_out) return json(400, { error: `${p.name} is sold out.` });
    const color = (p.colors || []).find(c => c.name === i.color);
    if (!color) return json(400, { error: `Pick a color for ${p.name}.` });
    if (!(p.sizes || []).includes(i.size)) return json(400, { error: `Pick a size for ${p.name}.` });
    const unit = p.price_cents + (big(i.size) ? (p.upcharge_cents || 0) : 0);
    subtotal += unit * qty;
    line_items.push({
      quantity: qty,
      price_data: { currency: 'usd', unit_amount: unit,
        product_data: { name: p.name, description: `${color.name} / ${i.size}`,
          ...(p.photos && p.photos[0] ? { images: { 0: p.photos[0] } } : {}) } }
    });
    meta['i' + n] = [p.id, color.name, i.size, qty, unit].join('|').slice(0, 490);
  }

  const s = settings || {};
  const ship = s.free_ship_over_cents && subtotal >= s.free_ship_over_cents ? 0 : (s.shipping_cents || 0);
  const host = event.headers['x-forwarded-host'] || event.headers.host;
  const base = `https://${host}`;
  const path = /surgelifegroup\.com$/.test(host) ? '/shop/' : '/';

  const params = {
    mode: 'payment',
    success_url: `${base}${path}?success=1`,
    cancel_url: `${base}${path}`,
    shipping_address_collection: { allowed_countries: { 0: 'US' } },
    phone_number_collection: { enabled: 'true' },
    billing_address_collection: 'auto',
    shipping_options: { 0: { shipping_rate_data: { type: 'fixed_amount', display_name: ship ? 'Standard shipping' : 'Free shipping',
      fixed_amount: { amount: ship, currency: 'usd' } } } },
    line_items: Object.fromEntries(line_items.map((l, k) => [k, l])),
    metadata: meta
  };

  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form(params)
  });
  const j = await r.json();
  if (!r.ok) return json(502, { error: (j.error && j.error.message) || 'Stripe error' });
  return json(200, { url: j.url });
};

exports._form = form; // for tests
