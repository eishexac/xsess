# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.5] - 2026-02-25

### Added

- **Multi-framework support** — xsess is now framework-agnostic with a Web Standard core
- **Hono middleware** via `xsess/hono` with typed `c.get('session')` support
- **`resolveSession()`** — framework-agnostic core function using Web Standard `Request`/`Response`, enabling integration with any framework (Elysia, SvelteKit, etc.)
- Hono `ContextVariableMap` type augmentation for `session`
- Hono e2e test suite (31 tests)
- Core `resolveSession` unit tests (14 tests)
- Cookie utility unit tests (22 tests)

### Changed

- **Breaking:** Import paths changed — use `xsess/express` for Express middleware, `xsess/hono` for Hono middleware
- **Breaking:** `store` option renamed to `storage`
- **Breaking:** `Store` base class renamed to `Storage` (import from `xsess`)
- **Breaking:** `CookieOptions` now uses the `cookie` package's `SerializeOptions` type — `maxAge` is now in **seconds** (was milliseconds)
- Express and Hono are now optional peer dependencies
- `CookieOptions` type sourced from the `cookie` package instead of Express
- Express `Request.session` augmentation now scoped to `xsess/express` import

### Removed

- Root `session()` export — use `xsess/express` or `xsess/hono` instead
- `MemoryStore` / `MemoryStorage` is no longer exported (internal only, used as default)
- `SessionStore` interface — use the `Storage` abstract class instead
- Express `CookieOptions` dependency

## [0.0.4] - 2026-02-08

### Added

- Session middleware with cookie and header-based session ID support
- Configurable `header.policy` option (`'never'` | `'init'` | `'always'`) for controlling response header behavior
- `Store` abstract base class with `isExpired()` and `touch()` helpers
- `MemoryStore` as default in-memory store for development
- Session methods: `save()`, `destroy()`, `regenerate()` with promise and callback support
- Rolling sessions support to refresh cookie expiry on each response
- `resave` option to control whether unmodified sessions are saved on every response (default: `false`). Uses snapshot comparison to detect modifications
- `saveUninitialized` option to control whether empty new sessions are persisted (default: `false`)
- Session save via `res.end()` interception — ensures data is persisted before the response reaches the client, preventing stale reads on sequential requests
- Cookie and response header are updated after `regenerate()` so clients receive the new session ID
- Store errors during session resolution are forwarded to Express error handling via `next(err)`
- Express `Request.session` type augmentation
- Full test suite (unit + e2e) with 100% coverage
