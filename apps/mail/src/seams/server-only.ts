/**
 * `server-only` does nothing here.
 *
 * That package exists to stop Next from bundling a server module into a client
 * one. This product is one bundle with no server half, so the guard has nothing
 * to guard. A server host keeps it, and the marker stays in the source.
 */
export {};
