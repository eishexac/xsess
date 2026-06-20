import { describe, it, expect } from 'vitest';
import {
  extractSessionData,
  toStoredSession,
  type Session,
  type SessionCookie,
} from './session.js';

function makeCookie(): SessionCookie {
  return { path: '/', httpOnly: true, sameSite: 'lax', secure: false, originalMaxAge: null };
}

function makeSession(data: Record<string, unknown> = {}): Session {
  const cookie = makeCookie();
  return {
    id: 'test-id',
    signedId: 'signed-test-id',
    cookie,
    ...data,
    save: async () => {},
    destroy: async () => {},
    regenerate: async () => {},
  };
}

describe('extractSessionData', () => {
  it('strips internal keys', () => {
    const sess = makeSession({ userId: 42, role: 'admin' });
    const data = extractSessionData(sess);
    expect(data).toEqual({ userId: 42, role: 'admin' });
    expect(data).not.toHaveProperty('id');
    expect(data).not.toHaveProperty('signedId');
    expect(data).not.toHaveProperty('cookie');
    expect(data).not.toHaveProperty('save');
    expect(data).not.toHaveProperty('destroy');
    expect(data).not.toHaveProperty('regenerate');
  });

  it('returns empty object when session has no user data', () => {
    const sess = makeSession();
    expect(extractSessionData(sess)).toEqual({});
  });
});

describe('toStoredSession', () => {
  it('returns data and cookie', () => {
    const sess = makeSession({ count: 5 });
    const stored = toStoredSession(sess);
    expect(stored.data).toEqual({ count: 5 });
    expect(stored.cookie).toBe(sess.cookie);
  });
});
