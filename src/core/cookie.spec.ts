import { describe, it, expect, vi } from 'vitest';
import { buildCookie, serializeCookie, buildSetCookieHeader, buildClearCookieHeader } from './cookie.js';
import { unsign } from 'cookie-signature';
import cookie from 'cookie';
import type { SessionCookie } from './session.js';

function makeCookie(overrides?: Partial<SessionCookie>): SessionCookie {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    originalMaxAge: null,
    ...overrides,
  };
}

describe('buildCookie', () => {
  it('returns sensible defaults when no options provided', () => {
    const result = buildCookie(undefined);
    expect(result.path).toBe('/');
    expect(result.httpOnly).toBe(true);
    expect(result.sameSite).toBe('lax');
    expect(result.secure).toBe(false);
    expect(result.originalMaxAge).toBeNull();
    expect(result.expires).toBeUndefined();
  });

  it('preserves custom options', () => {
    const result = buildCookie({
      path: '/app',
      httpOnly: false,
      sameSite: 'strict',
      secure: true,
      domain: 'example.com',
    });
    expect(result.path).toBe('/app');
    expect(result.httpOnly).toBe(false);
    expect(result.sameSite).toBe('strict');
    expect(result.secure).toBe(true);
    expect(result.domain).toBe('example.com');
  });

  it('derives expires from maxAge (seconds)', () => {
    vi.useFakeTimers({ now: new Date('2025-01-01T00:00:00Z') });
    const result = buildCookie({ maxAge: 3600 });
    expect(result.originalMaxAge).toBe(3600);
    expect(result.expires).toEqual(new Date('2025-01-01T01:00:00Z'));
    vi.useRealTimers();
  });

  it('does not set expires when maxAge is not provided', () => {
    const result = buildCookie({});
    expect(result.originalMaxAge).toBeNull();
    expect(result.expires).toBeUndefined();
  });

  it('handles maxAge of 0', () => {
    const result = buildCookie({ maxAge: 0 });
    expect(result.originalMaxAge).toBe(0);
    // maxAge 0 is falsy so expires won't be derived
  });
});

describe('serializeCookie', () => {
  it('serializes basic cookie', () => {
    const result = serializeCookie('sid', 'value', makeCookie());
    const parsed = cookie.parse(result);
    expect(parsed['sid']).toBe('value');
    expect(result).toContain('HttpOnly');
    expect(result).toContain('Path=/');
    expect(result).toContain('SameSite=Lax');
  });

  it('includes domain when set', () => {
    const result = serializeCookie('sid', 'value', makeCookie({ domain: 'example.com' }));
    expect(result).toContain('Domain=example.com');
  });

  it('includes Secure flag', () => {
    const result = serializeCookie('sid', 'value', makeCookie({ secure: true }));
    expect(result).toContain('Secure');
  });

  it('includes expires as date', () => {
    const expires = new Date('2025-06-01T00:00:00Z');
    const result = serializeCookie('sid', 'value', makeCookie({ expires }));
    expect(result).toContain('Expires=');
  });

  it('includes Max-Age from originalMaxAge (converted to seconds)', () => {
    const result = serializeCookie('sid', 'value', makeCookie({ originalMaxAge: 3600 }));
    expect(result).toContain('Max-Age=3600');
  });

  it('omits Max-Age when originalMaxAge is null', () => {
    const result = serializeCookie('sid', 'value', makeCookie({ originalMaxAge: null }));
    expect(result).not.toContain('Max-Age');
  });

  it('handles sameSite strict', () => {
    const result = serializeCookie('sid', 'value', makeCookie({ sameSite: 'strict' }));
    expect(result).toContain('SameSite=Strict');
  });

  it('handles sameSite none', () => {
    const result = serializeCookie('sid', 'value', makeCookie({ sameSite: 'none' }));
    expect(result).toContain('SameSite=None');
  });
});

describe('buildSetCookieHeader', () => {
  it('returns a signed cookie value with s: prefix', () => {
    const result = buildSetCookieHeader('sid', 'test-id', makeCookie(), 'secret');
    const parsed = cookie.parse(result);
    const value = parsed['sid']!;
    expect(value).toMatch(/^s:/);
  });

  it('produces a value that can be unsigned', () => {
    const result = buildSetCookieHeader('sid', 'test-id', makeCookie(), 'secret');
    const parsed = cookie.parse(result);
    const value = parsed['sid']!;
    const unsigned = unsign(value.slice(2), 'secret');
    expect(unsigned).toBe('test-id');
  });

  it('signature fails with wrong secret', () => {
    const result = buildSetCookieHeader('sid', 'test-id', makeCookie(), 'secret');
    const parsed = cookie.parse(result);
    const value = parsed['sid']!;
    const unsigned = unsign(value.slice(2), 'wrong-secret');
    expect(unsigned).toBe(false);
  });

  it('includes cookie attributes', () => {
    const result = buildSetCookieHeader('sid', 'test-id', makeCookie({ secure: true }), 'secret');
    expect(result).toContain('Secure');
    expect(result).toContain('HttpOnly');
  });

  it('uses custom cookie name', () => {
    const result = buildSetCookieHeader('my_sess', 'test-id', makeCookie(), 'secret');
    expect(result).toMatch(/^my_sess=/);
  });
});

describe('buildClearCookieHeader', () => {
  it('sets expires to epoch', () => {
    const result = buildClearCookieHeader('sid', makeCookie());
    expect(result).toContain('Expires=Thu, 01 Jan 1970');
  });

  it('sets empty value', () => {
    const result = buildClearCookieHeader('sid', makeCookie());
    const parsed = cookie.parse(result);
    expect(parsed['sid']).toBe('');
  });

  it('preserves path and other attributes', () => {
    const result = buildClearCookieHeader('sid', makeCookie({ path: '/app', secure: true }));
    expect(result).toContain('Path=/app');
    expect(result).toContain('Secure');
  });

  it('does not include Max-Age', () => {
    const result = buildClearCookieHeader('sid', makeCookie({ originalMaxAge: 3600 }));
    expect(result).not.toContain('Max-Age');
  });
});
