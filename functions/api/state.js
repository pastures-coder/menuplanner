export async function onRequest(context) {
  const { request, env } = context;
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };

  try {
    if (!env.APPS_SCRIPT_URL) throw new Error('Cloudflare secret APPS_SCRIPT_URL is not configured');
    if (!env.HOUSEHOLD_KEY) throw new Error('Cloudflare secret HOUSEHOLD_KEY is not configured');

    const suppliedKey = request.headers.get('X-Meal-Key') || '';
    if (suppliedKey !== env.HOUSEHOLD_KEY) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid household key' }), { status: 401, headers });
    }

    const upstream = String(env.APPS_SCRIPT_URL).replace(/\/$/, '');

    if (request.method === 'GET') {
      const url = `${upstream}?action=loadState&key=${encodeURIComponent(env.HOUSEHOLD_KEY)}`;
      const response = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'Accept': 'application/json' } });
      const text = await response.text();
      if (!response.ok) throw new Error(`Google backend returned ${response.status}`);
      return new Response(text, { status: 200, headers });
    }

    if (request.method === 'POST') {
      const incoming = await request.json();
      const payload = {
        action: 'saveState',
        key: env.HOUSEHOLD_KEY,
        revision: incoming.revision,
        state: incoming.state,
      };
      const response = await fetch(upstream, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Google backend returned ${response.status}`);
      return new Response(text, { status: 200, headers });
    }

    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err?.message || String(err) }), { status: 500, headers });
  }
}
