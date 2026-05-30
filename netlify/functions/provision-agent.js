const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');
exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  try {
    const { agentId, areaCode } = JSON.parse(event.body);
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const searchCode = areaCode || '479';
    let numbers = await client.availablePhoneNumbers('US').local.list({ areaCode: searchCode, limit: 1, voiceEnabled: true, smsEnabled: true });
    if (!numbers.length) numbers = await client.availablePhoneNumbers('US').local.list({ limit: 1, voiceEnabled: true, smsEnabled: true });
    if (!numbers.length) return { statusCode: 500, headers, body: JSON.stringify({ error: 'No numbers available' }) };
    const purchased = await client.incomingPhoneNumbers.create({ phoneNumber: numbers[0].phoneNumber, friendlyName: 'Surge Agent ' + agentId });
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    await sb.from('profiles').update({ twilio_number: purchased.phoneNumber, twilio_sid: purchased.sid, approved: true, status: 'active', subscription_active: true }).eq('id', agentId);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, number: purchased.phoneNumber }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
