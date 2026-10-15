import {
  PHONE_CONTENT_TYPE,
  PHONE_IDENTITY_HEADERS,
  renderTerminalPhonePublication,
  requirePhonePublicBaseUrl,
} from './terminal-phone-publication.mjs';

const ROUTE = /^\/tasks\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/(deep-log|phone)$/;
const headers = () => ({
  'Content-Type': PHONE_CONTENT_TYPE,
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
});
const response = (body, status) => new Response(body, { status, headers: headers() });

/** The sole persistence capability is read(taskId); GET cannot finalize Evidence. */
export function createPhoneHttpHandler({ read, publicBaseUrl } = {}) {
  if (typeof read !== 'function') throw new TypeError('read must be a function');
  const origin = requirePhonePublicBaseUrl(publicBaseUrl);
  return async function handle(request) {
    if (request?.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: { ...headers(), Allow: 'GET' } });
    }
    let url;
    try { url = new URL(request.url); } catch { return response('Not found', 404); }
    const route = !url.search && !url.hash ? ROUTE.exec(url.pathname) : null;
    if (!route) return response('Not found', 404);
    try {
      const receipt = await read(route[1]);
      if (receipt === null) return response('Not found', 404);
      const publication = renderTerminalPhonePublication({ receipt, publicBaseUrl: origin });
      if (publication.taskId !== route[1]) return response('Evidence unavailable', 503);
      const identityHeaders = Object.fromEntries(Object.entries(PHONE_IDENTITY_HEADERS)
        .map(([field, header]) => [header, publication[field]]));
      return new Response(route[2] === 'phone' ? publication.text : publication.deepLogText, {
        status: 200,
        headers: { ...headers(), ...identityHeaders },
      });
    } catch {
      return response('Evidence unavailable', 503);
    }
  };
}
