import type { Request, Response, NextFunction, RequestHandler } from 'express';
import cookie from 'cookie';
import { unsign } from 'cookie-signature';
import onHeaders from 'on-headers';
import { v7 as uuid7 } from 'uuid';
import { setSessionCookie } from './cookie.js';
import { createSession } from './session.js';
import { extractSessionData, toStoredSession } from './utils.js';
import { MemoryStore } from './stores/index.js';
import type { SessionOptions } from './types/index.js';

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
 * app.use(session({ secret: 'my-secret' }));
 * ```
 */
export function session(options: SessionOptions): RequestHandler {
  const name = options.name ?? 'sid';
  const secret = options.secret;
  const store = options.store ?? new MemoryStore();
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
          existingSession = await store.get(unsigned);
          if (existingSession) sessionId = unsigned;
        }
      }

      if (!sessionId && headerVal) {
        const unsigned = unsign(headerVal, secret);
        if (unsigned !== false) {
          existingSession = await store.get(unsigned);
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
        store,
        res,
        cookieName: name,
      });

      req.session = result.sess;

      const snapshot = isNew ? null : JSON.stringify(extractSessionData(result.sess));

      onHeaders(res, () => {
        if (result.destroyed) return;

        if (isNew || rolling || result.regenerated) {
          if ((rolling || result.regenerated) && result.sess.cookie.originalMaxAge != null) {
            result.sess.cookie.expires = new Date(Date.now() + result.sess.cookie.originalMaxAge);
          }
          setSessionCookie(res, name, result.sess.id, result.sess.cookie, secret);
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
          const saved: unknown = store.set(result.sess.id, toStoredSession(result.sess));
          if (saved instanceof Promise) {
            void saved.then(
              () => _end.apply(this, args),
              () => _end.apply(this, args),
            );
            return this;
          }
        } catch {
          // Sync store error — still complete the response
        }

        return _end.apply(this, args);
      } as typeof res.end;

      next();
    } catch (err) {
      next(err as Error);
    }
  };
}
