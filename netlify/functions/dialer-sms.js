// Inbound SMS to a pool number. STOP-style keywords go straight onto the DNC list (TCPA revocation rule:
// any reasonable means, honored immediately). Everything else is logged for the owning agent.
const twilio = require('twilio');
const L = require('../lib/dialer');

exports.handler = async (event) => {
  const p = new URLSearchParams(event.body || '');
  const from = L.e164(p.get('From')), body = (p.get('Body') || '').trim();
  const db = L.sb(), cfg = await L.config(db);
  const mr = new twilio.twiml.MessagingResponse();
  if (/^\s*(stop|stopall|unsubscribe|cancel|end|quit|revoke|opt\s*out|remove|do not (call|contact))\b/i.test(body)) {
    await db.from('dnc_list').upsert({ phone: from, source: 'sms', note: body.slice(0, 120) });
    await db.from('lead_pool').update({ dnc: true, last_dispo: 'DNC (text)' }).eq('phone', from);
    await db.from('dialer_compliance_log').insert({ kind: 'opt_out_sms', phone: from, detail: body.slice(0, 200) });
    mr.message('You have been removed from ' + (cfg.business_name || 'Surge Partners') + ' calling and texting lists. No further messages will be sent.');
  }
  return { statusCode: 200, headers: { 'Content-Type': 'text/xml' }, body: mr.toString() };
};
