import type { Session, SessionData, StoredSession } from './types/index.js';

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
