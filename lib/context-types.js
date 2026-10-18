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
export {};
