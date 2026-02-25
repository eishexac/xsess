// Side-effect: augments Hono ContextVariableMap with session property
import './hono.augment.js';

import { createMiddleware } from 'hono/factory';
import { resolveSession, resolveOptions } from '../../core/resolve.js';
import type { SessionOptions } from '../../core/resolve.js';

/**
 * Creates a Hono session middleware.
 *
 * Resolves session IDs from cookies first, then falls back to the request header.
 * New sessions are created with a UUID v7 ID and auto-saved when the response finishes.
 *
 * @param options - Session configuration
 * @returns Hono middleware that sets `session` on the context
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { session } from 'xsess/hono';
 *
 * const app = new Hono();
 * app.use(session({ secret: 'my-secret' }));
 *
 * app.get('/', (c) => {
 *   const sess = c.get('session');
 *   return c.json({ id: sess.id });
 * });
 * ```
 */
export function session(options: SessionOptions) {
  const resolved = resolveOptions(options);

  return createMiddleware(async (c, next) => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { session, finalize } = await resolveSession(c.req.raw, resolved);
    c.set('session', session);

    await next();

    const { headers } = await finalize();
    for (const [key, value] of headers) {
      c.header(key, value, { append: true });
    }
  });
}
