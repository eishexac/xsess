// Side-effect: augments Express.Request with session property
import './express.augment.js';

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import cookie from 'cookie';
import { unsign } from 'cookie-signature';
import onHeaders from 'on-headers';
import { v7 as uuid7 } from 'uuid';
import { buildSetCookieHeader, buildClearCookieHeader } from '../../core/cookie.js';
import { createSession, extractSessionData, toStoredSession } from '../../core/session.js';
import { MemoryStorage } from '../../storage/memory.js';
import type { SessionOptions } from '../../core/resolve.js';

/**
 * Creates an Express session middleware.
 *
 * Resolves session IDs from cookies first, then falls back to the request header.
 * New sessions are created with a UUID v7 ID and auto-saved when the response finishes.
 *
 * @param options - Session configuration
 * @returns Express middleware that attaches `req.session`
 *
 * @example
 * ```ts
 * import { session } from 'xsess/express';
 * app.use(session({ secret: 'my-secret' }));
 * ```
 */
export function session(options: SessionOptions): RequestHandler {
  const name = options.name ?? 'sid';
  const secret = options.secret;
  const storage = options.storage ?? new MemoryStorage();
  const rolling = options.rolling ?? false;
  const resave = options.resave ?? false;
  const saveUninitialized = options.saveUninitialized ?? false;
  const headerName = options.header?.name ?? 'X-Session';
  const headerPolicy = options.header?.policy ?? 'never';
  const cookieDefaults = options.cookie;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.session) return next();

    try {
      let sessionId: string | null = null;
      let existingSession = null;

      const rawCookies = req.headers.cookie ? cookie.parse(req.headers.cookie) : {};
      const cookieVal = rawCookies[name];
      const headerVal = req.get(headerName);

      if (cookieVal && cookieVal.startsWith('s:')) {
        const unsigned = unsign(cookieVal.slice(2), secret);
        if (unsigned !== false) {
          existingSession = await storage.get(unsigned);
          if (existingSession) sessionId = unsigned;
        }
      }

      if (!sessionId && headerVal) {
        const unsigned = unsign(headerVal, secret);
        if (unsigned !== false) {
          existingSession = await storage.get(unsigned);
          if (existingSession) sessionId = unsigned;
        }
      }

      const isNew = sessionId == null;
      sessionId = sessionId ?? uuid7();

      const result = createSession({
        sessionId,
        existingSession,
        cookieDefaults,
        secret,
        storage,
      });

      req.session = result.sess;

      const snapshot = isNew ? null : JSON.stringify(extractSessionData(result.sess));

      onHeaders(res, () => {
        if (result.destroyed) {
          appendSetCookieHeader(res, buildClearCookieHeader(name, result.sess.cookie));
          return;
        }

        if (isNew || rolling || result.regenerated) {
          if ((rolling || result.regenerated) && result.sess.cookie.originalMaxAge != null) {
            result.sess.cookie.expires = new Date(
              Date.now() + result.sess.cookie.originalMaxAge * 1000,
            );
          }
          appendSetCookieHeader(
            res,
            buildSetCookieHeader(name, result.sess.id, result.sess.cookie, secret),
          );
        }

        const shouldSetHeader =
          headerPolicy === 'always' || (headerPolicy === 'init' && (isNew || result.regenerated));

        if (shouldSetHeader) {
          res.setHeader(headerName, result.sess.signedId);
        }
      });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const _end = res.end as (this: Response, ...args: any[]) => Response;
      res.end = function end(this: Response, ...args: any[]) {
        res.end = _end as typeof res.end;

        if (result.destroyed) {
          return _end.apply(this, args);
        }

        if (
          !saveUninitialized &&
          isNew &&
          Object.keys(extractSessionData(result.sess)).length === 0
        ) {
          return _end.apply(this, args);
        }

        if (
          !resave &&
          !isNew &&
          !result.regenerated &&
          JSON.stringify(extractSessionData(result.sess)) === snapshot
        ) {
          return _end.apply(this, args);
        }

        try {
          const saved: unknown = storage.set(result.sess.id, toStoredSession(result.sess));
          if (saved instanceof Promise) {
            void saved.then(
              () => _end.apply(this, args),
              () => _end.apply(this, args),
            );
            return this;
          }
        } catch {
          // Sync storage error — still complete the response
        }

        return _end.apply(this, args);
      } as typeof res.end;

      next();
    } catch (err) {
      next(err as Error);
    }
  };
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
