import { describe, it, expect } from 'vitest';
import { MemoryStorage } from './memory.js';
import type { StoredSession } from '../core/session.js';

function makeStored(overrides?: Partial<StoredSession['cookie']>): StoredSession {
  return {
    data: { userId: 1 },
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      originalMaxAge: null,
      ...overrides,
    },
  };
}

describe('MemoryStorage', () => {
  it('stores and retrieves a session', () => {
    const storage = new MemoryStorage();
    const session = makeStored();
    storage.set('abc', session);
    expect(storage.get('abc')).toEqual(session);
  });

  it('returns null for unknown id', () => {
    const storage = new MemoryStorage();
    expect(storage.get('nonexistent')).toBeNull();
  });

  it('destroys a session', () => {
    const storage = new MemoryStorage();
    storage.set('abc', makeStored());
    storage.destroy('abc');
    expect(storage.get('abc')).toBeNull();
  });

  it('returns null and cleans up expired sessions', () => {
    const storage = new MemoryStorage();
    const expired = makeStored({ expires: new Date(Date.now() - 1000) });
    storage.set('old', expired);
    expect(storage.get('old')).toBeNull();
  });

  it('returns session when not yet expired', () => {
    const storage = new MemoryStorage();
    const valid = makeStored({ expires: new Date(Date.now() + 60_000) });
    storage.set('fresh', valid);
    expect(storage.get('fresh')).toEqual(valid);
  });
});
