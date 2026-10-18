import type { Context } from './context-types.ts';
/** Plugin identity for cordis.yml rows. */
export declare const name = "dsh-session-delete";
/**
 * Services required before mounting. Only services that really exist may be
 * listed: cordis keeps an entry whose inject cannot be resolved pending
 * forever, so apply() would never run and no route would ever be registered.
 * `webStartup` is deliberately NOT injected — it is read lazily in apply(),
 * because a missing or renamed optional service must not be able to leave
 * this entry pending.
 */
export declare const inject: readonly ["webServer", "sessions", "sessionPersistence", "workspaceRegistry", "storageDomain"];
/** The /session-delete route prefix (client half fetches under it). */
export declare const ROUTE_PREFIX = "/session-delete/api";
/**
 * Plugin body: register the fenced delete route.
 * @param ctx - the host cordis context.
 */
export declare function apply(ctx: Context): void;
/** Re-export the core types for tests and diagnostics. */
export { deleteSessionRecord, encodeSegment, assertSessionDir, scanSessionRoot } from './delete-session.ts';
