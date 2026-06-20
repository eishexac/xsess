import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { sign } from 'cookie-signature';
import { session } from '../../src/middleware/express/express.js';
import { createApp, TEST_SECRET } from './setup.js';

function extractSessionCookie(res: request.Response): string | undefined {
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) return undefined;
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies.find((c: string) => c.startsWith('sid='));
}

describe('session middleware (e2e)', () => {
  describe('cookie-based sessions', () => {
    it('creates a new session and sets cookie', async () => {
      const { app } = createApp();
      const res = await request(app).get('/set');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(extractSessionCookie(res)).toBeDefined();
    });

    it('persists session data across requests via cookie', async () => {
      const { app } = createApp();
      const agent = request.agent(app);

      await agent.get('/set');
      const res = await agent.get('/set');
      expect(res.body.count).toBe(2);
    });

    it('does not set cookie on subsequent requests without rolling', async () => {
      const { app } = createApp();
      const agent = request.agent(app);

      await agent.get('/set');
      const res = await agent.get('/get');
      expect(extractSessionCookie(res)).toBeUndefined();
    });

    it('re-sets cookie on every request with rolling enabled', async () => {
      const { app } = createApp({ rolling: true, cookie: { maxAge: 60_000 } });
      const agent = request.agent(app);

      await agent.get('/set');
      const res = await agent.get('/get');
      expect(extractSessionCookie(res)).toBeDefined();
    });
  });

  describe('header-based sessions', () => {
    it('resolves session from signed header value', async () => {
      const { app } = createApp();
      const agent = request.agent(app);

      const first = await agent.get('/set');
      const cookie = extractSessionCookie(first)!;
      const sidMatch = decodeURIComponent(cookie).match(/sid=s:(.+?);/);
      const sessionId = sidMatch![1].split('.')[0];
      const signedId = sign(sessionId, TEST_SECRET);

      const res = await request(app).get('/get').set('X-Session', signedId);
      expect(res.body.count).toBe(1);
    });

    it('ignores invalid header signature', async () => {
      const { app } = createApp();
      const res = await request(app).get('/get').set('X-Session', 'invalid-signature');
      expect(res.body.count).toBe(0);
    });

    it('falls back to header when cookie has invalid signature', async () => {
      const { app } = createApp();
      const agent = request.agent(app);

      const first = await agent.get('/set');
      const cookie = extractSessionCookie(first)!;
      const sidMatch = decodeURIComponent(cookie).match(/sid=s:(.+?);/);
      const sessionId = sidMatch![1].split('.')[0];
      const signedId = sign(sessionId, TEST_SECRET);

      const res = await request(app)
        .get('/get')
        .set('Cookie', 'sid=s:invalid.signature')
        .set('X-Session', signedId);
      expect(res.body.count).toBe(1);
    });

    it('ignores cookie without s: prefix', async () => {
      const { app } = createApp();
      const res = await request(app).get('/get').set('Cookie', 'sid=no-prefix');
      expect(res.body.count).toBe(0);
    });
  });

  describe('header policy', () => {
    it('does not set response header with policy "never"', async () => {
      const { app } = createApp({ header: { policy: 'never' } });
      const res = await request(app).get('/set');
      expect(res.headers['x-session']).toBeUndefined();
    });

    it('sets response header on new session with policy "init"', async () => {
      const { app } = createApp({ header: { policy: 'init' } });
      const res = await request(app).get('/set');
      expect(res.headers['x-session']).toBeDefined();
    });

    it('does not set response header on existing session with policy "init"', async () => {
      const { app } = createApp({ header: { policy: 'init' } });
      const agent = request.agent(app);

      await agent.get('/set');
      const res = await agent.get('/get');
      expect(res.headers['x-session']).toBeUndefined();
    });

    it('sets response header on every request with policy "always"', async () => {
      const { app } = createApp({ header: { policy: 'always' } });
      const agent = request.agent(app);

      await agent.get('/set');
      const res = await agent.get('/get');
      expect(res.headers['x-session']).toBeDefined();
    });
  });

  describe('session lifecycle', () => {
    it('destroys session and clears cookie', async () => {
      const { app } = createApp();
      const agent = request.agent(app);

      await agent.get('/set');
      const res = await agent.post('/destroy');
      expect(res.body.destroyed).toBe(true);

      const cookie = extractSessionCookie(res);
      expect(cookie).toContain('Expires=Thu, 01 Jan 1970');

      const after = await agent.get('/get');
      expect(after.body.count).toBe(0);
    });

    it('regenerates session with a new id', async () => {
      const { app } = createApp();
      const agent = request.agent(app);

      await agent.get('/set');
      const res = await agent.post('/regenerate');
      expect(res.body.oldId).not.toBe(res.body.newId);
    });

    it('preserves session data after regeneration', async () => {
      const { app } = createApp();
      const agent = request.agent(app);

      await agent.get('/set');
      await agent.get('/set');
      await agent.post('/regenerate');
      const res = await agent.get('/get');
      expect(res.body.count).toBe(2);
    });

    it('sets new cookie after regeneration', async () => {
      const { app } = createApp();
      const agent = request.agent(app);

      const first = await agent.get('/set');
      const firstCookie = extractSessionCookie(first)!;
      const res = await agent.post('/regenerate');
      const newCookie = extractSessionCookie(res)!;
      expect(newCookie).toBeDefined();
      expect(newCookie).not.toBe(firstCookie);
    });

    it('sends response header with new id after regeneration (policy init)', async () => {
      const { app } = createApp({ header: { policy: 'init' } });
      const agent = request.agent(app);

      const first = await agent.get('/set');
      const initHeader = first.headers['x-session'];
      expect(initHeader).toBeDefined();

      const res = await agent.post('/regenerate');
      const regenHeader = res.headers['x-session'];
      expect(regenHeader).toBeDefined();
      expect(regenHeader).not.toBe(initHeader);
    });
  });

  describe('options', () => {
    it('uses custom cookie name', async () => {
      const { app } = createApp({ name: 'my_sess' });
      const res = await request(app).get('/set');
      const setCookie = res.headers['set-cookie'];
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      expect(cookies.find((c: string) => c.startsWith('my_sess='))).toBeDefined();
    });

    it('uses custom header name', async () => {
      const { app } = createApp({ header: { name: 'X-Token', policy: 'always' } });
      const res = await request(app).get('/set');
      expect(res.headers['x-token']).toBeDefined();
    });
  });

  describe('auto-save', () => {
    it('does not auto-save after destroy', async () => {
      const { app, storage } = createApp();
      const agent = request.agent(app);

      const first = await agent.get('/set');
      const cookie = extractSessionCookie(first)!;
      const sidMatch = decodeURIComponent(cookie).match(/sid=s:(.+?);/);
      const sessionId = sidMatch![1].split('.')[0];

      await agent.post('/destroy');
      expect(storage.get(sessionId)).toBeNull();
    });
  });

  describe('saveUninitialized', () => {
    it('does not save empty new sessions to store when false (default)', async () => {
      const { app, storage } = createApp();
      const spy = vi.spyOn(storage, 'set');
      await request(app).get('/noop');
      expect(spy).not.toHaveBeenCalled();
    });

    it('saves new sessions with data to store when false', async () => {
      const { app, storage } = createApp();
      const spy = vi.spyOn(storage, 'set');
      await request(app).get('/set');
      expect(spy).toHaveBeenCalled();
    });

    it('saves empty new sessions to store when true', async () => {
      const { app, storage } = createApp({ saveUninitialized: true });
      const spy = vi.spyOn(storage, 'set');
      await request(app).get('/noop');
      expect(spy).toHaveBeenCalled();
    });

    it('does not set cookie on empty new session when false', async () => {
      const { app } = createApp();
      const res = await request(app).get('/noop');
      expect(extractSessionCookie(res)).toBeUndefined();
    });

    it('sets cookie on empty new session when true', async () => {
      const { app } = createApp({ saveUninitialized: true });
      const res = await request(app).get('/noop');
      expect(extractSessionCookie(res)).toBeDefined();
    });

    it('saveUninitialized does not affect existing modified sessions', async () => {
      const { app, storage } = createApp({ saveUninitialized: false });
      const agent = request.agent(app);

      await agent.get('/set');
      const spy = vi.spyOn(storage, 'set');
      await agent.get('/set');
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('resave', () => {
    it('does not save existing unmodified sessions when false (default)', async () => {
      const { app, storage } = createApp();
      const agent = request.agent(app);

      await agent.get('/set');
      const spy = vi.spyOn(storage, 'set');
      await agent.get('/noop');
      expect(spy).not.toHaveBeenCalled();
    });

    it('saves existing modified sessions when false', async () => {
      const { app, storage } = createApp();
      const agent = request.agent(app);

      await agent.get('/set');
      const spy = vi.spyOn(storage, 'set');
      await agent.get('/set');
      expect(spy).toHaveBeenCalled();
    });

    it('saves existing unmodified sessions when true', async () => {
      const { app, storage } = createApp({ resave: true });
      const agent = request.agent(app);

      await agent.get('/set');
      const spy = vi.spyOn(storage, 'set');
      await agent.get('/noop');
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('middleware idempotency', () => {
    it('does not re-initialize if req.session already exists', async () => {
      const app = express();
      app.use((_req, _res, next) => {
        (_req as any).session = { id: 'pre-existing', preset: true };
        next();
      });
      app.use(session({ secret: TEST_SECRET }));
      app.get('/check', (req, res) => {
        res.json({ id: req.session.id, preset: (req.session as any).preset });
      });

      const res = await request(app).get('/check');
      expect(res.body.id).toBe('pre-existing');
      expect(res.body.preset).toBe(true);
    });
  });

  describe('store miss', () => {
    it('creates new session when signed cookie points to missing session', async () => {
      const { app } = createApp();
      const signedId = sign('nonexistent-id', TEST_SECRET);

      const res = await request(app).get('/set').set('Cookie', `sid=s:${signedId}`);
      expect(res.body.count).toBe(1);
      expect(extractSessionCookie(res)).toBeDefined();
    });

    it('creates new session when signed header points to missing session', async () => {
      const { app } = createApp();
      const signedId = sign('nonexistent-id', TEST_SECRET);

      const res = await request(app).get('/set').set('X-Session', signedId);
      expect(res.body.count).toBe(1);
    });
  });

  describe('rolling', () => {
    it('does not crash when rolling is enabled without maxAge', async () => {
      const { app } = createApp({ rolling: true });
      const agent = request.agent(app);

      await agent.get('/set');
      const res = await agent.get('/get');
      expect(res.status).toBe(200);
      expect(extractSessionCookie(res)).toBeDefined();
    });
  });

  describe('async store save ordering', () => {
    it('completes save before response so sequential requests see latest data', async () => {
      const data = new Map<string, any>();
      const asyncStore = {
        get(id: string) {
          return Promise.resolve(data.get(id) ?? null);
        },
        set(id: string, session: any) {
          return new Promise<void>((resolve) => {
            setTimeout(() => {
              data.set(id, session);
              resolve();
            }, 50);
          });
        },
        destroy(id: string) {
          data.delete(id);
          return Promise.resolve();
        },
      };

      const app = express();
      app.use(session({ secret: TEST_SECRET, storage: asyncStore as any }));
      app.get('/set', (req, res) => {
        req.session.count = ((req.session.count as number) ?? 0) + 1;
        res.json({ count: req.session.count });
      });

      const agent = request.agent(app);
      const first = await agent.get('/set');
      expect(first.body.count).toBe(1);

      const second = await agent.get('/set');
      expect(second.body.count).toBe(2);
    });
  });

  describe('store error handling', () => {
    it('forwards store.get errors to Express error handler', async () => {
      const app = express();
      const failingStore = {
        get() {
          throw new Error('connection refused');
        },
        set() {},
        destroy() {},
      };
      app.use(session({ secret: TEST_SECRET, storage: failingStore as any }));
      app.get('/test', (_req, res) => res.json({ ok: true }));
      app.use((err: any, _req: any, res: any, _next: any) => {
        res.status(500).json({ error: err.message });
      });

      const signedId = sign('some-id', TEST_SECRET);
      const res = await request(app).get('/test').set('Cookie', `sid=s:${signedId}`);
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('connection refused');
    });

    it('works normally when store.get succeeds', async () => {
      const { app } = createApp();
      const res = await request(app).get('/set');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
    });

    it('still completes response when async store.set rejects', async () => {
      const data = new Map<string, any>();
      const store = {
        get(id: string) {
          return data.get(id) ?? null;
        },
        set() {
          return Promise.reject(new Error('write failed'));
        },
        destroy(id: string) {
          data.delete(id);
        },
      };

      const app = express();
      app.use(session({ secret: TEST_SECRET, storage: store as any }));
      app.get('/set', (req, res) => {
        req.session.count = 1;
        res.json({ count: req.session.count });
      });

      const res = await request(app).get('/set');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
    });

    it('still completes response when sync store.set throws', async () => {
      const data = new Map<string, any>();
      const store = {
        get(id: string) {
          return data.get(id) ?? null;
        },
        set() {
          throw new Error('write failed');
        },
        destroy(id: string) {
          data.delete(id);
        },
      };

      const app = express();
      app.use(session({ secret: TEST_SECRET, storage: store as any }));
      app.get('/set', (req, res) => {
        req.session.count = 1;
        res.json({ count: req.session.count });
      });

      const res = await request(app).get('/set');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
    });
  });
});
