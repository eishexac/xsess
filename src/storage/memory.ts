import type { StoredSession } from '../core/session.js';
import { Storage } from './storage.js';

export class MemoryStorage extends Storage {
  private sessions = new Map<string, StoredSession>();

  public get(id: string): StoredSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;

    if (this.isExpired(session)) {
      this.sessions.delete(id);
      return null;
    }

    return session;
  }

  public set(id: string, session: StoredSession): void {
    this.sessions.set(id, session);
  }

  public destroy(id: string): void {
    this.sessions.delete(id);
  }
}
