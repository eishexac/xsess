import { describe, it, expect, vi } from 'vitest';
import { Storage } from './storage.js';
import type { StoredSession } from '../core/session.js';

class TestStorage extends Storage {
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

describe('Storage', () => {
  describe('isExpired', () => {
    it('returns false when no expiry is set', () => {
      const storage = new TestStorage();
      expect(storage.testIsExpired(makeStored())).toBe(false);
    });

    it('returns false for future expiry', () => {
      const storage = new TestStorage();
      expect(storage.testIsExpired(makeStored(new Date(Date.now() + 60_000)))).toBe(false);
    });

    it('returns true for past expiry', () => {
      const storage = new TestStorage();
      expect(storage.testIsExpired(makeStored(new Date(Date.now() - 1000)))).toBe(true);
    });

    it('returns true when expiry is exactly now', () => {
      vi.useFakeTimers({ now: new Date('2025-01-01T00:00:00Z') });
      const storage = new TestStorage();
      expect(storage.testIsExpired(makeStored(new Date('2025-01-01T00:00:00Z')))).toBe(true);
      vi.useRealTimers();
    });
  });

  describe('touch', () => {
    it('delegates to set by default', async () => {
      const storage = new TestStorage();
      const session = makeStored();
      await storage.testTouch('abc', session);
      expect(storage.data.get('abc')).toBe(session);
    });
  });
});
