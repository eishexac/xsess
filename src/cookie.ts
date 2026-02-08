import type { Response } from 'express';
import cookie from 'cookie';
import { sign } from 'cookie-signature';
import type { SessionCookie, SessionOptions } from './types/index.js';

/** Build a {@link SessionCookie} with sensible defaults, deriving `expires` from `maxAge`. */
export function buildCookie(opts: SessionOptions['cookie']): SessionCookie {
  const maxAge = opts?.maxAge ?? null;
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    ...opts,
    originalMaxAge: maxAge,
    ...(maxAge != null ? { expires: new Date(Date.now() + maxAge) } : {}),
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
    maxAge: sessionCookie.originalMaxAge ? sessionCookie.originalMaxAge / 1000 : undefined,
  });
}

/** Sign the session ID and set it as a `Set-Cookie` header on the response. */
export function setSessionCookie(
  res: Response,
  name: string,
  sessionId: string,
  sessionCookie: SessionCookie,
  secret: string,
): void {
  const signed = 's:' + sign(sessionId, secret);
  const serialized = serializeCookie(name, signed, sessionCookie);
  appendSetCookieHeader(res, serialized);
}

/** Clear the session cookie by setting it with an expired date. */
export function clearSessionCookie(
  res: Response,
  name: string,
  sessionCookie: SessionCookie,
): void {
  const serialized = serializeCookie(name, '', {
    ...sessionCookie,
    expires: new Date(0),
    originalMaxAge: null,
  });
  appendSetCookieHeader(res, serialized);
}

function appendSetCookieHeader(res: Response, value: string): void {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', value);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, value]);
  } else {
    res.setHeader('Set-Cookie', [existing as string, value]);
  }
}
