// Streams a call recording to a signed-in agent (own calls) or owner/admin. Twilio recordings need
// account auth, so the browser can't open them directly.
const L = require('../lib/dialer');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return L.json(200, {});
  const me = await L.auth(event);
  if (!me) return L.json(401, { error: 'Not signed in' });
  const sid = (event.queryStringParameters || {}).sid;
  if (!sid || !/^RE[a-f0-9]{32}$/i.test(sid)) return L.json(400, { error: 'sid required' });
  const db = L.sb();
  const { data: c } = await db.from('dialer_calls').select('agent_id').eq('recording_sid', sid).maybeSingle();
  if (!c || (c.agent_id !== me.id && !me.isOwner)) return L.json(403, { error: 'Not your call' });
  const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${sid}.mp3`;
  const r = await fetch(url, { headers: { Authorization: 'Basic ' + Buffer.from(process.env.TWILIO_ACCOUNT_SID + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64') } });
  if (!r.ok) return L.json(502, { error: 'Twilio ' + r.status });
  const buf = Buffer.from(await r.arrayBuffer());
  return { statusCode: 200, headers: Object.assign({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=3600' }, L.CORS), body: buf.toString('base64'), isBase64Encoded: true };
};
