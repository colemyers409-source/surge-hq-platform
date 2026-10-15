// Shared helpers for the Surge Dialer Netlify functions.
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const json = (code, body, extra) => ({ statusCode: code, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS, extra || {}), body: JSON.stringify(body) });
const xml = (twimlStr) => ({ statusCode: 200, headers: { 'Content-Type': 'text/xml' }, body: twimlStr });

function sb() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } }); }
function tw() { return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN); }

function baseUrl(event) {
  const proto = (event.headers['x-forwarded-proto'] || 'https');
  const host = event.headers['x-forwarded-host'] || event.headers.host;
  return process.env.URL && /surgelifegroup\.com|netlify\.app/.test(process.env.URL) ? process.env.URL : `${proto}://${host}`;
}

// Verify the Supabase JWT the browser sends and load the caller's profile.
async function auth(event) {
  const h = event.headers.authorization || event.headers.Authorization || '';
  const token = h.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const db = sb();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data || !data.user) return null;
  const { data: p } = await db.from('profiles').select('id,first_name,last_name,email,role,blocked,twilio_number,dialer_active,dialer_plan,dialer_lines,dialer_customer_id,dialer_sub_id,dialer_period_end,dialer_status').eq('id', data.user.id).maybeSingle();
  if (!p || p.blocked) return null;
  return { id: data.user.id, email: data.user.email, name: ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || data.user.email, role: p.role || 'agent', twilio_number: p.twilio_number, isOwner: p.role === 'owner' || p.role === 'admin',
    dialer: { active: !!p.dialer_active, plan: p.dialer_plan, lines: p.dialer_lines, customer: p.dialer_customer_id, sub: p.dialer_sub_id, periodEnd: p.dialer_period_end, status: p.dialer_status } };
}

async function settings(db) {
  const { data } = await db.from('dialer_settings').select('key,value');
  const o = {}; (data || []).forEach(r => { o[r.key] = r.value; }); return o;
}
async function setSetting(db, key, value) { await db.from('dialer_settings').upsert({ key, value, updated_at: new Date().toISOString() }); }
async function config(db) { const { data } = await db.from('dialer_config').select('*').eq('id', 1).maybeSingle(); return data || {}; }

function e164(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return d ? '+' + d : '';
}
function identityFor(userId) { return 'agent_' + String(userId).replace(/-/g, ''); }
function userFromIdentity(idt) { const h = String(idt || '').replace(/^client:/, '').replace(/^agent_/, ''); return h.length === 32 ? h.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5') : null; }

// ---- time zone: area code first, then state ----
const TZ_STATE = { AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago', CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York', DC: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Denver', IL: 'America/Chicago', IN: 'America/New_York', IA: 'America/Chicago', KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York', MD: 'America/New_York', MA: 'America/New_York', MI: 'America/New_York', MN: 'America/Chicago', MS: 'America/Chicago', MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago', NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York', OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', UT: 'America/Denver', VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York', WI: 'America/Chicago', WY: 'America/Denver' };
// Area codes that don't follow their state's dominant zone (or states split across zones)
const TZ_NPA = { 850: 'America/Chicago', 448: 'America/Chicago', 812: 'America/Chicago', 930: 'America/Chicago', 270: 'America/Chicago', 364: 'America/Chicago', 906: 'America/New_York', 731: 'America/Chicago', 901: 'America/Chicago', 423: 'America/New_York', 865: 'America/New_York', 915: 'America/Denver', 432: 'America/Chicago', 208: 'America/Denver', 986: 'America/Denver', 541: 'America/Los_Angeles', 605: 'America/Chicago', 701: 'America/Chicago', 308: 'America/Chicago', 785: 'America/Chicago', 620: 'America/Chicago', 928: 'America/Phoenix' };
function tzFor(phone, state) {
  const d = String(phone || '').replace(/\D/g, '');
  const npa = d.length === 11 ? d.slice(1, 4) : d.slice(0, 3);
  return TZ_NPA[npa] || TZ_STATE[String(state || '').toUpperCase()] || null;
}
function localHour(tz, when) {
  try { return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(when || new Date())) % 24; } catch (e) { return null; }
}
function localWeekday(tz, when) {
  try { return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(when || new Date()); } catch (e) { return null; }
}
// State windows tighter than the federal 8–9 (hour end is exclusive). Default comes from dialer_config.
const STATE_WINDOW = { FL: [8, 20], OK: [8, 20], MD: [9, 20], WA: [8, 20], CT: [9, 20], VA: [8, 20] };
function canCallNow(phone, state, cfg) {
  const tz = tzFor(phone, state); if (!tz) return { ok: true, tz: null, reason: null };
  const h = localHour(tz); if (h === null) return { ok: true, tz };
  const w = STATE_WINDOW[String(state || '').toUpperCase()] || [cfg.hours_start || 9, cfg.hours_end || 20];
  const start = Math.max(w[0], cfg.hours_start || 9), end = Math.min(w[1], cfg.hours_end || 20);
  if (h < start || h >= end) return { ok: false, tz, reason: 'outside calling hours (' + h + ':00 local)' };
  if (String(state).toUpperCase() === 'TX' && localWeekday(tz) === 'Sun' && h >= 12 && h < 21) return { ok: false, tz, reason: 'Texas: no sales calls Sunday 12–9pm' };
  return { ok: true, tz };
}

