import type { Context } from './context-types.ts';
/** Plugin identity for cordis.yml rows. */
export declare const name = "dsh-session-delete";
/** Services required before mounting. */
export declare const inject: readonly ["webServer", "webRuntime", "sessions", "sessionPersistence", "workspaceRegistry", "storageDomain"];
/** The /session-delete route prefix (client half fetches under it). */
export declare const ROUTE_PREFIX = "/session-delete/api";
/**
 * Plugin body: register the fenced delete route.
 * @param ctx - the host cordis context.
 */
export declare function apply(ctx: Context): void;
/** Re-export the core types for tests and diagnostics. */
export { deleteSessionRecord, encodeSegment, assertSessionDir, scanSessionRoot } from './delete-session.ts';
