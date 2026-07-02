// Texts Cole when a new recruit application lands in Supabase.
// Triggered by a Supabase Database Webhook on INSERT into public.recruits.
// Destination number comes ONLY from the NOTIFY_PHONE env var - the request
// can never choose who gets texted, so this endpoint can't be hijacked.
const twilio = require('twilio');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const payload = JSON.parse(event.body || '{}');
    // Supabase webhook shape: { type: 'INSERT', table: 'recruits', record: {...} }
    if (payload.type !== 'INSERT' || payload.table !== 'recruits') {
      return { statusCode: 200, headers, body: '{"skipped":true}' };
    }
    const r = payload.record || {};
    const name = String(r.full_name || 'Unknown').slice(0, 60);
    const ref = r.referred_by ? ' (referred by ' + String(r.referred_by).slice(0, 30) + ')' : '';
    const src = r.source ? ' via ' + String(r.source).slice(0, 20) : '';

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      to: process.env.NOTIFY_PHONE,
      from: process.env.TWILIO_PHONE_NUMBER,
      body: '🚀 New Surge application: ' + name + ref + src
    });
    return { statusCode: 200, headers, body: '{"ok":true}' };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