// Pick a caller ID: agent's own number if active + under cap, else a pool number matching the lead's area code, else any active number under cap.
async function pickFrom(db, cfg, agentId, leadPhone) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: nums } = await db.from('dialer_numbers').select('*').eq('status', 'active');
  const list = (nums || []).map(n => Object.assign({}, n, { calls_today: n.calls_day === today ? n.calls_today : 0 }));
  const cap = cfg.calls_per_number_day || 75;
  const under = list.filter(n => n.calls_today < cap);
  if (!under.length) return null;
  const npa = String(leadPhone).replace(/\D/g, '').replace(/^1/, '').slice(0, 3);
  const mine = under.filter(n => n.agent_id === agentId);
  const pick = mine.find(n => n.area_code === npa) || under.find(n => n.area_code === npa) || mine.sort((a, b) => a.calls_today - b.calls_today)[0] || under.sort((a, b) => a.calls_today - b.calls_today)[0];
  await db.from('dialer_numbers').update({ calls_today: pick.calls_today + 1, calls_total: (pick.calls_total || 0) + 1, calls_day: today, last_used_at: new Date().toISOString() }).eq('phone', pick.phone);
  return pick.phone;
}


// ---- Stripe helpers (form-encoded REST, no SDK) ----
function stripeForm(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) { if (v === undefined || v === null) continue; const key = prefix ? `${prefix}[${k}]` : k; if (typeof v === 'object') stripeForm(v, key, out); else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v))); }
  return out.join('&');
}
async function stripe(method, path, params) {
  const r = await fetch('https://api.stripe.com/v1' + path, { method, headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: method === 'GET' ? undefined : stripeForm(params || {}) });
  const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || ('Stripe ' + r.status)); return j;
}
const PLAN_LINES = { '1': 1, '3': 3, '5': 5, comp: 5 };
// Apply a Stripe subscription object to the agent's profile.
async function applySubscription(db, userId, sub) {
  const active = ['active', 'trialing', 'past_due'].includes(sub.status);
  const plan = (sub.metadata && sub.metadata.plan) || null;
  await db.from('profiles').update({ dialer_active: active, dialer_status: sub.status, dialer_sub_id: sub.id, dialer_customer_id: typeof sub.customer === 'string' ? sub.customer : (sub.customer && sub.customer.id), dialer_plan: plan, dialer_lines: PLAN_LINES[plan] || 1, dialer_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null }).eq('id', userId);
  return active;
}
// Is this agent allowed to dial right now? Owners/admins and comps always; subscribers while Stripe says so.
// If the stored period has lapsed, re-check Stripe once (covers missed webhooks).
async function entitled(db, me) {
  if (me.isOwner) return { ok: true, lines: 5, plan: 'owner' };
  const d = me.dialer || {};
  if (d.plan === 'comp' && d.active) return { ok: true, lines: d.lines || 5, plan: 'comp' };
  const lapsed = !d.periodEnd || new Date(d.periodEnd).getTime() < Date.now() - 36 * 3600 * 1000;
  if (d.sub && (lapsed || !d.active) && process.env.STRIPE_SECRET_KEY) {
    try { const sub = await stripe('GET', '/subscriptions/' + d.sub); const ok = await applySubscription(db, me.id, sub); return { ok, lines: PLAN_LINES[sub.metadata && sub.metadata.plan] || 1, plan: sub.metadata && sub.metadata.plan, status: sub.status }; } catch (e) { }
  }
  if (d.active && !lapsed) return { ok: true, lines: d.lines || 1, plan: d.plan, status: d.status };
  return { ok: false, lines: 0, plan: d.plan, status: d.status };
}

module.exports = { stripe, stripeForm, applySubscription, entitled, PLAN_LINES, CORS, json, xml, sb, tw, baseUrl, auth, settings, setSetting, config, e164, identityFor, userFromIdentity, tzFor, canCallNow, pickFrom, localHour };
