export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const token = String(req.query?.token || '');
  const password = String(req.query?.password || '');
  if (!token || password.length < 12) return res.status(400).json({ ok: false, error: 'missing_or_invalid_input' });

  try {
    const upstream = await fetch('https://api.call2me.app/v1/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, new_password: password }),
    });
    const text = await upstream.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
    return res.status(upstream.status).json({ ok: upstream.ok, status: upstream.status, body });
  } catch (error) {
    return res.status(502).json({ ok: false, error: 'upstream_failure' });
  }
}
