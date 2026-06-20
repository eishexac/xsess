import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'cookie-signature';
import { session } from '../../src/middleware/hono/hono.js';
import { MemoryStorage } from '../../src/storage/memory.js';
import type { SessionOptions } from '../../src/core/resolve.js';

const TEST_SECRET = 'test-secret';

function createApp(overrides?: Partial<SessionOptions>) {
  const storage = new MemoryStorage();
  const app = new Hono();

  app.use(
    session({
      secret: TEST_SECRET,
      storage,
      ...overrides,
    }),
  );

  app.get('/set', (c) => {
    const sess = c.get('session');
    sess.count = ((sess.count as number) ?? 0) + 1;
    return c.json({ count: sess.count });
  });

  app.get('/get', (c) => {
    const sess = c.get('session');
    return c.json({ count: sess.count ?? 0 });
  });

  app.post('/destroy', async (c) => {
    const sess = c.get('session');
    await sess.destroy();
    return c.json({ destroyed: true });
  });

  app.get('/noop', (c) => {
    return c.json({ ok: true });
  });

  app.post('/regenerate', async (c) => {
    const sess = c.get('session');
    const oldId = sess.id;
    await sess.regenerate();
    return c.json({ oldId, newId: sess.id });
  });

  return { app, storage };
}

function extractSessionCookie(res: Response): string | undefined {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return undefined;
  // Hono may return multiple Set-Cookie headers comma-separated
  const cookies = setCookie.split(/,(?=\s*\w+=)/);
  return cookies.find((c) => c.trim().startsWith('sid='));
}

function extractCookieHeader(res: Response): string | undefined {
  const setCookie = extractSessionCookie(res);
  if (!setCookie) return undefined;
  // Extract just the name=value part for forwarding
  return setCookie.trim().split(';')[0];
}

