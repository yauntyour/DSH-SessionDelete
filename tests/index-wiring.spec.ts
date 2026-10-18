/**
 * Wiring regression test for the plugin entry (src/index.ts).
 *
 * Why this file exists: the first shipped wiring listed a service named
 * `webRuntime` in `inject`. That name exists nowhere in DSH — the real
 * service is `webStartup` (WEB_STARTUP_SERVICE in @deepseek-ai/dsh-web-app).
 * Cordis cannot resolve an unknown inject entry, so the plugin entry stayed
 * pending forever, apply() never ran, and the /session-delete/api route was
 * never registered; POSTs then fell through to the static fallback, which
 * answers every non-GET request with 405. These tests pin every link of the
 * fix:
 *
 *  1. `inject` lists only services that really exist in the web composition,
 *  2. apply() registers the prefix route with only those services present,
 *  3. the trusted authorities are read lazily from `webStartup` via ctx.get,
 *     so the service being absent cannot break activation while the fence
 *     still admits loopback and refuses an untrusted authority.
 */
import { describe, expect, it } from 'vitest'
import { apply, inject, name, ROUTE_PREFIX } from '../src/index.ts'
import type {
  Context,
  SessionDeleteHttpRequest,
  SessionDeleteHttpResponse,
  SessionDeleteWebRoute,
} from '../src/context-types.ts'

/** The services that really exist in the DSH web composition. */
const REAL_SERVICES = [
  'webServer',
  'sessions',
  'sessionPersistence',
  'workspaceRegistry',
  'storageDomain',
] as const

interface Harness {
  ctx: Context
  routes: SessionDeleteWebRoute[]
}

/**
 * Minimal fake ctx providing ONLY real DSH services, mirroring the live
 * composition. `webStartup` is absent unless a test opts in, so any direct
 * (non-lazy) read of it would throw here exactly as the old wiring did in
 * production.
 */
function makeHarness(options: { webStartup?: { trustedHosts?: readonly string[] } } = {}): Harness {
  const routes: SessionDeleteWebRoute[] = []
  const services: Record<string, unknown> = {
    webServer: {
      register(route: SessionDeleteWebRoute): () => void {
        routes.push(route)
        return () => {}
      },
    },
    sessions: {
      get: () => undefined,
      liveEntryFor: () => undefined,
      detachEntered: () => {},
      flush: async () => false,
    },
    sessionPersistence: {
      locate: () => undefined,
      list: async () => [],
      root: 'C:/sessions',
    },
    workspaceRegistry: { list: () => [] },
    storageDomain: { get: () => undefined },
  }
  if (options.webStartup !== undefined) services.webStartup = options.webStartup
  const ctx = {
    // apply() registers through ctx.effect; run it now, like the real store.
    effect: (fn: () => unknown): void => { void fn() },
    get: (serviceName: string): unknown => services[serviceName],
    emit: () => {},
    logger: { warn: () => {} },
    ...services,
  } as unknown as Context
  return { ctx, routes }
}

/** One POST /session-delete/api/delete request carrying a JSON body. */
function makeRequest(
  body: string,
  headers: Record<string, string> = { host: '127.0.0.1:63253', 'content-type': 'application/json' },
): SessionDeleteHttpRequest {
  const chunks = body === '' ? [] : [Buffer.from(body, 'utf8')]
  return {
    url: `${ROUTE_PREFIX}/delete`,
    method: 'POST',
    headers,
    async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      for (const chunk of chunks) yield chunk
    },
  }
}

/** A response recorder capturing status and body. */
function makeResponse(): { res: SessionDeleteHttpResponse; state: { status: number; body: string } } {
  const state = { status: 0, body: '' }
  const res: SessionDeleteHttpResponse = {
    statusCode: 0,
    writeHead(status: number): void { state.status = status },
    end(body?: string | Uint8Array): void {
      state.body = typeof body === 'string' ? body : Buffer.from(body ?? '').toString('utf8')
    },
  }
  return { res, state }
}

describe('plugin wiring (src/index.ts)', () => {
  it('injects only services that exist in the DSH web composition', () => {
    expect(name).toBe('dsh-session-delete')
    expect([...inject]).toEqual([...REAL_SERVICES])
    // The old wiring named this non-existent service: cordis then left the
    // entry pending, apply() never ran and no route was registered.
    expect([...inject]).not.toContain('webRuntime')
    // webStartup must stay lazy, never a required inject.
    expect([...inject]).not.toContain('webStartup')
  })

  it('registers the /session-delete/api prefix route with no webStartup service present', () => {
    const { ctx, routes } = makeHarness()
    expect(() => apply(ctx)).not.toThrow()
    expect(routes).toHaveLength(1)
    expect(routes[0].kind).toBe('prefix')
    expect(routes[0].path).toBe(ROUTE_PREFIX)
    expect(routes[0].path).toBe('/session-delete/api')
  })

  it('serves a loopback POST /session-delete/api/delete with no webStartup service present', async () => {
    const { ctx, routes } = makeHarness()
    apply(ctx)
    const { res, state } = makeResponse()
    await routes[0].handler(makeRequest(JSON.stringify({ sessionId: 'session-ghost' })), res)
    expect(state.status).toBe(200)
    expect(JSON.parse(state.body)).toEqual({
      ok: true,
      value: { sessionId: 'session-ghost', removedPaths: [], wasLive: false, wasPersisted: false },
    })
  })

  it('admits the authority a lazily-read webStartup.trustedHosts names', async () => {
    const { ctx, routes } = makeHarness({ webStartup: { trustedHosts: ['desk.example:8443'] } })
    apply(ctx)
    const { res, state } = makeResponse()
    await routes[0].handler(
      makeRequest(JSON.stringify({ sessionId: 'session-ghost' }), {
        host: 'desk.example:8443',
        'content-type': 'application/json',
      }),
      res,
    )
    expect(state.status).toBe(200)
  })

  it('refuses an untrusted non-loopback authority with no webStartup service present', async () => {
    const { ctx, routes } = makeHarness()
    apply(ctx)
    const { res, state } = makeResponse()
    await routes[0].handler(
      makeRequest(JSON.stringify({ sessionId: 'session-ghost' }), {
        host: 'evil.example',
        'content-type': 'application/json',
      }),
      res,
    )
    expect(state.status).toBe(403)
  })
})
