// Surge Dialer billing. Agents: start a Stripe subscription (1/3/5 lines) or open the billing portal.
// Owner: comp / un-comp an agent, or re-sync one agent's subscription from Stripe.
const L = require('../lib/dialer');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return L.json(200, {});
  const me = await L.auth(event);
  if (!me) return L.json(401, { error: 'Not signed in' });
  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return L.json(400, { error: 'bad json' }); }
  const db = L.sb(), base = L.baseUrl(event), action = body.action || 'checkout';
  try {
    if (action === 'status') {
      const ent = await L.entitled(db, me); const cfg = await L.config(db);
      return L.json(200, { entitled: ent.ok, lines: ent.lines, plan: ent.plan, status: ent.status || (me.dialer && me.dialer.status) || null, periodEnd: me.dialer && me.dialer.periodEnd, prices: { 1: Number(cfg.plan_1_price || 80), 3: Number(cfg.plan_3_price || 120), 5: Number(cfg.plan_5_price || 150) }, hasSub: !!(me.dialer && me.dialer.sub), codeEnabled: !!(cfg.access_code && String(cfg.access_code).trim()) });
    }
    if (action === 'code') {
      const cfg = await L.config(db); const want = String(cfg.access_code || '').trim();
      if (!want) return L.json(400, { error: 'Access codes are turned off' });
      if (String(body.code || '').trim() !== want) return L.json(403, { error: 'Wrong code' });
      await db.from('profiles').update({ dialer_active: true, dialer_plan: 'comp', dialer_lines: Number(cfg.access_code_lines || 5), dialer_status: 'comp', dialer_period_end: null }).eq('id', me.id);
      return L.json(200, { ok: true, lines: Number(cfg.access_code_lines || 5) });
    }
    if (!process.env.STRIPE_SECRET_KEY) return L.json(503, { error: 'Billing is not switched on yet (STRIPE_SECRET_KEY missing).' });

    if (action === 'checkout') {
      const plan = String(body.plan || ''); if (!['1', '3', '5'].includes(plan)) return L.json(400, { error: 'plan must be 1, 3 or 5' });
      const cfg = await L.config(db);
      const price = Number(cfg['plan_' + plan + '_price'] || { 1: 80, 3: 120, 5: 150 }[plan]);
      const params = {
        mode: 'subscription',
        success_url: base + '/agent?page=dialer&sub=ok',
        cancel_url: base + '/agent?page=dialer&sub=cancel',
        client_reference_id: me.id,
        allow_promotion_codes: 'true',
        line_items: { 0: { quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(price * 100), recurring: { interval: 'month' }, product_data: { name: 'Surge Dialer — ' + plan + ' line' + (plan === '1' ? '' : 's'), description: 'Multi-line power dialer inside Agent Space. Cancel anytime.' } } } },
        subscription_data: { metadata: { kind: 'dialer', user_id: me.id, plan } },
        metadata: { kind: 'dialer', user_id: me.id, plan }
      };
      if (me.dialer && me.dialer.customer) params.customer = me.dialer.customer; else params.customer_email = me.email;
      const s = await L.stripe('POST', '/checkout/sessions', params);
      return L.json(200, { url: s.url });
    }

    if (action === 'portal') {
      if (!me.dialer || !me.dialer.customer) return L.json(400, { error: 'No billing account yet' });
      const p = await L.stripe('POST', '/billing_portal/sessions', { customer: me.dialer.customer, return_url: base + '/agent?page=dialer' });
      return L.json(200, { url: p.url });
    }

    // ---- owner actions ----
    if (!me.isOwner) return L.json(403, { error: 'Owner only' });
    if (action === 'comp') {
      const on = !!body.on, lines = Math.max(1, Math.min(5, Number(body.lines || 5)));
      const upd = on ? { dialer_active: true, dialer_plan: 'comp', dialer_lines: lines, dialer_status: 'comp', dialer_period_end: null } : { dialer_active: false, dialer_plan: null, dialer_lines: null, dialer_status: 'canceled' };
      // un-comp keeps a real paid sub if one exists
      if (!on) { const { data: p } = await db.from('profiles').select('dialer_sub_id').eq('id', body.userId).maybeSingle(); if (p && p.dialer_sub_id) { try { const sub = await L.stripe('GET', '/subscriptions/' + p.dialer_sub_id); await L.applySubscription(db, body.userId, sub); return L.json(200, { ok: true, restored: sub.status }); } catch (e) { } } }
      await db.from('profiles').update(upd).eq('id', body.userId);
      return L.json(200, { ok: true });
    }
    if (action === 'sync') {
      const { data: p } = await db.from('profiles').select('dialer_sub_id,email').eq('id', body.userId).maybeSingle();
      let sub = null;
      if (p && p.dialer_sub_id) sub = await L.stripe('GET', '/subscriptions/' + p.dialer_sub_id);
      else { const list = await L.stripe('GET', '/subscriptions?limit=100&status=all'); sub = (list.data || []).find(x => x.metadata && x.metadata.user_id === body.userId) || null; }
      if (!sub) return L.json(404, { error: 'No subscription found in Stripe for this agent' });
      await L.applySubscription(db, body.userId, sub);
      return L.json(200, { ok: true, status: sub.status, plan: sub.metadata && sub.metadata.plan });
    }
    if (action === 'roster') {
      const { data: rows } = await db.from('profiles').select('id,first_name,last_name,email,role,blocked,dialer_active,dialer_plan,dialer_lines,dialer_status,dialer_period_end,dialer_sub_id').order('first_name');
      return L.json(200, { rows: (rows || []).filter(r => !r.blocked) });
    }
    return L.json(400, { error: 'unknown action' });
  } catch (e) { return L.json(500, { error: e.message }); }
};
