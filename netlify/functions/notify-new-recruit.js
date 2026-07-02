// Emails Cole when a new recruit application lands in Supabase.
// Triggered by a Supabase Database Webhook on INSERT into public.recruits.
// Destination comes ONLY from the NOTIFY_EMAIL env var - the request can
// never choose who gets emailed, so this endpoint can't be hijacked.
// No Twilio, no API keys - delivers via the free formsubmit.co relay.

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
    const s = (v, n) => String(v || '').slice(0, n);

    const resp = await fetch('https://formsubmit.co/ajax/' + process.env.NOTIFY_EMAIL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        _subject: '🚀 New Surge Application: ' + s(r.full_name || 'Unknown', 60),
        _template: 'table',
        Name: s(r.full_name, 80),
        Phone: s(r.phone, 30),
        Email: s(r.email, 80),
        Location: s(r.city_state, 80),
        'Referred By': s(r.referred_by, 40) || '—',
        Source: s(r.source, 40) || '—',
        'Affiliate Code': s(r.ref_code, 40) || '—',
        Video: s(r.video_url, 200) || '—',
        Submitted: s(r.created_at, 30)
      })
    });
    const ok = resp.ok;
    return { statusCode: ok ? 200 : 502, headers, body: JSON.stringify({ ok: ok }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
