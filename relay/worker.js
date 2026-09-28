/**
 * kp-api-relay — Cloudflare Worker that relays kinopub API calls for kp.js.
 *
 * Why: Russian ISPs block kinopub API hosts (api.service-kp.com,
 * api.srvkp.com, kpapp.link) by DNS/SNI/IP; *.workers.dev stays reachable.
 * kp.js uses the relay only as a fallback when the direct host times out
 * (setting «Резервный relay API»).
 *
 * URL format (kp.js "CORS-proxy" convention: <relay>/<full target url>):
 *   https://<name>.<acc>.workers.dev/<SECRET>/https://api.service-kp.com/v1/items/123
 *   https://<name>.<acc>.workers.dev/<SECRET>/health   → { ok: true }
 *
 * SECRET is an environment variable set in the Worker settings (Variables).
 * Without it anyone who finds the URL could relay through your Worker.
 * Only kinopub API hosts are allowed as targets.
 */

const ALLOWED_HOSTS = ['api.service-kp.com', 'api.srvkp.com', 'kpapp.link'];
const VERSION = '1.0.0';

function json(status, obj) {
  return withCors(new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  }));
}

function withCors(resp) {
  const h = new Headers(resp.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  h.set('Access-Control-Allow-Headers', '*');
  h.set('Access-Control-Max-Age', '86400');
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));

    const url = new URL(request.url);
    let path = url.pathname.replace(/^\/+/, '');
    const secret = String(env && env.SECRET || '').trim();
    if (secret) {
      if (path !== secret && !path.startsWith(secret + '/')) return json(403, { ok: false, error: 'forbidden' });
      path = path.slice(secret.length).replace(/^\/+/, '');
    }

    if (path === '' || path === 'health') {
      return json(200, { ok: true, service: 'kp-api-relay', version: VERSION, hosts: ALLOWED_HOSTS });
    }

    // Some clients collapse "https://" to "https:/" in the path — tolerate it.
    const targetStr = path.replace(/^(https?:)\/(?!\/)/, '$1//') + url.search;
    let target;
    try { target = new URL(targetStr); } catch (e) { return json(400, { ok: false, error: 'bad target url' }); }
    if (target.protocol !== 'https:') return json(400, { ok: false, error: 'https only' });
    if (!ALLOWED_HOSTS.includes(target.hostname)) return json(403, { ok: false, error: 'host not allowed: ' + target.hostname });
    if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'HEAD') {
      return json(405, { ok: false, error: 'method not allowed' });
    }

    const headers = new Headers();
    for (const name of ['authorization', 'content-type', 'accept', 'accept-language']) {
      const v = request.headers.get(name);
      if (v) headers.set(name, v);
    }
    headers.set('user-agent', 'kp-api-relay/' + VERSION + ' (+lampa)');

    let upstream;
    try {
      upstream = await fetch(target.toString(), {
        method: request.method,
        headers,
        body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : await request.arrayBuffer(),
        redirect: 'follow',
        signal: AbortSignal.timeout(15000)
      });
    } catch (e) {
      return json(502, { ok: false, error: 'upstream: ' + (e && e.message || e) });
    }

    const out = new Headers();
    for (const name of ['content-type', 'cache-control', 'content-language']) {
      const v = upstream.headers.get(name);
      if (v) out.set(name, v);
    }
    out.set('X-Relay-Target', target.hostname);
    return withCors(new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out }));
  }
};
