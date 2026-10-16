// Agent asks for the next batch of lines. Compliance gates run server-side on every lead:
// DNC, calling hours in the lead's local time, max attempts per day, sold leads skipped.
const L = require('../lib/dialer');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return L.json(200, {});
  const me = await L.auth(event);
  if (!me) return L.json(401, { error: 'Not signed in' });
  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return L.json(400, { error: 'bad json' }); }
  const { sessionId, leads } = body;
  if (!sessionId || !Array.isArray(leads) || !leads.length) return L.json(400, { error: 'sessionId and leads required' });
  const db = L.sb(), client = L.tw(), base = L.baseUrl(event), cfg = await L.config(db);
  const { data: sess } = await db.from('dialer_sessions').select('*').eq('id', sessionId).eq('agent_id', me.id).maybeSingle();
  if (!sess || sess.status === 'ended') return L.json(409, { error: 'No active session' });
  if (sess.active_call_sid) return L.json(409, { error: 'Already on a call' });
  const ent = await L.entitled(db, me);
  if (!ent.ok) return L.json(402, { error: 'No active Surge Dialer subscription', paywall: true });
  const lines = Math.max(1, Math.min(Number(body.lines || sess.lines || 2), cfg.max_lines || 3, ent.lines || 1));
  const identity = L.identityFor(me.id);

  // Only dial while the agent is actually parked in their room (TSR: no dialing without a live rep).
  const placed = [], skipped = [];
  const phones = leads.map(l => L.e164(l.phone)).filter(Boolean);
  const [{ data: dnc }, { data: pool }] = await Promise.all([
    db.from('dnc_list').select('phone').in('phone', phones),
    db.from('lead_pool').select('phone,agent_id,sold_at,dnc,attempts,last_attempt_at,state,full_name').in('phone', phones)
  ]);
  const dncSet = new Set((dnc || []).map(x => x.phone)); const poolBy = {}; (pool || []).forEach(x => { poolBy[x.phone] = x; });
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const { data: recent } = await db.from('dialer_calls').select('phone,started_at').in('phone', phones).gte('started_at', new Date(dayAgo).toISOString()).neq('status', 'canceled');
  const attemptsToday = {}; (recent || []).forEach(c => { attemptsToday[c.phone] = (attemptsToday[c.phone] || 0) + 1; });

  for (const lead of leads) {
    if (placed.length >= lines) break;
    const phone = L.e164(lead.phone); if (!phone || phone.length < 12) { skipped.push({ phone: lead.phone, reason: 'bad number' }); continue; }
    const lp = poolBy[phone] || {}; const state = lead.state || lp.state || '';
    let reason = null;
    if (dncSet.has(phone) || lp.dnc) reason = 'do not call';
    else if (lp.sold_at) reason = 'already sold';
    else if (lp.agent_id && lp.agent_id !== me.id && !me.isOwner) reason = 'assigned to another agent';
    else if ((attemptsToday[phone] || 0) >= (cfg.max_attempts_day || 3)) reason = 'max attempts today';
    else { const w = L.canCallNow(phone, state, cfg); if (!w.ok) reason = w.reason; }
    if (reason) {
      skipped.push({ phone, reason });
      if (/do not call|hours|attempts|Sunday/.test(reason)) await db.from('dialer_compliance_log').insert({ kind: reason.indexOf('do not call') >= 0 ? 'blocked_dnc' : (reason.indexOf('attempts') >= 0 ? 'blocked_attempts' : 'blocked_hours'), phone, agent_id: me.id, detail: reason });
      continue;
    }
    const from = await L.pickFrom(db, cfg, me.id, phone);
    if (!from) { skipped.push({ phone, reason: 'no caller ID available (all numbers at daily cap)' }); break; }
    try {
      const q = '?session=' + sessionId;
      const params = {
        to: phone, from, timeout: 28,
        url: base + '/.netlify/functions/dialer-answer' + q, method: 'POST',
        statusCallback: base + '/.netlify/functions/dialer-status' + q, statusCallbackMethod: 'POST',
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
      };
      if (cfg.amd_enabled !== false) { params.machineDetection = 'Enable'; params.asyncAmd = 'true'; params.asyncAmdStatusCallback = base + '/.netlify/functions/dialer-amd' + q; params.asyncAmdStatusCallbackMethod = 'POST'; params.machineDetectionTimeout = 8; }
      const call = await client.calls.create(params);
      await db.from('dialer_calls').insert({ session_id: sessionId, agent_id: me.id, call_sid: call.sid, phone, lead_name: lead.name || lp.full_name || null, lead_state: state || null, from_number: from, status: 'queued' });
      await db.from('lead_pool').upsert({ phone, agent_id: lp.agent_id || me.id, full_name: lp.full_name || lead.name || null, state: lp.state || state || null, tz: L.tzFor(phone, state) }, { onConflict: 'phone' });
      placed.push({ phone, callSid: call.sid, name: lead.name || lp.full_name || null, state, from });
    } catch (e) { skipped.push({ phone, reason: 'twilio: ' + e.message }); }
  }
  await db.from('dialer_sessions').update({ status: placed.length ? 'dialing' : sess.status, dials: (sess.dials || 0) + placed.length, lines, last_seen_at: new Date().toISOString() }).eq('id', sessionId);
  return L.json(200, { placed, skipped, identity });
};
