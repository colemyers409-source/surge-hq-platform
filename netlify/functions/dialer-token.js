// Mints a Twilio Voice access token for the logged-in agent's browser (Voice JS SDK).
const twilio = require('twilio');
const L = require('../lib/dialer');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return L.json(200, {});
  const me = await L.auth(event);
  if (!me) return L.json(401, { error: 'Not signed in' });
  const db = L.sb();
  const ent = await L.entitled(db, me);
  if (!ent.ok) return L.json(402, { error: 'No active Surge Dialer subscription', paywall: true, status: ent.status || null });
  const s = await L.settings(db);
  if (!s.api_key_sid || !s.api_key_secret || !s.twiml_app_sid) return L.json(409, { error: 'Dialer not set up yet. Owner: open Dialer → Setup.' });
  const identity = L.identityFor(me.id);
  const AccessToken = twilio.jwt.AccessToken;
  const token = new AccessToken(process.env.TWILIO_ACCOUNT_SID, s.api_key_sid, s.api_key_secret, { identity, ttl: 3600 * 8 });
  token.addGrant(new AccessToken.VoiceGrant({ outgoingApplicationSid: s.twiml_app_sid, incomingAllow: true }));
  return L.json(200, { token: token.toJwt(), identity, ttl: 3600 * 8, lines: ent.lines, plan: ent.plan });
};
