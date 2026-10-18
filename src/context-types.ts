/**
 * Structural types for the cordis services this plugin consumes, plus the
 * plugin Context both halves share. The plugin resolves outside the DSH
 * monorepo's single cordis instance, so upstream `declare module`
 * augmentations never reach this Context; the members below mirror the
 * actual runtime shapes this plugin touches (drift is contained to this
 * file):
 *
 * - webServer:     @deepseek-ai/dsh-host-webserver (WebServer.register)
 * - webStartup:    @deepseek-ai/dsh-web-app (WEB_STARTUP_SERVICE; its
 *                  trustedHosts are the bind-derived trusted authorities,
 *                  read lazily via ctx.get — never injected)
 * - sessions:      host side @deepseek-ai/dsh-session (SessionStore)
 * - sessionPersistence: @deepseek-ai/dsh-session-persistence-jsonl
 *   (SessionPersistence backend instance: locate/list/root)
 * - workspaceRegistry:  @deepseek-ai/dsh-workspace (WorkspaceEntity
 *   list/detachSession — the sanctioned write path)
 * - storageDomain: @deepseek-ai/dsh-storage-domain (workspace + projcache
 *   domain tables; the diagnostic `get` face is the public way to reach an
 *   already-open domain without re-opening it)
 * - effect:        the DSH-vendored cordis lifecycle helper
 *
 * This file must stay FREE of Node.js types (`node:http`, `node:stream`,
 * `Buffer`): it is part of the CLIENT-reachable declaration graph, so a
 * Node import here would leak into browser-only consumer builds.
 */

/** The request face route handlers see (structural subset of node's IncomingMessage). */
export interface SessionDeleteHttpRequest {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
  [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array>
}

/** The response face route handlers write to (structural subset of node's ServerResponse). */
export interface SessionDeleteHttpResponse {
  statusCode: number
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

/** One named webserver route (mirror of the host-webserver WebRoute). */
export interface SessionDeleteWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: SessionDeleteHttpRequest, res: SessionDeleteHttpResponse) => void | Promise<void>
}

/** The webServer service face this plugin uses. */
export interface SessionDeleteWebServer {
  register(route: SessionDeleteWebRoute): () => void
}

/**
 * The web-startup service face (mirror of @deepseek-ai/dsh-web-app's
 * WEB_STARTUP_SERVICE values). Optional from this plugin's point of view: it
 * is looked up lazily with ctx.get, never injected.
 */
export interface SessionDeleteWebStartup {
  trustedHosts: readonly string[]
}

/** Immutable session metadata (mirror of dsh-session's SessionHeader). */
export interface SessionDeleteHeader {
  id: string
  createdAt: number
  cwd?: string
}

/** A live session's host-store face (structural subset of dsh-session Session). */
export interface SessionDeleteLiveSession {
  id: string
  header: SessionDeleteHeader
}

/** The host session store face (structural subset of dsh-session SessionStore). */
export interface SessionDeleteSessionStore {
  get(id: string): SessionDeleteLiveSession | undefined
  /** Internal store entry behind a live session (liveEntryFor/detachEntered). */
  liveEntryFor(session: SessionDeleteLiveSession): unknown
  /** Remove one entered session and emit its paired disposal. */
  detachEntered(entry: unknown): void
  /** The store-owned flush entry point (dispatches the awaited session/flush). */
  flush(session: SessionDeleteLiveSession): Promise<boolean>
}

/** Backend-resolved per-session artifact location (mirror of SessionLocation). */
export interface SessionDeleteLocation {
  kind: string
  path: string
}

/** The session-persistence service face (structural subset of the jsonl backend). */
export interface SessionDeletePersistence {
  locate(meta: SessionDeleteHeader): SessionDeleteLocation | undefined
  list(signal?: AbortSignal): Promise<SessionDeleteHeader[]>
  /** The backend's configured session root (jsonl: the sessions directory). */
  root?: string
}

