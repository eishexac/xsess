import type { StoredSession } from './session.js';

/**
 * Interface for session store implementations.
 *
 * All methods may return synchronously or as a `Promise`.
 * Prefer extending the {@link Store} base class which provides
 * `isExpired()` and `touch()` helpers.
 */
export interface SessionStore {
  /** Retrieve a session by ID. Return `null` if not found. */
  get(id: string): StoredSession | null | Promise<StoredSession | null>;

  /** Persist a session to the store. */
  set(id: string, session: StoredSession): void | Promise<void>;

  /** Remove a session from the store. */
  destroy(id: string): void | Promise<void>;
}
