# xsess

Framework-agnostic session middleware with cookie and header support — works seamlessly with Express, Hono, and any Web Standard framework.

Unlike `express-session`, xsess accepts session tokens from both cookies and the `X-Session` header, making it a drop-in choice for APIs consumed by browsers, mobile apps, and other HTTP clients.

## Install

```bash
pnpm add xsess
```

## Quick Start

### Express

```ts
import express from 'express';
import { session } from 'xsess/express';

const app = express();

app.use(
  session({
    secret: process.env.SESSION_SECRET!,
  }),
);

app.get('/', (req, res) => {
  req.session.views = ((req.session.views as number) ?? 0) + 1;
  res.json({ views: req.session.views });
});
```

### Hono

```ts
import { Hono } from 'hono';
import { session } from 'xsess/hono';

const app = new Hono();

app.use(session({ secret: process.env.SESSION_SECRET! }));

app.get('/', (c) => {
  const sess = c.get('session');
  sess.views = ((sess.views as number) ?? 0) + 1;
  return c.json({ views: sess.views });
});
```

## Options

```ts
session({
  // Cookie name (default: 'sid')
  name: 'sid',

  // Secret for signing session IDs (required)
  secret: 'my-secret',

  // Session storage (default: in-memory storage)
  storage: new MyCustomStorage(),

  // Re-set cookie on every response to refresh maxAge (default: false)
  rolling: false,

  // Save session to storage on every response, even if unmodified (default: false)
  resave: false,

  // Save new sessions with no data to storage (default: false)
  saveUninitialized: false,

  // Cookie options
  cookie: {
    maxAge: 86_400, // 1 day (in seconds)
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  },

  // Header-based session ID options
  header: {
    name: 'X-Session',   // Header name (default: 'X-Session')
    policy: 'init',       // When to send response header: 'never' | 'init' | 'always'
  },
});
```

### Header Policy

Controls when the session ID is included in the response header:

| Policy | Behavior |
|--------|----------|
| `'never'` | Never set response header automatically. Set it manually on login. **(default)** |
| `'init'` | Set response header when a new session is created or regenerated. |
| `'always'` | Set response header on every response. |

## Session API

```ts
// Read/write session data
session.userId = 42;

// Session ID
session.id;        // unsigned
session.signedId;  // signed with secret

// Cookie options (can be modified per-session)
session.cookie;

// Persist session to storage
await session.save();

// Destroy session and clear cookie
await session.destroy();

// Generate new session ID, preserving data
await session.regenerate();
```

All methods support both promises and callbacks:

```ts
await session.save();
session.save((err) => { /* ... */ });
```

## Custom Storage

Extend the `Storage` base class to implement a custom storage backend:

```ts
import { Storage } from 'xsess';
import type { StoredSession } from 'xsess';

class RedisStorage extends Storage {
  async get(id: string): Promise<StoredSession | null> {
    const data = await redis.get(`sess:${id}`);
    if (!data) return null;
    const session = JSON.parse(data) as StoredSession;
    if (this.isExpired(session)) return null;
    return session;
  }

  async set(id: string, session: StoredSession): Promise<void> {
    const ttl = session.cookie.originalMaxAge ?? 86400;
    await redis.set(`sess:${id}`, JSON.stringify(session), 'EX', ttl);
  }

  async destroy(id: string): Promise<void> {
    await redis.del(`sess:${id}`);
  }
}
```

The `Storage` base class provides:

- `isExpired(session)` — check if a session has expired based on its cookie
- `touch(id, session)` — update session expiry without rewriting data (defaults to calling `set`)

## How It Works

1. On each request, xsess looks for a session ID in the cookie first, then falls back to the request header.
2. If found and valid, the session is loaded from storage.
3. If not found, a new session is created with a UUID v7 ID.
4. Session data is saved when the response completes, ensuring sequential requests always see the latest state.
5. Cookies are set for new sessions (and on every response if `rolling` is enabled).
6. The response header is set based on the `header.policy` option.

## License

MIT
