/* eslint-disable @typescript-eslint/no-namespace */

import type { Session } from '../../core/session.js';

declare global {
  namespace Express {
    interface Request {
      session: Session;
    }
  }
}
