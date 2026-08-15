/**
 * Wire helpers for the /session-delete JSON API: bounded body reading,
 * response writing, and the shared error envelope. Every API method returns
 * `{ok: true, value}` on success and `{ok: false, error: {code, message}}`
 * on failure.
 */
import type { SessionDeleteHttpRequest, SessionDeleteHttpResponse } from './context-types.ts'

/** Machine-readable error codes of the session-delete API. */
export type SessionDeleteErrorCode =
  | 'bad-request'
  | 'not-found'
  | 'forbidden'
  | 'method-error'
  | 'delete-error'
  | 'agent-running'
  | 'internal'

/** One API failure with its wire code and HTTP status. */
export class SessionDeleteError extends Error {
  constructor(
    readonly code: SessionDeleteErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

/** Body size bound of one JSON request (defense against unbounded reads). */
const MAX_BODY_BYTES = 1 << 20

/** Read and parse the JSON request body (bounded; malformed → bad-request). */
export async function readJsonBody(req: SessionDeleteHttpRequest): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    // The structural request yields string | Uint8Array; Buffer.from accepts
    // both (and the real runtime chunks are node Buffers anyway).
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) {
      throw new SessionDeleteError('bad-request', 'request body too large')
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new SessionDeleteError('bad-request', 'request body is not valid JSON')
  }
}

/** Write a JSON response with the given status. */
export function writeJson(res: SessionDeleteHttpResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

/** Write the success envelope. */
export function writeOk(res: SessionDeleteHttpResponse, value: unknown): void {
  writeJson(res, 200, { ok: true, value })
}

/** Write the failure envelope for any thrown value (unknown → internal 500). */
export function writeError(res: SessionDeleteHttpResponse, error: unknown): void {
  if (error instanceof SessionDeleteError) {
    writeJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  writeJson(res, 500, { ok: false, error: { code: 'internal', message } })
}

/** Narrow an unknown payload value to a non-blank string, else throw bad-request. */
export function requireString(payload: unknown, key: string): string {
  const record = payload as Record<string, unknown> | null
  const value = record?.[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SessionDeleteError('bad-request', `missing or invalid "${key}"`)
  }
  return value.trim()
}
