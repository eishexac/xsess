import cookie from 'cookie';
import { sign } from 'cookie-signature';
import type { CookieOptions, SessionCookie } from './session.js';

/** Build a {@link SessionCookie} with sensible defaults, deriving `expires` from `maxAge`. */
export function buildCookie(opts: CookieOptions | undefined): SessionCookie {
  const maxAge = opts?.maxAge ?? null;
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    ...opts,
    originalMaxAge: maxAge,
    ...(maxAge != null ? { expires: new Date(Date.now() + maxAge * 1000) } : {}),
  };
}

/** Serialize a cookie name/value pair with the given {@link SessionCookie} attributes. */
export function serializeCookie(name: string, val: string, sessionCookie: SessionCookie): string {
  return cookie.serialize(name, val, {
    path: sessionCookie.path,
    httpOnly: sessionCookie.httpOnly,
    sameSite: sessionCookie.sameSite as 'lax' | 'strict' | 'none' | undefined,
    secure: sessionCookie.secure,
    domain: sessionCookie.domain,
    expires: sessionCookie.expires ? new Date(sessionCookie.expires) : undefined,
    maxAge: sessionCookie.originalMaxAge ?? undefined,
  });
}

/** Build a signed Set-Cookie header value for the session. */
export function buildSetCookieHeader(
  name: string,
  sessionId: string,
  sessionCookie: SessionCookie,
  secret: string,
): string {
  const signed = 's:' + sign(sessionId, secret);
  return serializeCookie(name, signed, sessionCookie);
}

/** Build a Set-Cookie header value that clears the session cookie. */
export function buildClearCookieHeader(name: string, sessionCookie: SessionCookie): string {
  return serializeCookie(name, '', {
    ...sessionCookie,
    expires: new Date(0),
    originalMaxAge: null,
  });
}
