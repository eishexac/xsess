import { describe, it, expect } from 'vitest';
import { sign } from 'cookie-signature';
import cookie from 'cookie';
import type { Socket } from 'socket.io';
import { session, getSession } from './socketio.js';
import { MemoryStorage } from '../../storage/memory.js';
import type { StoredSession } from '../../core/session.js';

const SECRET = 'test-secret';

function seedStorage(): { storage: MemoryStorage; id: string } {
  const storage = new MemoryStorage();
  const id = 'session-id-123';
  const stored: StoredSession = { data: { userId: 7 }, cookie: { originalMaxAge: null } };
  storage.set(id, stored);
  return { storage, id };
}

function fakeSocket(
  headers: Record<string, string | string[] | undefined> = {},
  auth: Record<string, unknown> = {},
): Socket {
  return { handshake: { headers, auth }, data: {} } as unknown as Socket;
}

function run(
  mw: (socket: Socket, next: (err?: Error) => void) => void | Promise<void>,
  socket: Socket,
): Promise<Error | undefined> {
  return new Promise((resolve) => {
    void mw(socket, (err?: Error) => resolve(err));
  });
}

function signedCookie(id: string, name = 'sid'): string {
  return cookie.serialize(name, 's:' + sign(id, SECRET));
}

describe('socket.io session middleware', () => {
  it('resolves the session from the handshake cookie', async () => {
    const { storage, id } = seedStorage();
    const mw = session({ secret: SECRET, storage });
    const socket = fakeSocket({ cookie: signedCookie(id) });

    const err = await run(mw, socket);

    expect(err).toBeUndefined();
    expect(getSession(socket)?.userId).toBe(7);
  });

  it('resolves the session from the X-Session header', async () => {
    const { storage, id } = seedStorage();
    const mw = session({ secret: SECRET, storage });
    const socket = fakeSocket({ 'x-session': sign(id, SECRET) });

    await run(mw, socket);

    expect(getSession(socket)?.userId).toBe(7);
  });

  it('resolves the session from a handshake auth token', async () => {
    const { storage, id } = seedStorage();
    const mw = session({ secret: SECRET, storage });
    const socket = fakeSocket({}, { token: sign(id, SECRET) });

    await run(mw, socket);

    expect(getSession(socket)?.userId).toBe(7);
  });

  it('supports a custom auth key', async () => {
    const { storage, id } = seedStorage();
    const mw = session({ secret: SECRET, storage, authKey: 'sid' });
    const socket = fakeSocket({}, { sid: sign(id, SECRET) });

    await run(mw, socket);

    expect(getSession(socket)?.userId).toBe(7);
  });

  it('prefers the cookie over the auth token', async () => {
    const { storage, id } = seedStorage();
    storage.set('other-id', { data: { userId: 99 }, cookie: { originalMaxAge: null } });
    const mw = session({ secret: SECRET, storage });
    const socket = fakeSocket({ cookie: signedCookie(id) }, { token: sign('other-id', SECRET) });

    await run(mw, socket);

    expect(getSession(socket)?.userId).toBe(7);
  });

  it('attaches null and calls next without error when no session is present', async () => {
    const { storage } = seedStorage();
    const mw = session({ secret: SECRET, storage });
    const socket = fakeSocket();

    const err = await run(mw, socket);

    expect(err).toBeUndefined();
    expect(getSession(socket)).toBeNull();
  });

  it('attaches null for an invalid signature', async () => {
    const { storage } = seedStorage();
    const mw = session({ secret: SECRET, storage });
    const socket = fakeSocket({ cookie: cookie.serialize('sid', 's:invalid.signature') });

    await run(mw, socket);

    expect(getSession(socket)).toBeNull();
  });

  it('rejects the connection when required and no session is present', async () => {
    const { storage } = seedStorage();
    const mw = session({ secret: SECRET, storage, required: true });
    const socket = fakeSocket();

    const err = await run(mw, socket);

    expect(err).toBeInstanceOf(Error);
    expect(getSession(socket)).toBeNull();
  });

  it('allows the connection when required and a session is present', async () => {
    const { storage, id } = seedStorage();
    const mw = session({ secret: SECRET, storage, required: true });
    const socket = fakeSocket({ cookie: signedCookie(id) });

    const err = await run(mw, socket);

    expect(err).toBeUndefined();
    expect(getSession(socket)?.userId).toBe(7);
  });

  it('honours a custom cookie name', async () => {
    const { storage, id } = seedStorage();
    const mw = session({ secret: SECRET, storage, name: '__sess' });
    const socket = fakeSocket({ cookie: signedCookie(id, '__sess') });

    await run(mw, socket);

    expect(getSession(socket)?.userId).toBe(7);
  });

  it('resolves the session when storage is a factory', async () => {
    const { storage, id } = seedStorage();
    const mw = session({ secret: SECRET, storage: () => storage });
    const socket = fakeSocket({ cookie: signedCookie(id) });

    await run(mw, socket);

    expect(getSession(socket)?.userId).toBe(7);
  });

  it('invokes the storage factory once across connections', async () => {
    const { storage, id } = seedStorage();
    let calls = 0;
    const mw = session({
      secret: SECRET,
      storage: () => {
        calls++;
        return storage;
      },
    });

    await run(mw, fakeSocket({ cookie: signedCookie(id) }));
    await run(mw, fakeSocket({ cookie: signedCookie(id) }));
    expect(calls).toBe(1);
  });

  it('getSession returns null when nothing was attached', () => {
    const socket = fakeSocket();
    expect(getSession(socket)).toBeNull();
  });
});
