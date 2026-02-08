import type { CookieOptions } from 'express';
import type { SessionStore } from './store.js';

/**
 * Controls when the session ID is included in the response header.
 *
 * - `'never'` — Never set automatically. Set it manually (e.g. on login).
 * - `'init'` — Only when a new session is created.
 * - `'always'` — On every response.
 */
export type HeaderPolicy = 'never' | 'init' | 'always';

/** Configuration for header-based session ID transport. */
export interface HeaderOptions {
  /** Header name to read/write session ID. Default: 'X-Session' */
  name?: string;
  /** When to include the session ID in the response header. Default: 'never' */
  policy?: HeaderPolicy;
}

/** Configuration options for the session middleware. */
export interface SessionOptions {
  /** Cookie name. Default: 'sid' */
  name?: string;
  /** Secret for signing session IDs */
  secret: string;
  /** Session store. Default: MemoryStore */
  store?: SessionStore;
  /** Re-set cookie on every response to refresh maxAge. Default: false */
  rolling?: boolean;
  /** Save session to the store on every response, even if it was not modified. Default: false */
  resave?: boolean;
  /** Cookie options (defaults for new sessions) */
  cookie?: CookieOptions;
  /** Save new sessions that have no data written to them. Default: false */
  saveUninitialized?: boolean;
  /** Header-based session ID options */
  header?: HeaderOptions;
}
