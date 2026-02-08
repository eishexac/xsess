// Side-effect: augments Express.Request with session property
import './types/express.augment.js';

export { session } from './middleware.js';
export { Store } from './stores/index.js';
export type { Session, SessionData, SessionCookie, StoredSession } from './types/index.js';
export type { SessionStore } from './types/index.js';
export type { SessionOptions, HeaderOptions, HeaderPolicy } from './types/index.js';