/** One workspace entity (structural subset of dsh-workspace WorkspaceEntity). */
export interface SessionDeleteWorkspace {
  id: string
  path: string
  /** The durable record (the getter `sessionIds` is membership-filtered). */
  record: { sessionIds: readonly string[] }
  /** Membership-filtered session ids (the display projection). */
  sessionIds: readonly string[]
  /** Remove one session id from this workspace via the sanctioned write path. */
  detachSession(id: string): Promise<void>
}

/** The durable workspace registry face (structural subset of WorkspaceRegistry). */
export interface SessionDeleteWorkspaceRegistry {
  list(): SessionDeleteWorkspace[]
}

/** The durable state of the workspace domain (mirror of workspaceDomainState). */
export interface SessionDeleteWorkspaceState {
  initialized: boolean
  workspaceIds: string[]
  archivedSessionIds: string[]
  pendingMutation?: unknown
}

/** One durable workspace record (mirror of workspaceRecord). */
export interface SessionDeleteWorkspaceRecord {
  path: string
  title: string
  sessionIds: string[]
  createdAt: string
  updatedAt: string
}

/** A domain table handle (structural subset of dsh-storage-domain KvTable). */
export interface SessionDeleteKvTable<K extends string, V> {
  get(key: K): V | undefined
  entries(): IterableIterator<[K, V]>
  put(key: K, value: V): Promise<void>
  delete(key: K): Promise<boolean>
}

/** A domain global handle (structural subset of DomainGlobal). */
export interface SessionDeleteDomainGlobal<G> {
  get(): G
  set(value: G): Promise<void>
}

/** One already-open domain runtime (the `storageDomain.get` diagnostic face). */
export interface SessionDeleteDomain {
  readonly name: string
  readonly global: SessionDeleteDomainGlobal<unknown>
  table(name: string): SessionDeleteKvTable<string, unknown>
}

/** The storage-domain facility face (structural subset of DomainFacility). */
export interface SessionDeleteStorageDomain {
  get(name: string): SessionDeleteDomain | undefined
}

/** One agent registry entry (structural subset of the agent service). */
export interface SessionDeleteAgent {
  status?: string
}

/** The agent registry face (the `agents` service, read via ctx.get). */
export interface SessionDeleteAgents {
  get(id: string): SessionDeleteAgent | undefined
}

/** The cordis event emitter face (the flush fallback needs emit). */
export interface SessionDeleteEventEmitter {
  emit(name: string, ...args: unknown[]): unknown
}

/** Plugin context: the cordis ctx surface this plugin reads. */
export interface Context {
  effect(fn: () => void | (() => void) | Promise<void>, label?: string): void
  /** Look up an un-injected service fail-soft (used for the agents guard). */
  get(name: string): unknown
  webServer: SessionDeleteWebServer
  /**
   * The optional web-startup service. Never injected: read lazily with
   * `get('webStartup')` so a missing or renamed service cannot leave the
   * cordis entry pending.
   */
  webStartup?: SessionDeleteWebStartup
  sessions: SessionDeleteSessionStore
  sessionPersistence: SessionDeletePersistence
  workspaceRegistry: SessionDeleteWorkspaceRegistry
  storageDomain: SessionDeleteStorageDomain
  emit: SessionDeleteEventEmitter['emit']
  logger: { warn(message: string): void }
}

/** The client runtime faces the client half reads (see client/context.ts). */
export interface SessionDeleteClientContext {
  effect(fn: () => void | (() => void), label?: string): void
  locale: {
    /** The host-backed language preference ('zh' | 'en' | ...). */
    preference: string
  }
  sessions: {
    /** The session list snapshot feed. */
    list: {
      getSnapshot(): {
        current: string | undefined
        byId: Record<string, { displayTitle: string; updatedAt?: number }>
      }
      subscribe(fn: () => void): () => void
    }
    /** Clear the current selection into the no-session view state. */
    clear(): void
    /** Re-pull the session baseline (drops deleted sessions from the list). */
    refresh(): Promise<unknown>
  }
}
