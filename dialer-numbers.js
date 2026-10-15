// Owner-only number pool management: buy local-presence numbers, bench flagged ones, restore, release,
// assign to agents, attach numbers to approved Trust Hub products (SHAKEN/STIR A-attestation, CNAM,
// Voice Integrity), and export the pool for the Free Caller Registry / carrier remediation portals.
const L = require('../lib/dialer');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return L.json(200, {});
  const me = await L.auth(event);
  if (!me || !me.isOwner) return L.json(403, { error: 'Owner only' });
  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return L.json(400, { error: 'bad json' }); }
  const db = L.sb(), client = L.tw(), base = L.baseUrl(event), now = new Date().toISOString();
  const action = body.action;
  try {
    if (action === 'buy') {
      const count = Math.max(1, Math.min(Number(body.count || 1), 20)), areaCode = String(body.areaCode || '').replace(/\D/g, '').slice(0, 3) || null;
      const bought = [];
      const opts = { limit: count, voiceEnabled: true, smsEnabled: true }; if (areaCode) opts.areaCode = areaCode;
      let avail = await client.availablePhoneNumbers('US').local.list(opts);
      if (!avail.length && areaCode) avail = await client.availablePhoneNumbers('US').local.list({ limit: count, voiceEnabled: true, smsEnabled: true, nearNumber: '+1' + areaCode + '5550100' }).catch(() => []);
      if (!avail.length) avail = await client.availablePhoneNumbers('US').local.list({ limit: count, voiceEnabled: true, smsEnabled: true });
      for (const a of avail.slice(0, count)) {
        const n = await client.incomingPhoneNumbers.create({ phoneNumber: a.phoneNumber, friendlyName: 'Surge Dialer ' + (body.agentId ? 'agent' : 'pool'), voiceUrl: base + '/.netlify/functions/dialer-inbound', voiceMethod: 'POST', smsUrl: base + '/.netlify/functions/dialer-sms', smsMethod: 'POST' });
        const phone = L.e164(n.phoneNumber);
        await db.from('dialer_numbers').upsert({ phone, sid: n.sid, agent_id: body.agentId || null, area_code: phone.slice(2, 5), state: a.region || null, status: 'active', attestation: 'B' });
        bought.push(phone);
      }
      // attach to trust products if we have them (A attestation + CNAM + Voice Integrity)
      const s = await L.settings(db); const attached = await attach(client, db, s, bought);
      return L.json(200, { bought, attached });
    }
    if (action === 'bench' || action === 'restore' || action === 'release' || action === 'assign' || action === 'flag') {
      const phone = L.e164(body.phone); if (!phone) return L.json(400, { error: 'phone required' });
      const { data: n } = await db.from('dialer_numbers').select('*').eq('phone', phone).maybeSingle();
      if (!n) return L.json(404, { error: 'not in pool' });
      if (action === 'bench') await db.from('dialer_numbers').update({ status: 'benched', benched_at: now }).eq('phone', phone);
      if (action === 'flag') await db.from('dialer_numbers').update({ status: 'remediating', flagged_at: now, benched_at: now }).eq('phone', phone);
      if (action === 'restore') await db.from('dialer_numbers').update({ status: 'active', benched_at: null, flagged_at: null, calls_today: 0 }).eq('phone', phone);
      if (action === 'assign') await db.from('dialer_numbers').update({ agent_id: body.agentId || null }).eq('phone', phone);
      if (action === 'release') { if (n.sid) { try { await client.incomingPhoneNumbers(n.sid).remove(); } catch (e) { } } await db.from('dialer_numbers').update({ status: 'released' }).eq('phone', phone); }
      return L.json(200, { ok: true });
    }
    if (action === 'trust') {
      const s = await L.settings(db);
      const { data: nums } = await db.from('dialer_numbers').select('phone,sid').neq('status', 'released');
      const attached = await attach(client, db, s, (nums || []).map(n => n.phone));
      await db.from('dialer_numbers').update({ remediation_sent_at: now }).in('phone', attached.ok || []);
      return L.json(200, attached);
    }
    if (action === 'mark_fcr') { await db.from('dialer_numbers').update({ registered_fcr: true, remediation_sent_at: now }).in('phone', (body.phones || []).map(L.e164)); return L.json(200, { ok: true }); }
    if (action === 'reset_daily') { await db.from('dialer_numbers').update({ calls_today: 0 }).neq('status', 'released'); return L.json(200, { ok: true }); }
    if (action === 'health') {
      // answer-rate per number over the last 7 days → auto-bench candidates
      const since = new Date(Date.now() - 7 * 864e5).toISOString();
      const { data: calls } = await db.from('dialer_calls').select('from_number,status,answered_by').eq('direction', 'outbound').gte('started_at', since);
      const by = {}; (calls || []).forEach(c => { const b = by[c.from_number] = by[c.from_number] || { dials: 0, human: 0 }; b.dials++; if (c.answered_by === 'human' || c.status === 'bridged' || c.status === 'completed') b.human++; });
      const out = [];
      for (const phone of Object.keys(by)) { const r = by[phone].dials ? by[phone].human / by[phone].dials : null; await db.from('dialer_numbers').update({ answer_rate: r }).eq('phone', phone); out.push({ phone, dials: by[phone].dials, human: by[phone].human, rate: r }); }
      return L.json(200, { numbers: out });
    }
    return L.json(400, { error: 'unknown action' });
  } catch (err) { return L.json(500, { error: err.message }); }
};

// Assign phone numbers to every approved trust product we know about.
async function attach(client, db, s, phones) {
  const res = { ok: [], products: {}, skipped: [] };
  const prods = { shaken: s.shaken_product_sid, cnam: s.cnam_product_sid, integrity: s.integrity_product_sid };
  if (!prods.shaken && !prods.cnam && !prods.integrity) { res.note = 'No approved Trust Hub products yet (Business Profile → SHAKEN/STIR, CNAM, Voice Integrity). Run them in Twilio Console → Trust Hub, then Setup again.'; return res; }
  const { data: nums } = await db.from('dialer_numbers').select('phone,sid').in('phone', phones);
  for (const key of Object.keys(prods)) {
    if (!prods[key]) continue;
    res.products[key] = { attached: 0, already: 0, failed: 0 };
    let have = [];
    try { have = (await client.trusthub.v1.trustProducts(prods[key]).trustProductsChannelEndpointAssignment.list({ limit: 1000 })).map(a => a.channelEndpointSid); } catch (e) { }
    for (const n of (nums || [])) {
      if (!n.sid) { res.skipped.push(n.phone); continue; }
      if (have.includes(n.sid)) { res.products[key].already++; if (!res.ok.includes(n.phone)) res.ok.push(n.phone); continue; }
      try { await client.trusthub.v1.trustProducts(prods[key]).trustProductsChannelEndpointAssignment.create({ channelEndpointType: 'phone-number', channelEndpointSid: n.sid }); res.products[key].attached++; if (!res.ok.includes(n.phone)) res.ok.push(n.phone); }
      catch (e) { res.products[key].failed++; }
    }
    if (key === 'shaken') await db.from('dialer_numbers').update({ attestation: 'A' }).in('phone', res.ok);
  }
  return res;
}
