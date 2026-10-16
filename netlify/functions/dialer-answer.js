// A lead picked up: bridge to the agent instantly (AMD runs async and drops voicemails after the fact).
// First answer wins the agent; anyone else who answers hears the agent's callback message.
const twilio = require('twilio');
const L = require('../lib/dialer');

exports.handler = async (event) => {
  const p = new URLSearchParams(event.body || '');
  const qs = event.queryStringParameters || {};
  const sessionId = qs.session, callSid = p.get('CallSid'), answeredBy = p.get('AnsweredBy') || null;
  const db = L.sb(), base = L.baseUrl(event), cfg = await L.config(db);
  const vr = new twilio.twiml.VoiceResponse();
  const now = new Date().toISOString();

  if (!sessionId || !callSid) { vr.hangup(); return L.xml(vr.toString()); }

  // Atomic claim of the agent's line
  const { data: claimed } = await db.from('dialer_sessions').update({ active_call_sid: callSid, status: 'connected', last_seen_at: now })
    .eq('id', sessionId).is('active_call_sid', null).neq('status', 'ended').select('id,agent_id,identity,contacts');

  if (!claimed || !claimed.length) {
    // Agent already talking → abandoned call. Play the agent's own callback message and release.
    await db.from('dialer_calls').update({ status: 'abandoned', answered_at: now, ended_at: now }).eq('call_sid', callSid);
    const { data: c } = await db.from('dialer_calls').select('phone,agent_id').eq('call_sid', callSid).maybeSingle();
    await db.from('dialer_compliance_log').insert({ kind: 'abandoned', phone: c && c.phone, agent_id: c && c.agent_id, detail: 'answered while agent was on another line' });
    let msg = null;
    if (c && c.agent_id) { const { data: pr } = await db.from('profiles').select('dialer_abandon_message,first_name,twilio_number').eq('id', c.agent_id).maybeSingle(); if (pr && pr.dialer_abandon_message) msg = pr.dialer_abandon_message; }
    if (!msg) msg = cfg.abandon_message || ('This was ' + (cfg.business_name || 'Surge Partners') + ' calling. Sorry we missed you.');
    vr.pause({ length: 1 });
    vr.say({ voice: 'Polly.Joanna' }, msg);
    vr.hangup(); return L.xml(vr.toString());
  }
  const sess = claimed[0];
  await db.from('dialer_calls').update({ status: 'bridged', answered_by: answeredBy || 'human', answered_at: now, bridged_at: now }).eq('call_sid', callSid);
  await db.from('dialer_sessions').update({ active_phone: (await phoneOf(db, callSid)), contacts: (sess.contacts || 0) + 1 }).eq('id', sessionId);

  // Per-call recording on the lead leg (dual channel: agent / lead)
  if (cfg.record_calls) { try { await L.tw().calls(callSid).recordings.create({ recordingChannels: 'dual', recordingStatusCallback: base + '/.netlify/functions/dialer-status?kind=rec', recordingStatusCallbackMethod: 'POST' }); } catch (e) { } }

  // Drop the other ringing legs for this session so nobody else gets a dead-air answer
  try {
    const client = L.tw();
    const { data: others } = await db.from('dialer_calls').select('call_sid').eq('session_id', sessionId).neq('call_sid', callSid).in('status', ['queued', 'ringing']);
    await Promise.all((others || []).map(o => client.calls(o.call_sid).update({ status: 'completed' }).catch(() => null)));
    if (others && others.length) await db.from('dialer_calls').update({ status: 'canceled', ended_at: now }).in('call_sid', others.map(o => o.call_sid));
  } catch (e) { }

  const dial = vr.dial({ action: base + '/.netlify/functions/dialer-status?kind=leave&session=' + sessionId, method: 'POST' });
  dial.conference({ beep: false, startConferenceOnEnter: true, endConferenceOnExit: false, waitUrl: '' }, 'room_' + sess.identity);
  return L.xml(vr.toString());
};

async function phoneOf(db, sid) { const { data } = await db.from('dialer_calls').select('phone').eq('call_sid', sid).maybeSingle(); return data ? data.phone : null; }
