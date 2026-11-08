export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = new URL(env.NARA_ORIGIN);
    url.protocol = origin.protocol;
    url.host = origin.host;
    const headers = new Headers(request.headers);
    headers.delete('X-Nara-Gateway');
    headers.delete('X-Nara-Country');
    if (url.pathname === '/live/api/run') {
      headers.set('X-Nara-Gateway', env.NARA_GATEWAY_SECRET);
      headers.set('X-Nara-Country', request.cf?.country ?? 'XX');
    }
    return fetch(new Request(url, { method: request.method, headers, body: request.body, redirect: 'manual' }));
  },
};
