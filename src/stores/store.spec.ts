import { describe, it, expect, vi } from 'vitest';
import { Store } from './store.js';
import type { StoredSession } from '../types/index.js';

class TestStore extends Store {
  public data = new Map<string, StoredSession>();

  get(id: string) {
    return this.data.get(id) ?? null;
  }

  set(id: string, session: StoredSession) {
    this.data.set(id, session);
  }

  destroy(id: string) {
    this.data.delete(id);
  }

  // Expose protected methods for testing
  public testIsExpired(session: StoredSession) {
    return this.isExpired(session);
  }

  public testTouch(id: string, session: StoredSession) {
    return this.touch(id, session);
  }
}

function makeStored(expires?: Date): StoredSession {
  return {
    data: {},
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      originalMaxAge: null,
      ...(expires ? { expires } : {}),
    },
  };
}

describe('Store', () => {
  describe('isExpired', () => {
    it('returns false when no expiry is set', () => {
      const store = new TestStore();
      expect(store.testIsExpired(makeStored())).toBe(false);
    });

    it('returns false for future expiry', () => {
      const store = new TestStore();
      expect(store.testIsExpired(makeStored(new Date(Date.now() + 60_000)))).toBe(false);
    });

    it('returns true for past expiry', () => {
      const store = new TestStore();
      expect(store.testIsExpired(makeStored(new Date(Date.now() - 1000)))).toBe(true);
    });

    it('returns true when expiry is exactly now', () => {
      vi.useFakeTimers({ now: new Date('2025-01-01T00:00:00Z') });
      const store = new TestStore();
      expect(store.testIsExpired(makeStored(new Date('2025-01-01T00:00:00Z')))).toBe(true);
      vi.useRealTimers();
    });
  });

  describe('touch', () => {
    it('delegates to set by default', async () => {
      const store = new TestStore();
      const session = makeStored();
      await store.testTouch('abc', session);
      expect(store.data.get('abc')).toBe(session);
    });
  });
});
