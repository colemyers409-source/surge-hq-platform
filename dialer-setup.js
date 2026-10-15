// Owner-only. One click: creates the Twilio API key + TwiML App the dialer needs, points every
// Twilio number at the dialer's inbound handlers, imports numbers into the pool, and reports
// Trust Hub status (Business Profile / SHAKEN-STIR / CNAM / Voice Integrity).
const L = require('../lib/dialer');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return L.json(200, {});
  const me = await L.auth(event);
  if (!me || !me.isOwner) return L.json(403, { error: 'Owner only' });
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return L.json(409, { error: 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing in Netlify env vars' });
  const db = L.sb(), client = L.tw(), base = L.baseUrl(event);
  const report = { steps: [] };
  try {
    const s = await L.settings(db);

    // 1. API key (needed to mint browser tokens)
    if (!s.api_key_sid || !s.api_key_secret) {
      const key = await client.newKeys.create({ friendlyName: 'Surge Dialer' });
      await L.setSetting(db, 'api_key_sid', key.sid); await L.setSetting(db, 'api_key_secret', key.secret);
      s.api_key_sid = key.sid; s.api_key_secret = key.secret;
      report.steps.push('Created Twilio API key');
    } else report.steps.push('API key present');

    // 2. TwiML App (what the browser "dials" into)
    const voiceUrl = base + '/.netlify/functions/dialer-voice';
    if (!s.twiml_app_sid) {
      const app = await client.applications.create({ friendlyName: 'Surge Dialer', voiceUrl, voiceMethod: 'POST' });
      await L.setSetting(db, 'twiml_app_sid', app.sid); s.twiml_app_sid = app.sid;
      report.steps.push('Created TwiML app');
    } else {
      await client.applications(s.twiml_app_sid).update({ voiceUrl, voiceMethod: 'POST' });
      report.steps.push('TwiML app verified');
    }

    // 3. Numbers: point at inbound handlers + import to pool
    const nums = await client.incomingPhoneNumbers.list({ limit: 500 });
    const { data: profiles } = await db.from('profiles').select('id,twilio_number');
    const ownerOf = {}; (profiles || []).forEach(p => { if (p.twilio_number) ownerOf[L.e164(p.twilio_number)] = p.id; });
    const { data: existing } = await db.from('dialer_numbers').select('phone,agent_id,status');
    const have = {}; (existing || []).forEach(n => { have[n.phone] = n; });
    let imported = 0;
    for (const n of nums) {
      try {
        await client.incomingPhoneNumbers(n.sid).update({ voiceUrl: base + '/.netlify/functions/dialer-inbound', voiceMethod: 'POST', smsUrl: base + '/.netlify/functions/dialer-sms', smsMethod: 'POST', statusCallback: '' });
      } catch (e) { /* non-fatal */ }
      const phone = L.e164(n.phoneNumber);
      if (!have[phone]) {
        const d = phone.replace(/\D/g, '');
        await db.from('dialer_numbers').upsert({ phone, sid: n.sid, agent_id: ownerOf[phone] || null, area_code: d.slice(1, 4), status: 'active' });
        imported++;
      } else if (have[phone] && !have[phone].agent_id && ownerOf[phone]) {
        await db.from('dialer_numbers').update({ agent_id: ownerOf[phone], sid: n.sid }).eq('phone', phone);
      }
    }
    report.steps.push(nums.length + ' Twilio number(s) wired for inbound; ' + imported + ' new in pool');

    // 4. Account type (trial can only call verified numbers)
    const acct = await client.api.v2010.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
    report.account = { type: acct.type, status: acct.status, name: acct.friendlyName };
    if (acct.type === 'Trial') report.steps.push('WARNING: Twilio account is still a TRIAL — upgrade it before dialing real leads');

    // 5. Trust Hub status
    report.trust = await trustStatus(client, db, nums);
    await L.setSetting(db, 'setup_done_at', new Date().toISOString());
    return L.json(200, report);
  } catch (err) {
    report.error = err.message; return L.json(500, report);
  }
};

async function trustStatus(client, db, nums) {
  const out = { profiles: [], products: [] };
  try {
    const profiles = await client.trusthub.v1.customerProfiles.list({ limit: 20 });
    out.profiles = profiles.map(p => ({ sid: p.sid, name: p.friendlyName, status: p.status }));
    const approved = profiles.find(p => p.status === 'twilio-approved');
    if (approved) await L.setSetting(db, 'business_profile_sid', approved.sid);
    const products = await client.trusthub.v1.trustProducts.list({ limit: 20 });
    for (const t of products) {
      const row = { sid: t.sid, name: t.friendlyName, status: t.status, policy: t.policySid, assigned: 0 };
      try {
        const asg = await client.trusthub.v1.trustProducts(t.sid).trustProductsChannelEndpointAssignment.list({ limit: 500 });
        row.assigned = asg.filter(a => a.channelEndpointType === 'phone-number').length;
        row.assignedSids = asg.filter(a => a.channelEndpointType === 'phone-number').map(a => a.channelEndpointSid);
      } catch (e) { }
      out.products.push(row);
      const n = (t.friendlyName || '').toLowerCase();
      if (t.status === 'twilio-approved') {
        if (/shaken|stir/.test(n)) await L.setSetting(db, 'shaken_product_sid', t.sid);
        if (/cnam/.test(n)) await L.setSetting(db, 'cnam_product_sid', t.sid);
        if (/integrity/.test(n)) await L.setSetting(db, 'integrity_product_sid', t.sid);
      }
    }
    // attestation per number: A only if assigned to an approved SHAKEN/STIR product
    const shaken = out.products.find(p => /shaken|stir/.test((p.name || '').toLowerCase()) && p.status === 'twilio-approved');
    for (const n of nums) {
      const att = shaken && shaken.assignedSids && shaken.assignedSids.includes(n.sid) ? 'A' : (approved ? 'B' : 'C');
      await db.from('dialer_numbers').update({ attestation: att }).eq('phone', L.e164(n.phoneNumber));
    }
    out.summary = {
      businessProfile: approved ? 'approved' : (profiles.length ? profiles[0].status : 'none'),
      shakenStir: shaken ? 'approved' : 'none',
      cnam: out.products.some(p => /cnam/.test((p.name || '').toLowerCase()) && p.status === 'twilio-approved') ? 'approved' : 'none',
      voiceIntegrity: out.products.some(p => /integrity/.test((p.name || '').toLowerCase()) && p.status === 'twilio-approved') ? 'approved' : 'none'
    };
  } catch (e) { out.error = e.message; }
  return out;
}
