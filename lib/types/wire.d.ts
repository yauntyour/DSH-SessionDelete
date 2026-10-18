/**
 * Wire helpers for the /session-delete JSON API: bounded body reading,
 * response writing, and the shared error envelope. Every API method returns
 * `{ok: true, value}` on success and `{ok: false, error: {code, message}}`
 * on failure.
 */
import type { SessionDeleteHttpRequest, SessionDeleteHttpResponse } from './context-types.ts';
/** Machine-readable error codes of the session-delete API. */
export type SessionDeleteErrorCode = 'bad-request' | 'not-found' | 'forbidden' | 'method-error' | 'delete-error' | 'agent-running' | 'internal';
/** One API failure with its wire code and HTTP status. */
export declare class SessionDeleteError extends Error {
    readonly code: SessionDeleteErrorCode;
    readonly status: number;
    constructor(code: SessionDeleteErrorCode, message: string, status?: number);
}
/** Read and parse the JSON request body (bounded; malformed → bad-request). */
export declare function readJsonBody(req: SessionDeleteHttpRequest): Promise<unknown>;
/** Write a JSON response with the given status. */
export declare function writeJson(res: SessionDeleteHttpResponse, status: number, body: unknown): void;
/** Write the success envelope. */
export declare function writeOk(res: SessionDeleteHttpResponse, value: unknown): void;
/** Write the failure envelope for any thrown value (unknown → internal 500). */
export declare function writeError(res: SessionDeleteHttpResponse, error: unknown): void;
/** Narrow an unknown payload value to a non-blank string, else throw bad-request. */
export declare function requireString(payload: unknown, key: string): string;
