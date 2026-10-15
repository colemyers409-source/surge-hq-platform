// TwiML App voice URL. The agent's browser "connects" here once per dialing session and is parked
// in their own conference room. Lead legs get bridged into that room as they answer.
const twilio = require('twilio');
const L = require('../lib/dialer');

exports.handler = async (event) => {
  const p = new URLSearchParams(event.body || '');
  const identity = (p.get('From') || p.get('Caller') || '').replace(/^client:/, '');
  const userId = L.userFromIdentity(identity);
  const vr = new twilio.twiml.VoiceResponse();
  if (!userId) { vr.say('Dialer could not identify your session.'); vr.hangup(); return L.xml(vr.toString()); }
  const db = L.sb(); const cfg = await L.config(db);
  const base = L.baseUrl(event);
  const dial = vr.dial();
  const conf = { beep: false, startConferenceOnEnter: true, endConferenceOnExit: true, waitUrl: '', statusCallback: base + '/.netlify/functions/dialer-status?kind=conf', statusCallbackEvent: 'start end join leave' };
  dial.conference(conf, 'room_' + identity);
  try { await db.from('dialer_sessions').update({ status: 'dialing', last_seen_at: new Date().toISOString() }).eq('agent_id', userId).in('status', ['idle', 'dialing', 'connected']); } catch (e) { }
  return L.xml(vr.toString());
};
