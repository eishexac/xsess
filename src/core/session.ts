import type { SerializeOptions } from 'cookie';
import { sign } from 'cookie-signature';
import { v7 as uuid7 } from 'uuid';
import { buildCookie } from './cookie.js';
import type { Storage } from '../storage/storage.js';

// ── Types ────────────────────────────────────────────────────────────────────

/** Cookie options for session cookies (re-exported from the `cookie` package). */
export type CookieOptions = SerializeOptions;

/** User-defined session data. Add properties directly to the session. */
export interface SessionData {
  [key: string]: unknown;
}

/** Cookie configuration for a session, extending {@link CookieOptions}. */
export interface SessionCookie extends CookieOptions {
  /** Original maxAge value set at creation */
  originalMaxAge: number | null;
}

/**
 * The session object attached to the request.
 *
 * Stores arbitrary data alongside session metadata and lifecycle methods.
 */
export interface Session extends SessionData {
  /** Session ID */
  id: string;
  /** Cookie options for this session (can be modified per-session) */
  cookie: SessionCookie;
  /** Session ID signed with the server secret */
  readonly signedId: string;
  /** Persist session to storage */
  save(callback?: (err?: Error) => void): Promise<void>;
  /** Remove session from storage and clear cookie */
  destroy(callback?: (err?: Error) => void): Promise<void>;
  /** Generate a new session ID, preserving data */
  regenerate(callback?: (err?: Error) => void): Promise<void>;
}

/** The serialized session format persisted to the storage. */
export interface StoredSession {
  data: SessionData;
  cookie: SessionCookie;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const INTERNAL_KEYS = new Set(['id', 'signedId', 'cookie', 'save', 'destroy', 'regenerate']);

/** Extract user data from a session, stripping internal keys (id, cookie, methods). */
export function extractSessionData(sess: Session): SessionData {
  const data: SessionData = {};
  for (const key of Object.keys(sess)) {
    if (!INTERNAL_KEYS.has(key)) {
      data[key] = sess[key];
    }
  }
  return data;
}

/** Convert a live {@link Session} to a {@link StoredSession} for persistence. */
export function toStoredSession(sess: Session): StoredSession {
  return { data: extractSessionData(sess), cookie: sess.cookie };
}

// ── Factory ──────────────────────────────────────────────────────────────────

/** @internal Parameters for {@link createSession}. */
export interface CreateSessionParams {
  sessionId: string;
  existingSession: StoredSession | null;
  cookieDefaults: CookieOptions | undefined;
  secret: string;
  storage: Storage;
}

/**
 * Build a {@link Session} object with save, destroy, and regenerate methods.
 *
 * @returns The session and state getters that reflect live state.
 * @internal
 */
export function createSession(params: CreateSessionParams): {
  sess: Session;
  destroyed: boolean;
  regenerated: boolean;
} {
  const { sessionId, existingSession, cookieDefaults, secret, storage } = params;

  const sessionCookie: SessionCookie = existingSession
    ? { ...existingSession.cookie }
    : buildCookie(cookieDefaults);

  let destroyed = false;
  let regenerated = false;

  const sess: Session = {
    id: sessionId,
    get signedId() {
      return sign(sess.id, secret);
    },
    cookie: sessionCookie,

    ...(existingSession ? existingSession.data : {}),

    async save(callback?: (err?: Error) => void): Promise<void> {
      try {
        if (!destroyed) {
          await storage.set(sess.id, toStoredSession(sess));
        }
        callback?.();
      } catch (err) {
        if (callback) callback(err as Error);
        else throw err;
      }
    },

    async destroy(callback?: (err?: Error) => void): Promise<void> {
      try {
        destroyed = true;
        await storage.destroy(sess.id);
        callback?.();
      } catch (err) {
        if (callback) callback(err as Error);
        else throw err;
      }
    },

    async regenerate(callback?: (err?: Error) => void): Promise<void> {
      try {
        await storage.destroy(sess.id);
        sess.id = uuid7();
        destroyed = false;
        regenerated = true;
        callback?.();
      } catch (err) {
        if (callback) callback(err as Error);
        else throw err;
      }
    },
  };

  return {
    sess,
    get destroyed() {
      return destroyed;
    },
    get regenerated() {
      return regenerated;
    },
  };
}
