import { describe, it, expect, vi } from 'vitest';
import { buildCookie, serializeCookie, setSessionCookie, clearSessionCookie } from './cookie.js';
import type { SessionCookie } from './types/index.js';

describe('buildCookie', () => {
  it('returns sensible defaults when no options provided', () => {
    const cookie = buildCookie(undefined);
    expect(cookie.path).toBe('/');
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('lax');
    expect(cookie.secure).toBe(false);
    expect(cookie.originalMaxAge).toBeNull();
    expect(cookie.expires).toBeUndefined();
  });

  it('sets expires from maxAge', () => {
    vi.useFakeTimers({ now: new Date('2025-01-01T00:00:00Z') });
    const cookie = buildCookie({ maxAge: 60_000 });
    expect(cookie.originalMaxAge).toBe(60_000);
    expect(cookie.expires).toEqual(new Date('2025-01-01T00:01:00Z'));
    vi.useRealTimers();
  });

  it('allows overriding defaults', () => {
    const cookie = buildCookie({ secure: true, httpOnly: false, path: '/api' });
    expect(cookie.secure).toBe(true);
    expect(cookie.httpOnly).toBe(false);
    expect(cookie.path).toBe('/api');
  });
});

describe('serializeCookie', () => {
  it('serializes with session cookie attributes', () => {
    const result = serializeCookie('sid', 'test-value', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      originalMaxAge: null,
    });
    expect(result).toContain('sid=test-value');
    expect(result).toContain('Path=/');
    expect(result).toContain('HttpOnly');
    expect(result).toContain('SameSite=Lax');
  });

  it('includes maxAge in seconds', () => {
    const result = serializeCookie('sid', 'val', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      originalMaxAge: 60_000,
    });
    expect(result).toContain('Max-Age=60');
  });
});

function mockRes() {
  const headers = new Map<string, string | string[]>();
  return {
    getHeader: (name: string) => headers.get(name),
    setHeader: (name: string, value: string | string[]) => headers.set(name, value),
    _headers: headers,
  } as any;
}

const baseCookie: SessionCookie = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: false,
  originalMaxAge: null,
};

describe('setSessionCookie', () => {
  it('sets signed cookie on response', () => {
    const res = mockRes();
    setSessionCookie(res, 'sid', 'test-id', baseCookie, 'secret');
    const cookie = res._headers.get('Set-Cookie') as string;
    expect(cookie).toContain('sid=s%3A');
    expect(cookie).toContain('HttpOnly');
  });

  it('appends to existing string Set-Cookie header', () => {
    const res = mockRes();
    res.setHeader('Set-Cookie', 'other=value');
    setSessionCookie(res, 'sid', 'test-id', baseCookie, 'secret');
    const cookies = res._headers.get('Set-Cookie') as string[];
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toBe('other=value');
    expect(cookies[1]).toContain('sid=s%3A');
  });

  it('appends to existing array Set-Cookie header', () => {
    const res = mockRes();
    res.setHeader('Set-Cookie', ['a=1', 'b=2']);
    setSessionCookie(res, 'sid', 'test-id', baseCookie, 'secret');
    const cookies = res._headers.get('Set-Cookie') as string[];
    expect(cookies).toHaveLength(3);
    expect(cookies[2]).toContain('sid=s%3A');
  });
});

describe('clearSessionCookie', () => {
  it('sets expired cookie to clear it', () => {
    const res = mockRes();
    clearSessionCookie(res, 'sid', baseCookie);
    const cookie = res._headers.get('Set-Cookie') as string;
    expect(cookie).toContain('sid=');
    expect(cookie).toContain('Expires=Thu, 01 Jan 1970');
  });
});
