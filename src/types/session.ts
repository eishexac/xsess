import type { CookieOptions } from 'express';

/** User-defined session data. Add properties directly to `req.session`. */
export interface SessionData {
  [key: string]: unknown;
}

/** Cookie configuration for a session, extending Express `CookieOptions`. */
export interface SessionCookie extends CookieOptions {
  /** Original maxAge value set at creation */
  originalMaxAge: number | null;
}

/**
 * The session object attached to `req.session`.
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
  /** Persist session to store */
  save(callback?: (err?: Error) => void): Promise<void>;
  /** Remove session from store and clear cookie */
  destroy(callback?: (err?: Error) => void): Promise<void>;
  /** Generate a new session ID, preserving data */
  regenerate(callback?: (err?: Error) => void): Promise<void>;
}

/** The serialized session format persisted to the store. */
export interface StoredSession {
  data: SessionData;
  cookie: SessionCookie;
}
