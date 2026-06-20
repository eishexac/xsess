import type { Socket } from 'socket.io';
import { resolveSessionFromHeaders, resolveOptions } from '../../core/resolve.js';
import type { SessionOptions } from '../../core/resolve.js';
import type { Session } from '../../core/session.js';

/** Configuration for the socket.io session middleware. */
export interface SocketSessionOptions extends SessionOptions {
  /** Reject the connection when no valid session is found. Default: false */
  required?: boolean;
  /**
   * Key under `socket.handshake.auth` to read a signed session ID from, for
   * clients that cannot send cookies or headers (e.g. native apps).
   * Default: 'token'
   */
  authKey?: string;
}

/**
 * Creates a socket.io connection middleware that resolves the session from the
 * handshake and attaches it to `socket.data.session`.
 *
 * Resolves from the handshake cookie first, then the configured header, then a
 * token under `socket.handshake.auth`. Read-only — it never creates a session,
 * sets a cookie, or persists; use it to authenticate connections against
 * sessions established over HTTP. Call `socket.data.session.save()` to persist
 * explicit changes made during the connection.
 *
 * @param options - Session configuration
 * @returns A socket.io middleware for `io.use()` / `io.of(ns).use()`
 *
 * @example
 * ```ts
 * import { session, getSession } from 'xsess/socket.io';
 *
 * io.use(session({ secret: process.env.SESSION_SECRET!, required: true }));
 *
 * io.on('connection', (socket) => {
 *   const sess = getSession(socket);
 *   socket.emit('whoami', sess?.userId ?? null);
 * });
 * ```
 */
export function session(options: SocketSessionOptions) {
  const resolved = resolveOptions(options);
  const required = options.required ?? false;
  const authKey = options.authKey ?? 'token';

  return async (socket: Socket, next: (err?: Error) => void): Promise<void> => {
    try {
      const headers = handshakeHeaders(socket, resolved.headerName, authKey);
      const session = await resolveSessionFromHeaders(headers, resolved);

      (socket.data as { session: Session | null }).session = session;

      if (required && !session) {
        next(new Error('Unauthorized'));
        return;
      }

      next();
    } catch (err) {
      next(err as Error);
    }
  };
}

/** Returns the session attached by {@link session}, or `null`. */
export function getSession(socket: Socket): Session | null {
  return (socket.data as { session?: Session | null }).session ?? null;
}

/**
 * Merge the handshake headers with the `auth` token (mapped onto the session
 * header) so a single resolver call covers cookie, header, and token transports.
 */
function handshakeHeaders(
  socket: Socket,
  headerName: string,
  authKey: string,
): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = {
    ...socket.handshake.headers,
  };

  const token = (socket.handshake.auth as Record<string, unknown> | undefined)?.[authKey];
  const key = headerName.toLowerCase();
  if (typeof token === 'string' && headers[key] == null) {
    headers[key] = token;
  }

  return headers;
}
