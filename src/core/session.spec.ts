import { describe, it, expect, vi } from 'vitest';
import { createSession, type StoredSession } from './session.js';
import { MemoryStorage } from '../storage/memory.js';
import { Storage } from '../storage/storage.js';

class FailingStorage extends Storage {
  get(): StoredSession | null {
    return null;
  }
  set(): void {
    throw new Error('store write failed');
  }
  destroy(): void {
    throw new Error('store destroy failed');
  }
}

function makeCookie() {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: false,
    originalMaxAge: null,
  };
}

describe('createSession', () => {
  it('creates a new session with given id', () => {
    const { sess } = createSession({
      sessionId: 'test-id',
      existingSession: null,
      cookieDefaults: undefined,
      secret: 'secret',
      storage: new MemoryStorage(),
    });

    expect(sess.id).toBe('test-id');
    expect(sess.cookie.path).toBe('/');
    expect(sess.cookie.httpOnly).toBe(true);
  });

  it('restores data from existing session', () => {
    const existing: StoredSession = {
      data: { userId: 42, role: 'admin' },
      cookie: makeCookie(),
    };

    const { sess } = createSession({
      sessionId: 'test-id',
      existingSession: existing,
      cookieDefaults: undefined,
      secret: 'secret',
      storage: new MemoryStorage(),
    });

    expect(sess.userId).toBe(42);
    expect(sess.role).toBe('admin');
  });

  it('computes signedId from secret', () => {
    const { sess } = createSession({
      sessionId: 'test-id',
      existingSession: null,
      cookieDefaults: undefined,
      secret: 'my-secret',
      storage: new MemoryStorage(),
    });

    expect(sess.signedId).toBeDefined();
    expect(sess.signedId).not.toBe('test-id');
  });

  describe('save', () => {
    it('persists session to store', async () => {
      const storage = new MemoryStorage();
      const { sess } = createSession({
        sessionId: 'test-id',
        existingSession: null,
        cookieDefaults: undefined,
        secret: 'secret',
        storage,
      });

      sess.username = 'alice';
      await sess.save();
      const stored = storage.get('test-id');
      expect(stored?.data.username).toBe('alice');
    });

    it('does not persist after destroy', async () => {
      const storage = new MemoryStorage();
      const { sess } = createSession({
        sessionId: 'test-id',
        existingSession: null,
        cookieDefaults: undefined,
        secret: 'secret',
        storage,
      });

      await sess.destroy();
      await sess.save();
      expect(storage.get('test-id')).toBeNull();
    });

    it('invokes callback on success', async () => {
      const callback = vi.fn();
      const { sess } = createSession({
        sessionId: 'test-id',
        existingSession: null,
        cookieDefaults: undefined,
        secret: 'secret',
        storage: new MemoryStorage(),
      });

      await sess.save(callback);
      expect(callback).toHaveBeenCalledWith();
    });
  });

  describe('destroy', () => {
    it('removes session from store', async () => {
      const storage = new MemoryStorage();
      const { sess } = createSession({
        sessionId: 'test-id',
        existingSession: null,
        cookieDefaults: undefined,
        secret: 'secret',
        storage,
      });

      await sess.save();
      await sess.destroy();
      expect(storage.get('test-id')).toBeNull();
    });

    it('sets destroyed flag', async () => {
      const result = createSession({
        sessionId: 'test-id',
        existingSession: null,
        cookieDefaults: undefined,
        secret: 'secret',
        storage: new MemoryStorage(),
      });

      expect(result.destroyed).toBe(false);
      await result.sess.destroy();
      expect(result.destroyed).toBe(true);
    });
  });

  describe('regenerate', () => {
    it('changes session id', async () => {
      const { sess } = createSession({
        sessionId: 'old-id',
        existingSession: null,
        cookieDefaults: undefined,
        secret: 'secret',
        storage: new MemoryStorage(),
      });

      await sess.regenerate();
      expect(sess.id).not.toBe('old-id');
    });

    it('destroys old session in store', async () => {
      const storage = new MemoryStorage();
      const { sess } = createSession({
        sessionId: 'old-id',
        existingSession: null,
        cookieDefaults: undefined,
        secret: 'secret',
        storage,
      });

      await sess.save();
      await sess.regenerate();
      expect(storage.get('old-id')).toBeNull();
    });

    it('resets destroyed flag', async () => {
      const result = createSession({
        sessionId: 'test-id',
        existingSession: null,
        cookieDefaults: undefined,
        secret: 'secret',
        storage: new MemoryStorage(),
      });

      await result.sess.destroy();
      expect(result.destroyed).toBe(true);
      await result.sess.regenerate();
      expect(result.destroyed).toBe(false);
    });

    it('sets regenerated flag', async () => {
      const result = createSession({
        sessionId: 'test-id',
        existingSession: null,
        cookieDefaults: undefined,
        secret: 'secret',
        storage: new MemoryStorage(),
      });

      expect(result.regenerated).toBe(false);
      await result.sess.regenerate();
      expect(result.regenerated).toBe(true);
    });
  });

  describe('error handling', () => {
    it('save passes error to callback when store throws', async () => {
      const callback = vi.fn();
      const { sess } = createSession({
        sessionId: 'test-id',
        existingSession: null,
        cookieDefaults: undefined,
        secret: 'secret',
        storage: new FailingStorage(),
      });

      await sess.save(callback);
      expect(callback).toHaveBeenCalledWith(expect.any(Error));
    });

    it('save throws when store fails and no callback', async () => {
      const { sess } = createSession({
        sessionId: 'test-id',
        existingSession: null,
        cookieDefaults: undefined,
        secret: 'secret',
        storage: new FailingStorage(),
      });

      await expect(sess.save()).rejects.toThrow('store write failed');
    });

    it('destroy passes error to callback when store throws', async () => {
      const callback = vi.fn();
      const { sess } = createSession({
        sessionId: 'test-id',
        existingSession: null,
        cookieDefaults: undefined,
        secret: 'secret',
        storage: new FailingStorage(),
      });

      await sess.destroy(callback);
      expect(callback).toHaveBeenCalledWith(expect.any(Error));
    });

    it('destroy throws when store fails and no callback', async () => {
      const { sess } = createSession({
        sessionId: 'test-id',
        existingSession: null,
        cookieDefaults: undefined,
        secret: 'secret',
        storage: new FailingStorage(),
      });

      await expect(sess.destroy()).rejects.toThrow('store destroy failed');
    });

    it('regenerate passes error to callback when store throws', async () => {
      const callback = vi.fn();
      const { sess } = createSession({
        sessionId: 'test-id',
        existingSession: null,
        cookieDefaults: undefined,
        secret: 'secret',
        storage: new FailingStorage(),
      });

      await sess.regenerate(callback);
      expect(callback).toHaveBeenCalledWith(expect.any(Error));
    });

    it('regenerate throws when store fails and no callback', async () => {
      const { sess } = createSession({
        sessionId: 'test-id',
        existingSession: null,
        cookieDefaults: undefined,
        secret: 'secret',
        storage: new FailingStorage(),
      });

      await expect(sess.regenerate()).rejects.toThrow('store destroy failed');
    });
  });
});
