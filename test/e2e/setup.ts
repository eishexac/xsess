import express from 'express';
import { session } from '../../src/middleware/express/express.js';
import { MemoryStorage } from '../../src/storage/memory.js';
import type { SessionOptions } from '../../src/core/resolve.js';

export const TEST_SECRET = 'test-secret';

export function createApp(overrides?: Partial<SessionOptions>) {
  const app = express();
  const storage = new MemoryStorage();

  app.use(
    session({
      secret: TEST_SECRET,
      storage,
      ...overrides,
    }),
  );

  app.get('/set', (req, res) => {
    req.session.count = ((req.session.count as number) ?? 0) + 1;
    res.json({ count: req.session.count });
  });

  app.get('/get', (req, res) => {
    res.json({ count: req.session.count ?? 0 });
  });

  app.post('/destroy', (req, res) => {
    void req.session.destroy().then(() => {
      res.json({ destroyed: true });
    });
  });

  app.get('/noop', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/regenerate', (req, res) => {
    const oldId = req.session.id;
    void req.session.regenerate().then(() => {
      res.json({ oldId, newId: req.session.id });
    });
  });

  return { app, storage };
}
