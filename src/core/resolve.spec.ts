/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect } from 'vitest';
import { sign } from 'cookie-signature';
import cookie from 'cookie';
import { resolveSession, resolveOptions } from './resolve.js';
import { MemoryStorage } from '../storage/memory.js';

const SECRET = 'test-secret';

function makeRequest(
  opts: { cookies?: Record<string, string>; headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers();
  if (opts.cookies && Object.keys(opts.cookies).length > 0) {
    headers.set(
      'cookie',
      Object.entries(opts.cookies)
        .map(([k, v]) => cookie.serialize(k, v))
        .join('; '),
    );
  }
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) {
      headers.set(k, v);
    }
  }
  return new Request('http://localhost/', { headers });
}

describe('resolveOptions', () => {
  it('applies defaults', () => {
    const opts = resolveOptions({ secret: SECRET });
    expect(opts.name).toBe('sid');
    expect(opts.rolling).toBe(false);
    expect(opts.resave).toBe(false);
    expect(opts.saveUninitialized).toBe(false);
    expect(opts.headerName).toBe('X-Session');
    expect(opts.headerPolicy).toBe('never');
    expect(opts.storage).toBeInstanceOf(MemoryStorage);
  });
});

describe('resolveSession', () => {
  it('creates a new session when no cookie or header', async () => {
    const req = makeRequest();
    const { session, isNew } = await resolveSession(req, { secret: SECRET });
    expect(isNew).toBe(true);
    expect(session.id).toBeDefined();
  });

  it('resolves existing session from signed cookie', async () => {
    const storage = new MemoryStorage();
    const opts = { secret: SECRET, storage };

    // Create and save a session first
    const req1 = makeRequest();
    const result1 = await resolveSession(req1, opts);
    result1.session.userId = 42;
    await result1.session.save();
    const { headers } = await result1.finalize();

    // Extract the Set-Cookie value
    const setCookieHeader = headers.find(([k]) => k === 'Set-Cookie')![1];
    const parsed = cookie.parse(setCookieHeader);
    const sidValue = parsed['sid']!;

    // Make a new request with that cookie
    const req2 = makeRequest({ cookies: { sid: sidValue } });
    const result2 = await resolveSession(req2, opts);
    expect(result2.isNew).toBe(false);
    expect(result2.session.userId).toBe(42);
  });

  it('resolves existing session from signed header', async () => {
    const storage = new MemoryStorage();
    const opts = { secret: SECRET, storage };

    const req1 = makeRequest();
    const result1 = await resolveSession(req1, opts);
    result1.session.role = 'admin';
    await result1.session.save();

    const signedId = sign(result1.session.id, SECRET);
    const req2 = makeRequest({ headers: { 'X-Session': signedId } });
    const result2 = await resolveSession(req2, opts);
    expect(result2.isNew).toBe(false);
    expect(result2.session.role).toBe('admin');
  });

  it('ignores invalid cookie signature', async () => {
    const req = makeRequest({ cookies: { sid: 's:invalid.signature' } });
    const { isNew } = await resolveSession(req, { secret: SECRET });
    expect(isNew).toBe(true);
  });

  it('ignores invalid header signature', async () => {
    const req = makeRequest({ headers: { 'X-Session': 'invalid' } });
    const { isNew } = await resolveSession(req, { secret: SECRET });
    expect(isNew).toBe(true);
  });

  it('falls back to header when cookie signature is invalid', async () => {
    const storage = new MemoryStorage();
    const opts = { secret: SECRET, storage };

    const req1 = makeRequest();
    const result1 = await resolveSession(req1, opts);
    result1.session.count = 5;
    await result1.session.save();

    const signedId = sign(result1.session.id, SECRET);
    const req2 = makeRequest({
      cookies: { sid: 's:bad.signature' },
      headers: { 'X-Session': signedId },
    });
    const result2 = await resolveSession(req2, opts);
    expect(result2.isNew).toBe(false);
    expect(result2.session.count).toBe(5);
  });

  it('resolves storage from a factory', async () => {
    const storage = new MemoryStorage();
    const opts = { secret: SECRET, storage: () => storage };

    const req1 = makeRequest();
    const result1 = await resolveSession(req1, opts);
    result1.session.userId = 11;
    await result1.session.save();

    const signedId = sign(result1.session.id, SECRET);
    const req2 = makeRequest({ headers: { 'X-Session': signedId } });
    const result2 = await resolveSession(req2, opts);
    expect(result2.isNew).toBe(false);
    expect(result2.session.userId).toBe(11);
  });

  it('invokes the storage factory once when options are reused (memoized)', async () => {
    const storage = new MemoryStorage();
    let calls = 0;
    const opts = resolveOptions({
      secret: SECRET,
      storage: () => {
        calls++;
        return storage;
      },
    });

    await (await resolveSession(makeRequest(), opts)).finalize();
    await (await resolveSession(makeRequest(), opts)).finalize();
    expect(calls).toBe(1);
  });

  describe('finalize', () => {
    it('returns Set-Cookie header for new session', async () => {
      const req = makeRequest();
      const { finalize } = await resolveSession(req, {
        secret: SECRET,
        saveUninitialized: true,
      });
      const { headers } = await finalize();
      const setCookie = headers.find(([k]) => k === 'Set-Cookie');
      expect(setCookie).toBeDefined();
      expect(setCookie![1]).toContain('sid=s%3A');
    });

    it('returns session header when policy is init', async () => {
      const req = makeRequest();
      const { finalize } = await resolveSession(req, {
        secret: SECRET,
        saveUninitialized: true,
        header: { policy: 'init' },
      });
      const { headers } = await finalize();
      const sessionHeader = headers.find(([k]) => k === 'X-Session');
      expect(sessionHeader).toBeDefined();
    });

    it('does not return session header when policy is never', async () => {
      const req = makeRequest();
      const { finalize } = await resolveSession(req, {
        secret: SECRET,
        saveUninitialized: true,
        header: { policy: 'never' },
      });
      const { headers } = await finalize();
      const sessionHeader = headers.find(([k]) => k === 'X-Session');
      expect(sessionHeader).toBeUndefined();
    });

    it('does not return Set-Cookie for empty new session when saveUninitialized is false', async () => {
      const req = makeRequest();
      const { finalize } = await resolveSession(req, {
        secret: SECRET,
        saveUninitialized: false,
      });
      const { headers } = await finalize();
      expect(headers.find(([k]) => k === 'Set-Cookie')).toBeUndefined();
    });

    it('returns Set-Cookie for new session with data when saveUninitialized is false', async () => {
      const req = makeRequest();
      const { session, finalize } = await resolveSession(req, {
        secret: SECRET,
        saveUninitialized: false,
      });
      session.userId = 1;
      const { headers } = await finalize();
      expect(headers.find(([k]) => k === 'Set-Cookie')).toBeDefined();
    });

    it('does not return init header for empty new session when saveUninitialized is false', async () => {
      const req = makeRequest();
      const { finalize } = await resolveSession(req, {
        secret: SECRET,
        saveUninitialized: false,
        header: { policy: 'init' },
      });
      const { headers } = await finalize();
      expect(headers.find(([k]) => k === 'X-Session')).toBeUndefined();
    });

    it('does not save empty new session when saveUninitialized is false', async () => {
      const storage = new MemoryStorage();
      const req = makeRequest();
      const { session, finalize } = await resolveSession(req, {
        secret: SECRET,
        storage,
        saveUninitialized: false,
      });
      await finalize();
      expect(storage.get(session.id)).toBeNull();
    });

    it('saves new session with data when saveUninitialized is false', async () => {
      const storage = new MemoryStorage();
      const req = makeRequest();
      const { session, finalize } = await resolveSession(req, {
        secret: SECRET,
        storage,
        saveUninitialized: false,
      });
      session.userId = 1;
      await finalize();
      expect(storage.get(session.id)).not.toBeNull();
    });

    it('returns clear cookie header after destroy', async () => {
      const req = makeRequest();
      const { session, finalize } = await resolveSession(req, { secret: SECRET });
      await session.destroy();
      const { headers } = await finalize();
      const setCookie = headers.find(([k]) => k === 'Set-Cookie');
      expect(setCookie).toBeDefined();
      expect(setCookie![1]).toContain('Expires=Thu, 01 Jan 1970');
    });

    it('does not resave unmodified existing session when resave is false', async () => {
      const storage = new MemoryStorage();
      const opts = { secret: SECRET, storage, resave: false };

      const req1 = makeRequest();
      const result1 = await resolveSession(req1, opts);
      result1.session.x = 1;
      await result1.session.save();
      await result1.finalize();

      // Resolve again and finalize without modifying
      const signedId = sign(result1.session.id, SECRET);
      const req2 = makeRequest({ headers: { 'X-Session': signedId } });
      const setSpy = storage.set.bind(storage);
      let setCalled = false;
      storage.set = (...args: [string, any]) => {
        setCalled = true;
        return setSpy(...args);
      };
      const result2 = await resolveSession(req2, opts);
      await result2.finalize();
      expect(setCalled).toBe(false);
    });
  });
});
