import type { Response } from 'express';
import { sign } from 'cookie-signature';
import { v7 as uuid7 } from 'uuid';
import { buildCookie, clearSessionCookie } from './cookie.js';
import { toStoredSession } from './utils.js';
import type {
  Session,
  SessionCookie,
  SessionOptions,
  SessionStore,
  StoredSession,
} from './types/index.js';

/** @internal Parameters for {@link createSession}. */
export interface CreateSessionParams {
  sessionId: string;
  existingSession: StoredSession | null;
  cookieDefaults: SessionOptions['cookie'];
  secret: string;
  store: SessionStore;
  res: Response;
  cookieName: string;
}

/**
 * Build a {@link Session} object with save, destroy, and regenerate methods.
 *
 * @returns The session and a `destroyed` getter that reflects live state.
 * @internal
 */
export function createSession(params: CreateSessionParams): {
  sess: Session;
  destroyed: boolean;
  regenerated: boolean;
} {
  const { sessionId, existingSession, cookieDefaults, secret, store, res, cookieName } = params;

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
          await store.set(sess.id, toStoredSession(sess));
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
        await store.destroy(sess.id);
        clearSessionCookie(res, cookieName, sess.cookie);
        callback?.();
      } catch (err) {
        if (callback) callback(err as Error);
        else throw err;
      }
    },

    async regenerate(callback?: (err?: Error) => void): Promise<void> {
      try {
        await store.destroy(sess.id);
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
