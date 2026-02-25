import type { StoredSession } from '../core/session.js';

/**
 * Abstract base class for session storage backends.
 *
 * Extend this class to implement a custom storage (e.g. Redis, Postgres).
 * Provides {@link isExpired} and {@link touch} helpers out of the box.
 *
 * @example
 * ```ts
 * class RedisStorage extends Storage {
 *   async get(id: string) { ... }
 *   async set(id: string, session: StoredSession) { ... }
 *   async destroy(id: string) { ... }
 * }
 * ```
 */
export abstract class Storage {
  /** Retrieve a session by ID. Return `null` if not found. */
  abstract get(id: string): StoredSession | null | Promise<StoredSession | null>;

  /** Persist a session to storage. */
  abstract set(id: string, session: StoredSession): void | Promise<void>;

  /** Remove a session from storage. */
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
