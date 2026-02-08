import { describe, it, expect } from 'vitest';
import { MemoryStore } from './memory.js';
import type { StoredSession } from '../types/index.js';

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

describe('MemoryStore', () => {
  it('stores and retrieves a session', () => {
    const store = new MemoryStore();
    const session = makeStored();
    store.set('abc', session);
    expect(store.get('abc')).toEqual(session);
  });

  it('returns null for unknown id', () => {
    const store = new MemoryStore();
    expect(store.get('nonexistent')).toBeNull();
  });

  it('destroys a session', () => {
    const store = new MemoryStore();
    store.set('abc', makeStored());
    store.destroy('abc');
    expect(store.get('abc')).toBeNull();
  });

  it('returns null and cleans up expired sessions', () => {
    const store = new MemoryStore();
    const expired = makeStored({ expires: new Date(Date.now() - 1000) });
    store.set('old', expired);
    expect(store.get('old')).toBeNull();
  });

  it('returns session when not yet expired', () => {
    const store = new MemoryStore();
    const valid = makeStored({ expires: new Date(Date.now() + 60_000) });
    store.set('fresh', valid);
    expect(store.get('fresh')).toEqual(valid);
  });
});
