// A lead calls one of our numbers back. Ring the agent who owns that number (or last dialed them) in the
// browser; if they don't pick up, take a voicemail. Numbers that answer and route back are a big part
// of staying off the carriers' spam lists.
const twilio = require('twilio');
const L = require('../lib/dialer');

exports.handler = async (event) => {
  const p = new URLSearchParams(event.body || '');
  const to = L.e164(p.get('To')), from = L.e164(p.get('From'));
  const db = L.sb(), cfg = await L.config(db), base = L.baseUrl(event);
  const vr = new twilio.twiml.VoiceResponse();
  const biz = cfg.business_name || 'Surge Partners';
  let agentId = null;
  const { data: n } = await db.from('dialer_numbers').select('agent_id').eq('phone', to).maybeSingle();
  if (n && n.agent_id) agentId = n.agent_id;
  if (!agentId && from) { const { data: c } = await db.from('dialer_calls').select('agent_id').eq('phone', from).order('started_at', { ascending: false }).limit(1); if (c && c.length) agentId = c[0].agent_id; }
  if (!agentId) { const { data: pr } = await db.from('profiles').select('id').eq('twilio_number', to).maybeSingle(); if (pr) agentId = pr.id; }
  let online = false;
  if (agentId) { const { data: s } = await db.from('dialer_sessions').select('id').eq('agent_id', agentId).neq('status', 'ended').gte('last_seen_at', new Date(Date.now() - 10 * 60000).toISOString()).limit(1); online = !!(s && s.length); }
  if (agentId && !(event.queryStringParameters || {}).vm) await db.from('dialer_calls').insert({ agent_id: agentId, call_sid: p.get('CallSid'), direction: 'inbound', phone: from, from_number: to, status: online ? 'ringing' : 'voicemail' });
  if (agentId && online) {
    const d = vr.dial({ timeout: 20, callerId: from, action: base + '/.netlify/functions/dialer-inbound?vm=1', method: 'POST' });
    d.client(L.identityFor(agentId));
    return L.xml(vr.toString());
  }
  if ((event.queryStringParameters || {}).vm && p.get('DialCallStatus') === 'completed') { vr.hangup(); return L.xml(vr.toString()); }
  vr.say({ voice: 'Polly.Joanna' }, 'Thanks for calling ' + biz + '. Nobody is available right now. Please leave your name and number after the tone and we will call you back.');
  vr.record({ maxLength: 120, playBeep: true, recordingStatusCallback: base + '/.netlify/functions/dialer-status?kind=rec', recordingStatusCallbackMethod: 'POST' });
  vr.hangup();
  return L.xml(vr.toString());
};
