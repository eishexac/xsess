// noinspection ES6UnusedImports

import type {} from 'hono'; // required so ts picks up hono typedefs
import type { Session } from '../../core/session.js';

declare module 'hono' {
  interface ContextVariableMap {
    session: Session;
  }
}
