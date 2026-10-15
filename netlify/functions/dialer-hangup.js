// Agent ends the current lead call (or cancels ringing lines) without leaving their room.
const L = require('../lib/dialer');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return L.json(200, {});
  const me = await L.auth(event);
  if (!me) return L.json(401, { error: 'Not signed in' });
  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return L.json(400, { error: 'bad json' }); }
  const db = L.sb(), client = L.tw(), now = new Date().toISOString();
  const { sessionId, callSid, all } = body;
  const q = db.from('dialer_calls').select('call_sid,status').eq('agent_id', me.id).in('status', ['queued', 'ringing', 'answered', 'bridged']);
  if (!all && callSid) q.eq('call_sid', callSid); else if (sessionId) q.eq('session_id', sessionId);
  const { data: calls } = await q;
  let n = 0;
  for (const c of (calls || [])) { try { await client.calls(c.call_sid).update({ status: 'completed' }); n++; } catch (e) { } }
  if (calls && calls.length) await db.from('dialer_calls').update({ ended_at: now }).in('call_sid', calls.map(c => c.call_sid)).is('ended_at', null);
  if (sessionId) await db.from('dialer_sessions').update({ active_call_sid: null, active_phone: null, status: 'dialing', last_seen_at: now }).eq('id', sessionId).eq('agent_id', me.id);
  return L.json(200, { ended: n });
};
