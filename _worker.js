export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/state' || url.pathname === '/api/state/') {
      return handleState(request, env);
    }
    if (url.pathname === '/api/health' || url.pathname === '/api/health/') {
      return jsonResponse({
        ok: true,
        service: 'meal-planner-cloudflare',
        appsScriptConfigured: !!env.APPS_SCRIPT_URL,
        householdKeyConfigured: !!env.HOUSEHOLD_KEY,
      });
    }
    return env.ASSETS.fetch(request);
  }
};

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}

function previewText(text) {
  return String(text || '')
    .replace(/\\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

async function parseGoogleJson(response) {
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    const ct = response.headers.get('content-type') || '';
    throw new Error(
      `Google backend returned non-JSON content (${response.status}, ${ct || 'unknown content-type'}). ` +
      `This usually means the Apps Script web app is not accessible to anonymous server requests. ` +
      `Response starts: ${previewText(text) || '[empty]'}`
    );
  }
  if (!response.ok) {
    throw new Error(payload?.error || `Google backend returned HTTP ${response.status}`);
  }
  return payload;
}

async function handleState(request, env) {
  try {
    if (!env.APPS_SCRIPT_URL) {
      return jsonResponse({ ok: false, error: 'Cloudflare variable APPS_SCRIPT_URL is not configured' }, 500);
    }
    if (!env.HOUSEHOLD_KEY) {
      return jsonResponse({ ok: false, error: 'Cloudflare variable HOUSEHOLD_KEY is not configured' }, 500);
    }

    const suppliedKey = request.headers.get('X-Meal-Key') || '';
    if (suppliedKey !== env.HOUSEHOLD_KEY) {
      return jsonResponse({ ok: false, error: 'Invalid household key' }, 401);
    }

    const upstream = String(env.APPS_SCRIPT_URL)
      .trim()
      .replace(/\\/u\\/\\d+\\//, '/')
      .replace(/[?#].*$/, '')
      .replace(/\\/$/, '');

    if (!/^https:\\/\\/script\\.google\\.com\\/macros\\/s\\/[^/]+\\/exec$/.test(upstream)) {
      return jsonResponse({
        ok: false,
        error: 'APPS_SCRIPT_URL is not a canonical Apps Script /macros/s/.../exec URL',
      }, 500);
    }

    if (request.method === 'GET') {
      const googleUrl = `${upstream}?action=loadState&key=${encodeURIComponent(env.HOUSEHOLD_KEY)}`;
      const response = await fetch(googleUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'Accept': 'application/json,text/plain,*/*' },
      });
      const payload = await parseGoogleJson(response);
      return jsonResponse(payload, 200);
    }

    if (request.method === 'POST') {
      let incoming;
      try { incoming = await request.json(); }
      catch (_) { return jsonResponse({ ok:false, error:'Meal Planner sent invalid JSON to Cloudflare' }, 400); }

      const payload = {
        action: 'saveState',
        key: env.HOUSEHOLD_KEY,
        revision: incoming.revision,
        state: incoming.state,
      };
      const response = await fetch(upstream, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json,text/plain,*/*' },
        body: JSON.stringify(payload),
      });
      const result = await parseGoogleJson(response);
      return jsonResponse(result, 200);
    }

    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  } catch (err) {
    return jsonResponse({ ok: false, error: err?.message || String(err) }, 502);
  }
}
