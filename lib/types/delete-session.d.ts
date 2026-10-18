import { encodeSegment } from './encode-segment.ts';
export { encodeSegment };
/** The dependency seam the transaction needs (injected by src/index.ts; faked in tests). */
export interface DeleteSessionDeps {
    /** The live session for an id, or undefined. */
    liveSession(id: string): {
        id: string;
        header: {
            id: string;
            createdAt: number;
            cwd?: string;
        };
    } | undefined;
    /** Durably flush one live session (the store-owned flush). */
    flushSession(session: {
        id: string;
    }): Promise<void>;
    /** Detach one live session from the store (emits session/disposed). */
    detachSession(session: {
        id: string;
    }): void;
    /** Wait out the persistence write-behind window. */
    settle(): Promise<void>;
    /** The backend-computed session directory for a header, or undefined. */
    locateSessionDir(header: {
        id: string;
        createdAt: number;
        cwd?: string;
    }): string | undefined;
    /** Whether a directory exists (the transaction verifies the located dir). */
    dirExists(path: string): Promise<boolean>;
    /** Scan the persistence root for the session directory across project dirs. */
    scanSessionDir(id: string): Promise<string | undefined>;
    /** Remove a directory tree (recursive, force). */
    removeDir(path: string): Promise<void>;
    /** All persisted session headers. */
    listPersisted(): Promise<Array<{
        id: string;
        createdAt: number;
        cwd?: string;
    }>>;
    /** Drop the id from every workspace record and the archive set. */
    removeFromWorkspaces(id: string): Promise<void>;
    /** Drop the projection-cache row for the id (fail-soft). */
    removeFromProjectionCache(id: string): Promise<void>;
    /** Whether the session's agent is currently running. */
    isAgentRunning(id: string): boolean;
    /** Non-fatal diagnostic logging. */
    logWarn(message: string): void;
}
/** One completed deletion. */
export interface DeleteSessionResult {
    sessionId: string;
    /** The removed on-disk session directories (empty when none existed). */
    removedPaths: string[];
    /** Whether the session was live in the store. */
    wasLive: boolean;
    /** Whether the session had a persisted log. */
    wasPersisted: boolean;
}
/** Verify a candidate directory is exactly one session's owned directory. */
export declare function assertSessionDir(dir: string, sessionId: string): void;
/** Wait for a fixed wall-clock window (default 300ms). */
export declare function sleep(ms: number): Promise<void>;
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
export declare function scanSessionRoot(root: string, sessionId: string): Promise<string | undefined>;
/**
 * Run the deletion transaction for one session id.
 * @param deps - the injected seam.
 * @param sessionId - the session to delete.
 * @returns the transaction result.
 * @throws SessionDeleteError('bad-request') for a blank id.
 * @throws SessionDeleteError('agent-running') for a live session whose agent is still running.
 */
export declare function deleteSessionRecord(deps: DeleteSessionDeps, sessionId: string): Promise<DeleteSessionResult>;
