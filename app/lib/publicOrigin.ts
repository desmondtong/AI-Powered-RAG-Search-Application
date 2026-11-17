/**
 * The origin the browser actually used for a request. Shared by the experience and JD-fit same-origin guards.
 *
 * Behind a TLS-terminating front end such as Cloud Run, the server sees plain HTTP and its own listen address in
 * `req.url` (for example `https://0.0.0.0:8080/...`), so comparing `Origin` with `req.url` rejects every hosted
 * request. The public scheme comes from `X-Forwarded-Proto` (set and overwritten by the front end) and the public
 * host from `X-Forwarded-Host` or `Host`, which a browser cannot forge for a cross-site request. Without those
 * headers, `req.url` decides.
 */
export function publicRequestOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = firstHeaderValue(req, "x-forwarded-host") ?? firstHeaderValue(req, "host");
  if (!host) {
    return url.origin;
  }
  const forwardedProto = firstHeaderValue(req, "x-forwarded-proto")?.toLowerCase();
  const protocol = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : url.protocol.slice(0, -1);
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return url.origin;
  }
}

function firstHeaderValue(req: Request, name: string): string | null {
  const value = req.headers.get(name)?.split(",")[0]?.trim();
  return value ? value : null;
}
