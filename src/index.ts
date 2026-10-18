/**
 * dsh-session-delete host half: the /session-delete JSON API. One route —
 * POST /session-delete/api/delete { sessionId } — runs the deletion
 * transaction (see delete-session.ts) behind the same browser-trust fence
 * as the /api gateway (loopback Host, plus the boot-sampled trusted
 * authorities the optional `webStartup` service carries — read lazily, see
 * apply), because this route permanently removes real session data.
 */
import { stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { rm } from 'node:fs/promises'
import type {
  Context,
  SessionDeleteAgents,
  SessionDeleteDomain,
  SessionDeleteHttpRequest,
  SessionDeleteHttpResponse,
  SessionDeleteLiveSession,
  SessionDeleteWebStartup,
  SessionDeleteWorkspaceState,
} from './context-types.ts'
import { isTrustedApiRequest } from './trust-fence.ts'
import { readJsonBody, requireString, SessionDeleteError, writeError, writeJson, writeOk } from './wire.ts'
import {
  deleteSessionRecord,
  scanSessionRoot,
  sleep,
  type DeleteSessionDeps,
  type DeleteSessionResult,
} from './delete-session.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-session-delete'

/**
 * Services required before mounting. Only services that really exist may be
 * listed: cordis keeps an entry whose inject cannot be resolved pending
 * forever, so apply() would never run and no route would ever be registered.
 * `webStartup` is deliberately NOT injected — it is read lazily in apply(),
 * because a missing or renamed optional service must not be able to leave
 * this entry pending.
 */
export const inject = [
  'webServer',
  'sessions',
  'sessionPersistence',
  'workspaceRegistry',
  'storageDomain',
] as const

/** The /session-delete route prefix (client half fetches under it). */
export const ROUTE_PREFIX = '/session-delete/api'

/**
 * Plugin body: register the fenced delete route.
 * @param ctx - the host cordis context.
 */
export function apply(ctx: Context): void {
  // Read the trusted authorities lazily through ctx.get: the webStartup
  // service is optional here (absent in a bare composition, and inject must
  // not name it), and its absence simply means no extra trusted authority —
  // the fence still admits only loopback + same-origin.
  const trustedHosts = (): readonly string[] =>
    (ctx.get('webStartup') as SessionDeleteWebStartup | undefined)?.trustedHosts ?? []

  const fence = (req: SessionDeleteHttpRequest): boolean =>
    isTrustedApiRequest(req, trustedHosts())

  const deps: DeleteSessionDeps = {
    liveSession: (id: string): SessionDeleteLiveSession | undefined => ctx.sessions.get(id),
    flushSession: async (session: { id: string }): Promise<void> => {
      const live = ctx.sessions.get(session.id)
      if (live === undefined) return
      // The store-owned flush is the sanctioned durability entry point; fall
      // back to a raw emit when no carrier-scoped listener participates.
      const participated = await ctx.sessions.flush(live)
      if (!participated) await ctx.emit('session/flush', live)
    },
    detachSession: (session: { id: string }): void => {
      const live = ctx.sessions.get(session.id)
      if (live === undefined) return
      try {
        ctx.sessions.detachEntered(ctx.sessions.liveEntryFor(live))
      } catch (error) {
        ctx.logger.warn(`session-delete: detach of "${session.id}" failed: ${String(error)}`)
      }
    },
    settle: () => sleep(300),
    locateSessionDir: (header: { id: string; createdAt: number; cwd?: string }): string | undefined => {
      const location = ctx.sessionPersistence.locate(header)
      if (location === undefined) return undefined
      return dirname(location.path)
    },
    dirExists: async (path: string): Promise<boolean> => {
      try {
        return (await stat(path)).isDirectory()
      } catch {
        return false
      }
    },
    scanSessionDir: async (id: string): Promise<string | undefined> => {
      const root = ctx.sessionPersistence.root
      if (typeof root !== 'string' || root === '') return undefined
      return scanSessionRoot(root, id)
    },
    removeDir: (target: string) => rm(target, { recursive: true, force: true }),
    listPersisted: () => ctx.sessionPersistence.list(),
    removeFromWorkspaces: async (id: string): Promise<void> => {
      // Workspace records go through the registry's sanctioned write path so
      // the registry cache and the domain stay consistent and the write
      // emits domain/changed → host/workspace-changed.
      for (const workspace of ctx.workspaceRegistry.list()) {
        const accounted = workspace.record.sessionIds.includes(id) || workspace.sessionIds.includes(id)
        if (!accounted) continue
        try {
          await workspace.detachSession(id)
        } catch (error) {
          ctx.logger.warn(`session-delete: detach of "${id}" from workspace "${workspace.id}" failed: ${String(error)}`)
        }
      }
      // The archive set has no public unarchive API, so drop the id through
      // the domain global (durable-correct; emits domain/changed →
      // host/archived-sessions-changed).
      const domain = ctx.storageDomain.get('workspace')
      if (domain === undefined) return
      const state = domain.global.get() as SessionDeleteWorkspaceState
      if (Array.isArray(state.archivedSessionIds) && state.archivedSessionIds.includes(id)) {
        await domain.global.set({
          ...state,
          archivedSessionIds: state.archivedSessionIds.filter((candidate) => candidate !== id),
        })
      }
    },
    removeFromProjectionCache: async (id: string): Promise<void> => {
      try {
        const domain = ctx.storageDomain.get('session_projcache') as SessionDeleteDomain | undefined
        if (domain === undefined) return
        const table = domain.table('sessions') as { delete(key: string): Promise<boolean> }
        await table.delete(id)
      } catch (error) {
        // Cache rows are a fold shortcut, never an authority: a lost row only
        // costs a longer tail replay later. Fail-soft by policy.
        ctx.logger.warn(`session-delete: projection-cache cleanup for "${id}" failed: ${String(error)}`)
      }
    },
    isAgentRunning: (id: string): boolean => {
      const agents = ctx.get('agents') as SessionDeleteAgents | undefined
      return agents?.get(id)?.status === 'running'
    },
    logWarn: (message: string): void => {
      ctx.logger.warn(`session-delete: ${message}`)
    },
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      if (!fence(req)) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const method = pathname.startsWith(`${ROUTE_PREFIX}/`) ? pathname.slice(ROUTE_PREFIX.length + 1) : undefined
      if (method === undefined || method.includes('/')) {
        writeError(res, new SessionDeleteError('not-found', 'unknown session-delete API method', 404))
        return
      }
      try {
        const payload = await readJsonBody(req)
        if (method === 'delete') {
          const sessionId = requireString(payload, 'sessionId')
          const result: DeleteSessionResult = await deleteSessionRecord(deps, sessionId)
          writeOk(res, result)
          return
        }
        writeError(res, new SessionDeleteError('not-found', `unknown session-delete API method "${method}"`, 404))
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'dsh-session-delete: /session-delete/api routes')
}

/** Re-export the core types for tests and diagnostics. */
export { deleteSessionRecord, encodeSegment, assertSessionDir, scanSessionRoot } from './delete-session.ts'
