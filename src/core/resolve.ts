import cookie from 'cookie';
import { unsign } from 'cookie-signature';
import { v7 as uuid7 } from 'uuid';
import { buildSetCookieHeader, buildClearCookieHeader } from './cookie.js';
import {
  createSession,
  extractSessionData,
  toStoredSession,
  type CookieOptions,
  type Session,
} from './session.js';
import type { Storage } from '../storage/storage.js';
import { MemoryStorage } from '../storage/memory.js';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Controls when the session ID is included in the response header.
 *
 * - `'never'` — Never set automatically.
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
  /** Session storage. Default: MemoryStorage */
  storage?: Storage;
  /** Re-set cookie on every response to refresh maxAge. Default: false */
  rolling?: boolean;
  /** Save session to the storage on every response, even if it was not modified. Default: false */
  resave?: boolean;
  /** Cookie options (defaults for new sessions) */
  cookie?: CookieOptions;
  /** Save new sessions that have no data written to them. Default: false */
  saveUninitialized?: boolean;
  /** Header-based session ID options */
  header?: HeaderOptions;
}

/** Resolved session result with finalize function. */
export interface SessionResult {
  /** The session object */
  session: Session;
  /** Whether this is a newly created session */
  isNew: boolean;
  /**
   * Finalize the session after the handler has run.
   * Computes response headers (Set-Cookie, session header) and saves to storage.
   * Must be called before sending the response.
   */
  finalize(): Promise<{ headers: [string, string][] }>;
}

/** @internal Resolved options with defaults applied. */
export interface ResolvedOptions {
  name: string;
  secret: string;
  storage: Storage;
  rolling: boolean;
  resave: boolean;
  saveUninitialized: boolean;
  headerName: string;
  headerPolicy: HeaderPolicy;
  cookieDefaults: CookieOptions | undefined;
}

// ── Functions ────────────────────────────────────────────────────────────────

/** @internal Apply defaults to session options. */
export function resolveOptions(options: SessionOptions): ResolvedOptions {
  return {
    name: options.name ?? 'sid',
    secret: options.secret,
    storage: options.storage ?? new MemoryStorage(),
    rolling: options.rolling ?? false,
    resave: options.resave ?? false,
    saveUninitialized: options.saveUninitialized ?? false,
    headerName: options.header?.name ?? 'X-Session',
    headerPolicy: options.header?.policy ?? 'never',
    cookieDefaults: options.cookie,
  };
}

/**
 * Resolve a session from a Web Standard {@link Request}.
 *
 * Framework-agnostic core. Returns the session and a `finalize()` function
 * that must be called to compute response headers and persist the session.
 */
export async function resolveSession(
  req: Request,
  options: SessionOptions | ResolvedOptions,
): Promise<SessionResult> {
  const opts =
    'secret' in options && 'storage' in options && 'rolling' in options
      ? (options as ResolvedOptions)
      : resolveOptions(options);

  const {
    name,
    secret,
    storage,
    rolling,
    resave,
    saveUninitialized,
    headerName,
    headerPolicy,
    cookieDefaults,
  } = opts;

  let sessionId: string | null = null;
  let existingSession = null;

  // Resolve from cookie
  const cookieHeader = req.headers.get('cookie');
  const rawCookies = cookieHeader ? cookie.parse(cookieHeader) : {};
  const cookieVal = rawCookies[name];

  if (cookieVal && cookieVal.startsWith('s:')) {
    const unsigned = unsign(cookieVal.slice(2), secret);
    if (unsigned !== false) {
      existingSession = await storage.get(unsigned);
      if (existingSession) sessionId = unsigned;
    }
  }

  // Resolve from header
  const headerVal = req.headers.get(headerName);
  if (!sessionId && headerVal) {
    const unsigned = unsign(headerVal, secret);
    if (unsigned !== false) {
      existingSession = await storage.get(unsigned);
      if (existingSession) sessionId = unsigned;
    }
  }

  const isNew = sessionId == null;
  sessionId = sessionId ?? uuid7();

  const result = createSession({
    sessionId,
    existingSession,
    cookieDefaults,
    secret,
    storage,
  });

  const snapshot = isNew ? null : JSON.stringify(extractSessionData(result.sess));

  return {
    session: result.sess,
    isNew,
    async finalize(): Promise<{ headers: [string, string][] }> {
      const headers: [string, string][] = [];

      if (result.destroyed) {
        headers.push(['Set-Cookie', buildClearCookieHeader(name, result.sess.cookie)]);
        return { headers };
      }

      if (isNew || rolling || result.regenerated) {
        if ((rolling || result.regenerated) && result.sess.cookie.originalMaxAge != null) {
          result.sess.cookie.expires = new Date(
            Date.now() + result.sess.cookie.originalMaxAge * 1000,
          );
        }
        headers.push([
          'Set-Cookie',
          buildSetCookieHeader(name, result.sess.id, result.sess.cookie, secret),
        ]);
      }

      const shouldSetHeader =
        headerPolicy === 'always' || (headerPolicy === 'init' && (isNew || result.regenerated));
      if (shouldSetHeader) {
        headers.push([headerName, result.sess.signedId]);
      }

      const shouldSave = !(
        (!saveUninitialized &&
          isNew &&
          Object.keys(extractSessionData(result.sess)).length === 0) ||
        (!resave &&
          !isNew &&
          !result.regenerated &&
          JSON.stringify(extractSessionData(result.sess)) === snapshot)
      );

      if (shouldSave) {
        await storage.set(result.sess.id, toStoredSession(result.sess));
      }

      return { headers };
    },
  };
}
