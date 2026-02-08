import type { SessionStore, StoredSession } from '../types/index.js';

/**
 * Abstract base class for session stores.
 *
 * Extend this class to implement a custom store (e.g. Redis, Postgres).
 * Provides {@link isExpired} and {@link touch} helpers out of the box.
 *
 * @example
 * ```ts
 * class RedisStore extends Store {
 *   async get(id: string) { ... }
 *   async set(id: string, session: StoredSession) { ... }
 *   async destroy(id: string) { ... }
 * }
 * ```
 */
export abstract class Store implements SessionStore {
  /** Retrieve a session by ID. Return `null` if not found. */
  abstract get(id: string): StoredSession | null | Promise<StoredSession | null>;

  /** Persist a session to the store. */
  abstract set(id: string, session: StoredSession): void | Promise<void>;

  /** Remove a session from the store. */
  abstract destroy(id: string): void | Promise<void>;

  /** Check if a session has expired based on its cookie */
  protected isExpired(session: StoredSession): boolean {
    return session.cookie.expires != null && new Date(session.cookie.expires) <= new Date();
  }

  /** Update session expiry without rewriting data. Default: re-sets the full session. */
  protected touch(id: string, session: StoredSession): void | Promise<void> {
    return this.set(id, session);
  }
}
