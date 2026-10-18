/**
 * The session-deletion transaction. Deleting a session is deliberately NOT
 * a single file removal: the harness keeps the session log, the workspace
 * accounting (workspace.sessionIds + the global archivedSessionIds), the
 * projection cache and the live store entry in sync, and the web client
 * learns about every change through the host wire pushes that these domain
 * writes emit (host/session-removed, host/workspace-changed,
 * host/archived-sessions-changed) — no page reload needed.
 *
 * Order matters:
 * 1. refuse a live session whose agent is still running (a running turn
 *    would keep appending and could recreate the removed directory);
 * 2. flush the live session (the store-owned flush), then detach it — the
 *    coordinator's session/disposed retire path drains the write-behind
 *    batch, so no late batch can recreate the directory after removal;
 * 3. wait out the coordinator's batching window (writeBatchMaxDelayMs,
 *    default 200ms) so the drain lands;
 * 4. resolve the session's owned directory twice: the backend-computed
 *    location (sessionPersistence.locate) first, then a project-directory
 *    scan under the persistence root — sessions are stored per workspace
 *    (`<root>/<workspace-key>/<encoded-id>`), and the scan still finds
 *    them when the stored header carries no cwd (or a cwd that no longer
 *    matches). Both agree, or one of them wins when the other is absent;
 *    a disagreement aborts loudly;
 * 5. remove the session directory (verified against the encoded id);
 * 6. drop the id from every workspace record via the registry's sanctioned
 *    detachSession write path, and from the archive set via the domain
 *    global — each durable write emits domain/changed, which the host
 *    api-proxy forwards as host/workspace-changed /
 *    host/archived-sessions-changed;
 * 7. drop the projection-cache row (fail-soft).
 *
 * Everything except the file removal is idempotent, and the file removal
 * itself is guarded by the path verification, so re-running the transaction
 * for an already-deleted session is safe.
 */
import { readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { encodeSegment } from "./encode-segment.js";
import { SessionDeleteError } from "./wire.js";
// Re-exported here so consumers (tests, diagnostics) import one module.
export { encodeSegment };
/** Verify a candidate directory is exactly one session's owned directory. */
export function assertSessionDir(dir, sessionId) {
    if (basename(resolve(dir)) !== encodeSegment(sessionId)) {
        throw new SessionDeleteError('delete-error', `refusing to delete non-session directory "${dir}"`);
    }
}
/** Wait for a fixed wall-clock window (default 300ms). */
export function sleep(ms) {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
/**
 * Scan one persistence root for a session's owned directory. Sessions are
 * stored per workspace: `<root>/<workspace-key>/<encoded-id>`. The scan
 * finds the directory even when the stored header carries no cwd (or a cwd
 * that no longer resolves), which the backend's locate cannot.
 * @param root - the persistence backend's configured session root.
 * @param sessionId - the session id (encoded before filesystem use).
 * @returns the existing session directory, or undefined when none exists.
 * @throws SessionDeleteError('delete-error') when the id appears in multiple
 *   project directories (mirrors the backend's duplicate-id refusal).
 */
export async function scanSessionRoot(root, sessionId) {
    const encoded = encodeSegment(sessionId);
    let entries;
    try {
        entries = await readdir(root, { withFileTypes: true });
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
    const matches = [];
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const candidate = join(root, entry.name, encoded);
        try {
            if ((await stat(candidate)).isDirectory())
                matches.push(candidate);
        }
        catch (error) {
            /* v8 ignore next -- a non-ENOENT stat failure is an external I/O fault. */
            if (error.code !== 'ENOENT')
                throw error;
        }
    }
    if (matches.length > 1) {
        throw new SessionDeleteError('delete-error', `session "${sessionId}" appears in multiple project directories (${matches.join(', ')})`);
    }
    return matches[0];
}
/**
 * Run the deletion transaction for one session id.
 * @param deps - the injected seam.
 * @param sessionId - the session to delete.
 * @returns the transaction result.
 * @throws SessionDeleteError('bad-request') for a blank id.
 * @throws SessionDeleteError('agent-running') for a live session whose agent is still running.
 */
export async function deleteSessionRecord(deps, sessionId) {
    const id = sessionId.trim();
    if (id === '') {
        throw new SessionDeleteError('bad-request', 'sessionId is required');
    }
    // 1. Resolve the session: live store first, then persisted listing.
    const live = deps.liveSession(id);
    if (live !== undefined && deps.isAgentRunning(id)) {
        throw new SessionDeleteError('agent-running', `session "${id}" has a running agent — wait for it to finish before deleting`);
    }
    let persistedHeaders = [];
    if (live === undefined) {
        try {
            persistedHeaders = await deps.listPersisted();
        }
        catch (error) {
            // A poisoned listing (e.g. one unrelated artifact whose header cwd no
            // longer matches its physical location) must not block the deletion:
            // the directory scan below still finds the session by id.
            deps.logWarn(`persistence listing failed (${String(error)}); falling back to the directory scan`);
        }
    }
    const header = live?.header ?? persistedHeaders.find((candidate) => candidate.id === id);
    const wasLive = live !== undefined;
    const wasPersisted = header !== undefined;
    // 2. Flush and detach a live session BEFORE touching the files: the
    //    coordinator's session/disposed retire path drains the write-behind
    //    batch, and the settle window lets that drain land so no late batch
    //    recreates the removed directory.
    if (live !== undefined) {
        await deps.flushSession(live);
        deps.detachSession(live);
    }
    if (wasLive || wasPersisted)
        await deps.settle();
    // 3. Resolve the owned directory: backend-computed location first, then
    //    the project-directory scan. Both are verified against the encoded id.
    const located = header !== undefined ? deps.locateSessionDir(header) : undefined;
    let locatedVerified;
    if (located !== undefined) {
        assertSessionDir(located, id);
        if (await deps.dirExists(located))
            locatedVerified = located;
    }
    const scanned = await deps.scanSessionDir(id);
    if (locatedVerified !== undefined && scanned !== undefined && resolve(locatedVerified) !== resolve(scanned)) {
        throw new SessionDeleteError('delete-error', `session "${id}" resolves to multiple directories (${locatedVerified} and ${scanned})`);
    }
    const removedPaths = [];
    const target = locatedVerified ?? scanned;
    if (target !== undefined) {
        await deps.removeDir(target);
        removedPaths.push(target);
    }
    // 4. Drop the id from every workspace record and the archive set.
    await deps.removeFromWorkspaces(id);
    // 5. Drop the projection-cache row (fail-soft).
    await deps.removeFromProjectionCache(id);
    return { sessionId: id, removedPaths, wasLive, wasPersisted };
}
