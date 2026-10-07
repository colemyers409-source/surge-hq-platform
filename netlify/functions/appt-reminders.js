// Scheduled every 5 minutes (see netlify.toml). Sends a free web-push reminder
// to the agent's installed app before each upcoming appointment.
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async () => {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return { statusCode: 500, body: 'VAPID keys missing' };
  webpush.setVapidDetails('mailto:surgequality@surgelifegroup.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Appointments that are due for a reminder: start - reminder_min <= now (+5 min look-ahead) and not yet sent.
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000); // only look a day out
  const { data: appts, error } = await sb.from('appointments')
    .select('id,agent_id,client_name,client_phone,appt_type,starts_at,reminder_min')
    .eq('status', 'scheduled').eq('reminder_sent', false)
    .gte('starts_at', new Date(now.getTime() - 60 * 60 * 1000).toISOString())
    .lte('starts_at', horizon.toISOString());
  if (error) return { statusCode: 500, body: error.message };

  const due = (appts || []).filter(a => new Date(a.starts_at).getTime() - a.reminder_min * 60000 <= now.getTime() + 5 * 60000);
  if (!due.length) return { statusCode: 200, body: 'nothing due' };

  const agentIds = [...new Set(due.map(a => a.agent_id))];
  const { data: subs } = await sb.from('push_subscriptions').select('id,user_id,subscription').in('user_id', agentIds);
  const byUser = {};
  (subs || []).forEach(s => { (byUser[s.user_id] = byUser[s.user_id] || []).push(s); });

  let sent = 0; const dead = [];
  for (const a of due) {
    const when = new Date(a.starts_at);
    const mins = Math.max(0, Math.round((when.getTime() - now.getTime()) / 60000));
    const time = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
    const payload = JSON.stringify({
      title: mins <= 1 ? `Appointment now: ${a.client_name}` : `${a.appt_type} in ${mins} min: ${a.client_name}`,
      body: `${time} CT` + (a.client_phone ? ` · ${a.client_phone}` : '') + ' · Open Agent Space to dispo it after.',
      url: '/agent?page=appointments',
      tag: 'appt-' + a.id
    });
    for (const s of (byUser[a.agent_id] || [])) {
      try { await webpush.sendNotification(s.subscription, payload); sent++; }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) dead.push(s.id); }
    }
    await sb.from('appointments').update({ reminder_sent: true }).eq('id', a.id);
  }
  if (dead.length) await sb.from('push_subscriptions').delete().in('id', dead);
  return { statusCode: 200, body: `sent ${sent} push(es) for ${due.length} appointment(s)` };
};