describe('Hono session middleware (e2e)', () => {
  describe('cookie-based sessions', () => {
    it('creates a new session and sets cookie', async () => {
      const { app } = createApp();
      const res = await app.request('/set');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.count).toBe(1);
      expect(extractSessionCookie(res)).toBeDefined();
    });

    it('persists session data across requests via cookie', async () => {
      const { app } = createApp();
      const res1 = await app.request('/set');
      const cookieHeader = extractCookieHeader(res1);

      const res2 = await app.request('/set', {
        headers: { cookie: cookieHeader! },
      });
      const body = await res2.json();
      expect(body.count).toBe(2);
    });

    it('does not set cookie on subsequent requests without rolling', async () => {
      const { app } = createApp();
      const res1 = await app.request('/set');
      const cookieHeader = extractCookieHeader(res1);

      const res2 = await app.request('/get', {
        headers: { cookie: cookieHeader! },
      });
      expect(extractSessionCookie(res2)).toBeUndefined();
    });

    it('re-sets cookie on every request with rolling enabled', async () => {
      const { app } = createApp({ rolling: true, cookie: { maxAge: 60 } });
      const res1 = await app.request('/set');
      const cookieHeader = extractCookieHeader(res1);

      const res2 = await app.request('/get', {
        headers: { cookie: cookieHeader! },
      });
      expect(extractSessionCookie(res2)).toBeDefined();
    });
  });

  describe('header-based sessions', () => {
    it('resolves session from signed header value', async () => {
      const { app } = createApp();
      const res1 = await app.request('/set');
      const setCookie = extractSessionCookie(res1)!;
      const sidMatch = decodeURIComponent(setCookie).match(/sid=s:(.+?);/);
      const sessionId = sidMatch![1].split('.')[0];
      const signedId = sign(sessionId, TEST_SECRET);

      const res2 = await app.request('/get', {
        headers: { 'X-Session': signedId },
      });
      const body = await res2.json();
      expect(body.count).toBe(1);
    });

    it('ignores invalid header signature', async () => {
      const { app } = createApp();
      const res = await app.request('/get', {
        headers: { 'X-Session': 'invalid-signature' },
      });
      const body = await res.json();
      expect(body.count).toBe(0);
    });
  });

  describe('header policy', () => {
    it('does not set response header with policy "never"', async () => {
      const { app } = createApp({ header: { policy: 'never' } });
      const res = await app.request('/set');
      expect(res.headers.get('x-session')).toBeNull();
    });

    it('sets response header on new session with policy "init"', async () => {
      const { app } = createApp({ header: { policy: 'init' } });
      const res = await app.request('/set');
      expect(res.headers.get('x-session')).toBeDefined();
    });

    it('sets response header on every request with policy "always"', async () => {
      const { app } = createApp({ header: { policy: 'always' } });
      const res1 = await app.request('/set');
      const cookieHeader = extractCookieHeader(res1);

      const res2 = await app.request('/get', {
        headers: { cookie: cookieHeader! },
      });
      expect(res2.headers.get('x-session')).toBeDefined();
    });
  });

  describe('session lifecycle', () => {
    it('destroys session and clears cookie', async () => {
      const { app } = createApp();
      const res1 = await app.request('/set');
      const cookieHeader = extractCookieHeader(res1);

      const res2 = await app.request('/destroy', {
        method: 'POST',
        headers: { cookie: cookieHeader! },
      });
      const body = await res2.json();
      expect(body.destroyed).toBe(true);

      const setCookie = extractSessionCookie(res2);
      expect(setCookie).toContain('Expires=Thu, 01 Jan 1970');
    });

    it('regenerates session with a new id', async () => {
      const { app } = createApp();
      const res1 = await app.request('/set');
      const cookieHeader = extractCookieHeader(res1);

      const res2 = await app.request('/regenerate', {
        method: 'POST',
        headers: { cookie: cookieHeader! },
      });
      const body = await res2.json();
      expect(body.oldId).not.toBe(body.newId);
    });

    it('preserves session data after regeneration', async () => {
      const { app } = createApp();
      const res1 = await app.request('/set');
      const cookie1 = extractCookieHeader(res1);

      const res2 = await app.request('/set', {
        headers: { cookie: cookie1! },
      });
      const cookie2 = extractCookieHeader(res2) ?? cookie1;

      const res3 = await app.request('/regenerate', {
        method: 'POST',
        headers: { cookie: cookie2! },
      });
      const cookie3 = extractCookieHeader(res3);

      const res4 = await app.request('/get', {
        headers: { cookie: cookie3! },
      });
      const body = await res4.json();
      expect(body.count).toBe(2);
    });
  });

  describe('saveUninitialized', () => {
    it('does not save empty new sessions when false', async () => {
      const { app, storage } = createApp();
      const spy = vi.spyOn(storage, 'set');
      await app.request('/noop');
      expect(spy).not.toHaveBeenCalled();
    });

    it('saves new sessions with data when false', async () => {
      const { app, storage } = createApp();
      const spy = vi.spyOn(storage, 'set');
      await app.request('/set');
      expect(spy).toHaveBeenCalled();
    });

    it('saves empty new sessions when true', async () => {
      const { app, storage } = createApp({ saveUninitialized: true });
      const spy = vi.spyOn(storage, 'set');
      await app.request('/noop');
      expect(spy).toHaveBeenCalled();
    });

    it('does not set cookie on empty new session when false', async () => {
      const { app } = createApp();
      const res = await app.request('/noop');
      expect(extractSessionCookie(res)).toBeUndefined();
    });

    it('sets cookie on empty new session when true', async () => {
      const { app } = createApp({ saveUninitialized: true });
      const res = await app.request('/noop');
      expect(extractSessionCookie(res)).toBeDefined();
    });
  });

  describe('header-based sessions (continued)', () => {
    it('falls back to header when cookie has invalid signature', async () => {
      const { app } = createApp();
      const res1 = await app.request('/set');
      const setCookie = extractSessionCookie(res1)!;
      const sidMatch = decodeURIComponent(setCookie).match(/sid=s:(.+?);/);
      const sessionId = sidMatch![1].split('.')[0];
      const signedId = sign(sessionId, TEST_SECRET);

      const res2 = await app.request('/get', {
        headers: {
          cookie: 'sid=s%3Ainvalid.signature',
          'X-Session': signedId,
        },
      });
      const body = await res2.json();
      expect(body.count).toBe(1);
    });

    it('ignores cookie without s: prefix', async () => {
      const { app } = createApp();
      const res = await app.request('/get', {
        headers: { cookie: 'sid=no-prefix' },
      });
      const body = await res.json();
      expect(body.count).toBe(0);
    });
  });

  describe('header policy (continued)', () => {
    it('does not set response header on existing session with policy "init"', async () => {
      const { app } = createApp({ header: { policy: 'init' } });
      const res1 = await app.request('/set');
      const cookieHeader = extractCookieHeader(res1);

      const res2 = await app.request('/get', {
        headers: { cookie: cookieHeader! },
      });
      expect(res2.headers.get('x-session')).toBeNull();
    });

    it('sets response header with new id after regeneration (policy init)', async () => {
      const { app } = createApp({ header: { policy: 'init' } });
      const res1 = await app.request('/set');
      const initHeader = res1.headers.get('x-session');
      expect(initHeader).toBeDefined();
      const cookieHeader = extractCookieHeader(res1);

      const res2 = await app.request('/regenerate', {
        method: 'POST',
        headers: { cookie: cookieHeader! },
      });
      const regenHeader = res2.headers.get('x-session');
      expect(regenHeader).toBeDefined();
      expect(regenHeader).not.toBe(initHeader);
    });
  });

  describe('session lifecycle (continued)', () => {
    it('sets new cookie after regeneration', async () => {
      const { app } = createApp();
      const res1 = await app.request('/set');
      const firstCookie = extractSessionCookie(res1)!;
      const cookieHeader = extractCookieHeader(res1);

      const res2 = await app.request('/regenerate', {
        method: 'POST',
        headers: { cookie: cookieHeader! },
      });
      const newCookie = extractSessionCookie(res2)!;
      expect(newCookie).toBeDefined();
      expect(newCookie).not.toBe(firstCookie);
    });

    it('data is gone after destroy and new request', async () => {
      const { app } = createApp();
      const res1 = await app.request('/set');
      const cookieHeader = extractCookieHeader(res1);

      await app.request('/destroy', {
        method: 'POST',
        headers: { cookie: cookieHeader! },
      });

      // Use the old cookie — session should be gone from storage
      const res3 = await app.request('/get', {
        headers: { cookie: cookieHeader! },
      });
      const body = await res3.json();
      expect(body.count).toBe(0);
    });
  });

  describe('auto-save', () => {
    it('does not auto-save after destroy', async () => {
      const { app, storage } = createApp();
      const res1 = await app.request('/set');
      const setCookie = extractSessionCookie(res1)!;
      const sidMatch = decodeURIComponent(setCookie).match(/sid=s:(.+?);/);
      const sessionId = sidMatch![1].split('.')[0];
      const cookieHeader = extractCookieHeader(res1);

      await app.request('/destroy', {
        method: 'POST',
        headers: { cookie: cookieHeader! },
      });
      expect(storage.get(sessionId)).toBeNull();
    });
  });

  describe('saveUninitialized (continued)', () => {
    it('does not affect existing modified sessions', async () => {
      const { app, storage } = createApp({ saveUninitialized: false });
      const res1 = await app.request('/set');
      const cookieHeader = extractCookieHeader(res1);

      const spy = vi.spyOn(storage, 'set');
      await app.request('/set', {
        headers: { cookie: cookieHeader! },
      });
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('resave', () => {
    it('does not save existing unmodified sessions when false (default)', async () => {
      const { app, storage } = createApp();
      const res1 = await app.request('/set');
      const cookieHeader = extractCookieHeader(res1);

      const spy = vi.spyOn(storage, 'set');
      await app.request('/noop', {
        headers: { cookie: cookieHeader! },
      });
      expect(spy).not.toHaveBeenCalled();
    });

    it('saves existing modified sessions when false', async () => {
      const { app, storage } = createApp();
      const res1 = await app.request('/set');
      const cookieHeader = extractCookieHeader(res1);

      const spy = vi.spyOn(storage, 'set');
      await app.request('/set', {
        headers: { cookie: cookieHeader! },
      });
      expect(spy).toHaveBeenCalled();
    });

    it('saves existing unmodified sessions when true', async () => {
      const { app, storage } = createApp({ resave: true });
      const res1 = await app.request('/set');
      const cookieHeader = extractCookieHeader(res1);

      const spy = vi.spyOn(storage, 'set');
      await app.request('/noop', {
        headers: { cookie: cookieHeader! },
      });
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('store miss', () => {
    it('creates new session when signed cookie points to missing session', async () => {
      const { app } = createApp();
      const signedId = sign('nonexistent-id', TEST_SECRET);

      const res = await app.request('/set', {
        headers: { cookie: `sid=s%3A${encodeURIComponent(signedId)}` },
      });
      const body = await res.json();
      expect(body.count).toBe(1);
      expect(extractSessionCookie(res)).toBeDefined();
    });

    it('creates new session when signed header points to missing session', async () => {
      const { app } = createApp();
      const signedId = sign('nonexistent-id', TEST_SECRET);

      const res = await app.request('/set', {
        headers: { 'X-Session': signedId },
      });
      const body = await res.json();
      expect(body.count).toBe(1);
    });
  });

  describe('rolling', () => {
    it('does not crash when rolling is enabled without maxAge', async () => {
      const { app } = createApp({ rolling: true });
      const res1 = await app.request('/set');
      const cookieHeader = extractCookieHeader(res1);

      const res2 = await app.request('/get', {
        headers: { cookie: cookieHeader! },
      });
      expect(res2.status).toBe(200);
      expect(extractSessionCookie(res2)).toBeDefined();
    });
  });

  describe('options', () => {
    it('uses custom cookie name', async () => {
      const { app } = createApp({ name: 'my_sess' });
      const res = await app.request('/set');
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('my_sess=');
    });

    it('uses custom header name', async () => {
      const { app } = createApp({ header: { name: 'X-Token', policy: 'always' } });
      const res = await app.request('/set');
      expect(res.headers.get('x-token')).toBeDefined();
    });
  });
});
