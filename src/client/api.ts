/**
 * Typed fetch wrapper over the /session-delete JSON API. One method:
 * POST /session-delete/api/delete { sessionId }. Failures surface as
 * {@link SessionDeleteApiError} with the wire code.
 */

/** One wire failure. */
export class SessionDeleteApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** The successful deletion response. */
export interface SessionDeleteResult {
  sessionId: string
  removedPaths: string[]
  wasLive: boolean
  wasPersisted: boolean
}

async function call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/session-delete/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    throw new SessionDeleteApiError('network', error instanceof Error ? error.message : String(error))
  }
  const parsed: { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } } =
    await response.json().catch(() => ({}))
  if (parsed.ok !== true) {
    const code = parsed.error?.code ?? 'unknown'
    const message = parsed.error?.message ?? `HTTP ${response.status}`
    throw new SessionDeleteApiError(code, message)
  }
  return parsed.value as T
}

/** Delete one session permanently. */
export function deleteSession(sessionId: string): Promise<SessionDeleteResult> {
  return call('delete', { sessionId })
}
