// Async answering-machine verdict. If the leg we bridged turns out to be voicemail, drop it and free the agent.
const L = require('../lib/dialer');

exports.handler = async (event) => {
  const p = new URLSearchParams(event.body || '');
  const callSid = p.get('CallSid'), answeredBy = p.get('AnsweredBy') || 'unknown';
  const sessionId = (event.queryStringParameters || {}).session;
  const db = L.sb(); const now = new Date().toISOString();
  if (!callSid) return L.json(200, {});
  const { data: call } = await db.from('dialer_calls').select('id,status,session_id').eq('call_sid', callSid).maybeSingle();
  if (!call) return L.json(200, {});
  if (/machine|fax/.test(answeredBy)) {
    const stillActive = call.status === 'bridged' || call.status === 'answered';
    await db.from('dialer_calls').update({ answered_by: answeredBy, status: 'voicemail', ended_at: now }).eq('call_sid', callSid);
    if (sessionId) {
      const { data: s } = await db.from('dialer_sessions').select('active_call_sid,contacts').eq('id', sessionId).maybeSingle();
      if (s && s.active_call_sid === callSid) await db.from('dialer_sessions').update({ active_call_sid: null, active_phone: null, status: 'dialing', contacts: Math.max(0, (s.contacts || 1) - 1), last_seen_at: now }).eq('id', sessionId);
    }
    try { await L.tw().calls(callSid).update({ status: 'completed' }); } catch (e) { }
  } else {
    await db.from('dialer_calls').update({ answered_by: answeredBy }).eq('call_sid', callSid);
  }
  return L.json(200, {});
};
