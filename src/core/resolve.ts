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
  type StoredSession,
} from './session.js';
import type { Storage, StorageFactory } from '../storage/storage.js';
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
  /** Session storage, or a factory that lazily provides one. Default: MemoryStorage */
  storage?: Storage | StorageFactory;
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
  storage: Storage | StorageFactory;
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

/** @internal Headers source accepted by the header-based resolvers. */
type HeadersInput = Headers | Record<string, string | string[] | undefined>;

/** @internal Read a single header value, case-insensitively, from either source. */
function getHeader(headers: HeadersInput, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) {
      const value = headers[key];
      if (value == null) return null;
      return Array.isArray(value) ? value.join('; ') : value;
    }
  }
  return null;
}

/** @internal Coerce raw or already-resolved options to {@link ResolvedOptions}. */
function asResolved(options: SessionOptions | ResolvedOptions): ResolvedOptions {
  return 'secret' in options && 'storage' in options && 'rolling' in options
    ? (options as ResolvedOptions)
    : resolveOptions(options);
}

const storageMemo = new WeakMap<ResolvedOptions, Promise<Storage>>();

/** @internal Resolve the storage, invoking and memoizing a factory if given. */
function getStorage(opts: ResolvedOptions): Promise<Storage> {
  if (typeof opts.storage !== 'function') return Promise.resolve(opts.storage);
  let memo = storageMemo.get(opts);
  if (!memo) {
    memo = Promise.resolve(opts.storage());
    storageMemo.set(opts, memo);
  }
  return memo;
}

/**
 * @internal Look up an existing session from the cookie first, then the header.
 * Returns the matched ID and its stored session, or nulls when none is found.
 */
async function resolveExisting(
  headers: HeadersInput,
  opts: ResolvedOptions,
  storage: Storage,
): Promise<{ sessionId: string | null; existingSession: StoredSession | null }> {
  const { name, secret, headerName } = opts;

  let sessionId: string | null = null;
  let existingSession: StoredSession | null = null;

  const cookieHeader = getHeader(headers, 'cookie');
  const rawCookies = cookieHeader ? cookie.parse(cookieHeader) : {};
  const cookieVal = rawCookies[name];

  if (cookieVal && cookieVal.startsWith('s:')) {
    const unsigned = unsign(cookieVal.slice(2), secret);
    if (unsigned !== false) {
      existingSession = await storage.get(unsigned);
      if (existingSession) sessionId = unsigned;
    }
  }

  const headerVal = getHeader(headers, headerName);
  if (!sessionId && headerVal) {
    const unsigned = unsign(headerVal, secret);
    if (unsigned !== false) {
      existingSession = await storage.get(unsigned);
      if (existingSession) sessionId = unsigned;
    }
  }

  return { sessionId, existingSession };
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
  const opts = asResolved(options);
  const storage = await getStorage(opts);

  const {
    name,
    secret,
    rolling,
    resave,
    saveUninitialized,
    headerName,
    headerPolicy,
    cookieDefaults,
  } = opts;

  const { sessionId: resolvedId, existingSession } = await resolveExisting(
    req.headers,
    opts,
    storage,
  );
  const isNew = resolvedId == null;
  const sessionId = resolvedId ?? uuid7();

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

      const shouldSave = !(
        (!saveUninitialized &&
          isNew &&
          Object.keys(extractSessionData(result.sess)).length === 0) ||
        (!resave &&
          !isNew &&
          !result.regenerated &&
          JSON.stringify(extractSessionData(result.sess)) === snapshot)
      );

      const establishingNew = isNew && shouldSave;

      if (establishingNew || (!isNew && (rolling || result.regenerated))) {
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
        headerPolicy === 'always' ||
        (headerPolicy === 'init' && (establishingNew || result.regenerated));
      if (shouldSetHeader) {
        headers.push([headerName, result.sess.signedId]);
      }

      if (shouldSave) {
        await storage.set(result.sess.id, toStoredSession(result.sess));
      }

      return { headers };
    },
  };
}

/**
 * @internal Resolve an existing session directly from request headers (cookie
 * first, then header). Read-only: never mints a new session, writes a cookie, or
 * persists. Returns `null` when no valid session is found.
 *
 * Backs adapters where there is no response to finalize, such as a WebSocket
 * handshake.
 */
export async function resolveSessionFromHeaders(
  headers: HeadersInput,
  options: SessionOptions | ResolvedOptions,
): Promise<Session | null> {
  const opts = asResolved(options);
  const storage = await getStorage(opts);
  const { sessionId, existingSession } = await resolveExisting(headers, opts, storage);

  if (sessionId == null || existingSession == null) return null;

  const { sess } = createSession({
    sessionId,
    existingSession,
    cookieDefaults: opts.cookieDefaults,
    secret: opts.secret,
    storage,
  });

  return sess;
}
