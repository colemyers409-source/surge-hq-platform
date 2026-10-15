// Twilio status callbacks: call lifecycle, conference events, recordings, and the <Dial action> when a lead leaves.
const twilio = require('twilio');
const L = require('../lib/dialer');

exports.handler = async (event) => {
  const p = new URLSearchParams(event.body || '');
  const qs = event.queryStringParameters || {};
  const kind = qs.kind || 'call', sessionId = qs.session || null;
  const db = L.sb(); const now = new Date().toISOString();

  if (kind === 'rec') {
    const callSid = p.get('CallSid'), recSid = p.get('RecordingSid'), url = p.get('RecordingUrl'), status = p.get('RecordingStatus');
    if (status === 'completed' && recSid) {
      // Conference recordings report the conference, not the lead leg — attach by session room name
      const conf = p.get('ConferenceSid');
      if (callSid) await db.from('dialer_calls').update({ recording_sid: recSid, recording_url: url }).eq('call_sid', callSid);
      else if (conf) { const { data: c } = await db.from('dialer_calls').select('call_sid').eq('status', 'completed').order('ended_at', { ascending: false }).limit(1); if (c && c.length) await db.from('dialer_calls').update({ recording_sid: recSid, recording_url: url }).eq('call_sid', c[0].call_sid); }
    }
    return L.json(200, {});
  }

  if (kind === 'conf') {
    const ev = p.get('StatusCallbackEvent'), room = p.get('FriendlyName') || '';
    const userId = L.userFromIdentity(room.replace(/^room_/, ''));
    if (userId && ev === 'conference-end') {
      await db.from('dialer_sessions').update({ status: 'ended', ended_at: now, active_call_sid: null, active_phone: null }).eq('agent_id', userId).neq('status', 'ended');
    }
    return L.json(200, {});
  }

  if (kind === 'leave') {
    // Lead hung up (or was hung up on) → free the agent's line
    const callSid = p.get('CallSid');
    if (sessionId) { const { data: s } = await db.from('dialer_sessions').select('active_call_sid').eq('id', sessionId).maybeSingle(); if (s && s.active_call_sid === callSid) await db.from('dialer_sessions').update({ active_call_sid: null, active_phone: null, status: 'dialing', last_seen_at: now }).eq('id', sessionId); }
    const vr = new twilio.twiml.VoiceResponse(); vr.hangup(); return L.xml(vr.toString());
  }

  // kind === 'call'
  const callSid = p.get('CallSid'), st = p.get('CallStatus');
  if (!callSid) return L.json(200, {});
  const { data: c } = await db.from('dialer_calls').select('id,status,bridged_at,answered_by,session_id,phone').eq('call_sid', callSid).maybeSingle();
  if (!c) return L.json(200, {});
  const upd = {};
  if (st === 'ringing' && c.status === 'queued') upd.status = 'ringing';
  else if (st === 'in-progress' && c.status !== 'bridged' && c.status !== 'abandoned' && c.status !== 'voicemail') { upd.status = 'answered'; upd.answered_at = now; }
  else if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(st)) {
    upd.ended_at = now; upd.duration_sec = Number(p.get('CallDuration') || 0) || null;
    if (st === 'completed') { upd.status = (c.status === 'abandoned' || c.status === 'voicemail') ? c.status : (c.bridged_at ? 'completed' : 'completed'); if (c.bridged_at) upd.talk_sec = Math.max(0, Math.round((Date.now() - new Date(c.bridged_at).getTime()) / 1000)); }
    else upd.status = st === 'no-answer' ? 'no-answer' : st;
    // A real attempt only if the leg wasn't dropped because another line answered first
    if (upd.status !== 'canceled' && c.status !== 'canceled') { try { const { data: lp } = await db.from('lead_pool').select('attempts').eq('phone', c.phone).maybeSingle(); if (lp) await db.from('lead_pool').update({ attempts: (lp.attempts || 0) + 1, last_attempt_at: now }).eq('phone', c.phone); } catch (e) { } }
    // free the agent if this was the active leg
    const sid = sessionId || c.session_id;
    if (sid) { const { data: s } = await db.from('dialer_sessions').select('active_call_sid,talk_sec').eq('id', sid).maybeSingle(); if (s && s.active_call_sid === callSid) await db.from('dialer_sessions').update({ active_call_sid: null, active_phone: null, status: 'dialing', talk_sec: (s.talk_sec || 0) + (upd.talk_sec || 0), last_seen_at: now }).eq('id', sid); }
  }
  if (Object.keys(upd).length) await db.from('dialer_calls').update(upd).eq('call_sid', callSid);
  return L.json(200, {});
};
