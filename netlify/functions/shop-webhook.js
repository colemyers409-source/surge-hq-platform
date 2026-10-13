// Surge Apparel: Stripe webhook. On a paid checkout it saves the order and pings the owner's phone.
// Needs Netlify env vars STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY (VAPID keys optional, for the push).
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function verify(raw, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map(kv => kv.split('=')).filter(a => a.length === 2 && a[0] !== 'v1'));
  const sigs = header.split(',').filter(s => s.startsWith('v1=')).map(s => s.slice(3));
  const t = parts.t;
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`, 'utf8').digest('hex');
  return sigs.some(s => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

exports.handler = async (event) => {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  if (!verify(raw, sig, process.env.STRIPE_WEBHOOK_SECRET)) return { statusCode: 400, body: 'bad signature' };

  const evt = JSON.parse(raw);
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(evt.type)) return { statusCode: 200, body: 'ignored' };
  const s = evt.data.object;
  if (s.payment_status !== 'paid') return { statusCode: 200, body: 'not paid yet' };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const lines = Object.keys(s.metadata || {}).filter(k => /^i\d+$/.test(k)).sort((a, b) => a.slice(1) - b.slice(1))
    .map(k => { const [id, color, size, qty, unit] = s.metadata[k].split('|'); return { id, color, size, qty: +qty, price_cents: +unit }; });
  const ids = [...new Set(lines.map(l => l.id))];
  const { data: prods } = ids.length ? await sb.from('store_products').select('id,name').in('id', ids) : { data: [] };
  const names = Object.fromEntries((prods || []).map(p => [p.id, p.name]));
  lines.forEach(l => { l.name = names[l.id] || 'Item'; });

  const cd = s.customer_details || {};
  const sd = s.shipping_details || (s.collected_information && s.collected_information.shipping_details) || null;
  const row = {
    stripe_session_id: s.id, email: cd.email || null, name: (sd && sd.name) || cd.name || null, phone: cd.phone || null,
    shipping: sd, items: lines, amount_cents: s.amount_total,
    shipping_cents: (s.shipping_cost && s.shipping_cost.amount_total) || 0, status: 'paid'
  };
  const { error } = await sb.from('store_orders').upsert(row, { onConflict: 'stripe_session_id', ignoreDuplicates: true });
  if (error) return { statusCode: 500, body: error.message };

  // Phone ping to owner/admin (best effort)
  try {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      const webpush = require('web-push');
      webpush.setVapidDetails('mailto:surgequality@surgelifegroup.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      const { data: owners } = await sb.from('profiles').select('id').in('role', ['owner', 'admin']);
      const { data: subs } = await sb.from('push_subscriptions').select('subscription').in('user_id', (owners || []).map(o => o.id));
      const count = lines.reduce((a, l) => a + l.qty, 0);
      const payload = JSON.stringify({ title: `New store order · $${(s.amount_total / 100).toFixed(2)}`,
        body: `${row.name || 'Customer'} · ${count} item${count === 1 ? '' : 's'} to ship`, url: '/shop/admin/', tag: 'order-' + s.id });
      await Promise.all((subs || []).map(x => webpush.sendNotification(x.subscription, payload).catch(() => {})));
    }
  } catch (e) { /* ignore */ }
  return { statusCode: 200, body: 'ok' };
};

exports._verify = verify;
