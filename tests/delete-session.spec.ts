/**
 * Contract tests for the session-deletion transaction and its helpers.
 * The transaction is exercised against a fake dependency seam (no real
 * filesystem, no cordis) so the ordering and the idempotence guarantees are
 * pinned without a host.
 */
import { describe, expect, it, vi } from 'vitest'
import { basename, dirname, join } from 'node:path'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { assertSessionDir, deleteSessionRecord, encodeSegment, scanSessionRoot, sleep, type DeleteSessionDeps } from '../src/delete-session.ts'
import { SessionDeleteError } from '../src/wire.ts'
import { localizeFailure, matchSessions, parseSessionTitle } from '../src/client/index.ts'

// ── encodeSegment ──────────────────────────────────────────────────────────
describe('encodeSegment', () => {
  it('keeps safe code units literal', () => {
    expect(encodeSegment('session-abc123._-')).toBe('session-abc123._-')
  })

  it('escapes unsafe code units as ~XXXX', () => {
    expect(encodeSegment('a b')).toBe('a~0020b')
    expect(encodeSegment('a/b')).toBe('a~002Fb')
    expect(encodeSegment('~')).toBe('~007E')
  })

  it('neutralizes traversal segments', () => {
    expect(encodeSegment('.')).toBe('~002E')
    expect(encodeSegment('..')).toBe('~002E~002E')
    expect(encodeSegment('../x')).toBe('..~002Fx')
  })

  it('rejects empty strings', () => {
    expect(() => encodeSegment('')).toThrow('cannot encode an empty path segment')
  })
})

// ── assertSessionDir ───────────────────────────────────────────────────────
describe('assertSessionDir', () => {
  it('accepts a directory whose basename is the encoded session id', () => {
    expect(() => assertSessionDir(join('C:/root', encodeSegment('session-1')), 'session-1')).not.toThrow()
  })

  it('rejects a directory whose basename is not the encoded session id', () => {
    expect(() => assertSessionDir('C:/root/other', 'session-1')).toThrow(/refusing to delete non-session directory/)
  })

  it('rejects when the id needs escaping but the basename is raw', () => {
    expect(() => assertSessionDir('C:/root/a b', 'a b')).toThrow(/refusing to delete/)
  })
})

// ── scanSessionRoot ────────────────────────────────────────────────────────
describe('scanSessionRoot', () => {
  it('finds a session directory across workspace directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-scan-'))
    try {
      const ws = join(root, '--D-Workspace--')
      const dir = join(ws, encodeSegment('session-abc'))
      await mkdir(dir, { recursive: true })
      await expect(scanSessionRoot(root, 'session-abc')).resolves.toBe(dir)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns undefined when the session has no directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-scan-'))
    try {
      await expect(scanSessionRoot(root, 'ghost')).resolves.toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses an id duplicated across workspace directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-scan-'))
    try {
      const dirA = join(root, '--A--', encodeSegment('session-dup'))
      const dirB = join(root, '--B--', encodeSegment('session-dup'))
      await mkdir(dirA, { recursive: true })
      await mkdir(dirB, { recursive: true })
      await expect(scanSessionRoot(root, 'session-dup')).rejects.toThrow(/multiple project directories/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

// ── deleteSessionRecord ────────────────────────────────────────────────────
describe('deleteSessionRecord', () => {
  const header = { id: 'session-1', createdAt: 1000, cwd: 'C:/ws' }

  function makeDeps(overrides: Partial<DeleteSessionDeps> = {}): DeleteSessionDeps {
    return {
      liveSession: vi.fn(() => undefined),
      flushSession: vi.fn(async () => {}),
      detachSession: vi.fn(() => {}),
      settle: vi.fn(async () => {}),
      locateSessionDir: vi.fn((h) => join('C:/root', encodeSegment(h.id))),
      dirExists: vi.fn(async () => true),
      scanSessionDir: vi.fn(async () => undefined),
      removeDir: vi.fn(async () => {}),
      listPersisted: vi.fn(async () => [header]),
      removeFromWorkspaces: vi.fn(async () => {}),
      removeFromProjectionCache: vi.fn(async () => {}),
      isAgentRunning: vi.fn(() => false),
      logWarn: vi.fn(() => {}),
      ...overrides,
    }
  }

  it('rejects a blank id', async () => {
    const deps = makeDeps()
    await expect(deleteSessionRecord(deps, '  ')).rejects.toBeInstanceOf(SessionDeleteError)
  })

  it('deletes a persisted, non-live session: locate → verify → remove, then registry cleanup', async () => {
    const deps = makeDeps()
    const result = await deleteSessionRecord(deps, 'session-1')

    expect(deps.liveSession).toHaveBeenCalledWith('session-1')
    expect(deps.listPersisted).toHaveBeenCalledOnce()
    expect(deps.locateSessionDir).toHaveBeenCalledWith(header)
    expect(deps.dirExists).toHaveBeenCalledWith(join('C:/root', encodeSegment('session-1')))
    expect(deps.scanSessionDir).toHaveBeenCalledWith('session-1')
    expect(deps.removeDir).toHaveBeenCalledWith(join('C:/root', encodeSegment('session-1')))
    expect(deps.removeFromWorkspaces).toHaveBeenCalledWith('session-1')
    expect(deps.removeFromProjectionCache).toHaveBeenCalledWith('session-1')
    expect(result).toEqual({
      sessionId: 'session-1',
      removedPaths: [join('C:/root', encodeSegment('session-1'))],
      wasLive: false,
      wasPersisted: true,
    })
  })

  it('flushes and detaches a live session BEFORE touching the files', async () => {
    const live = { id: 'session-1', header }
    const calls: string[] = []
    const deps = makeDeps({
      liveSession: vi.fn(() => live),
      flushSession: vi.fn(async () => { calls.push('flush') }),
      detachSession: vi.fn(() => { calls.push('detach') }),
      settle: vi.fn(async () => { calls.push('settle') }),
      removeDir: vi.fn(async () => { calls.push('remove') }),
      removeFromWorkspaces: vi.fn(async () => { calls.push('workspaces') }),
      removeFromProjectionCache: vi.fn(async () => { calls.push('projcache') }),
    })
    const result = await deleteSessionRecord(deps, 'session-1')

    expect(calls).toEqual(['flush', 'detach', 'settle', 'remove', 'workspaces', 'projcache'])
    expect(result.wasLive).toBe(true)
    expect(result.wasPersisted).toBe(true)
  })

  it('refuses a live session whose agent is running', async () => {
    const live = { id: 'session-1', header }
    const deps = makeDeps({
      liveSession: vi.fn(() => live),
      isAgentRunning: vi.fn(() => true),
    })
    await expect(deleteSessionRecord(deps, 'session-1')).rejects.toThrow(/running agent/)
    expect(deps.flushSession).not.toHaveBeenCalled()
    expect(deps.detachSession).not.toHaveBeenCalled()
    expect(deps.removeDir).not.toHaveBeenCalled()
    expect(deps.removeFromWorkspaces).not.toHaveBeenCalled()
  })

  it('skips file removal when the session has no persisted artifact', async () => {
    const deps = makeDeps({
      liveSession: vi.fn(() => undefined),
      listPersisted: vi.fn(async () => []),
    })
    const result = await deleteSessionRecord(deps, 'ghost')

    expect(deps.locateSessionDir).not.toHaveBeenCalled()
    expect(deps.removeDir).not.toHaveBeenCalled()
    expect(deps.removeFromWorkspaces).toHaveBeenCalledWith('ghost')
    expect(result).toEqual({ sessionId: 'ghost', removedPaths: [], wasLive: false, wasPersisted: false })
  })

  it('skips file removal when the backend exposes no per-session artifact', async () => {
    const deps = makeDeps({
      locateSessionDir: vi.fn(() => undefined),
      dirExists: vi.fn(async () => false),
    })
    const result = await deleteSessionRecord(deps, 'session-1')
    expect(deps.removeDir).not.toHaveBeenCalled()
    expect(result.removedPaths).toEqual([])
  })

  it('falls back to the project-directory scan when the located dir is gone', async () => {
    const scanned = join('C:/root', '--Other--', encodeSegment('session-1'))
    const deps = makeDeps({
      locateSessionDir: vi.fn(() => join('C:/root', '--Ws--', encodeSegment('session-1'))),
      dirExists: vi.fn(async () => false),
      scanSessionDir: vi.fn(async () => scanned),
    })
    const result = await deleteSessionRecord(deps, 'session-1')
    expect(deps.removeDir).toHaveBeenCalledWith(scanned)
    expect(result.removedPaths).toEqual([scanned])
  })

  it('survives a poisoned persistence listing via the directory scan', async () => {
    const scanned = join('C:/root', '--Ws--', encodeSegment('session-1'))
    const deps = makeDeps({
      listPersisted: vi.fn(async () => { throw new Error('corrupt session log') }),
      locateSessionDir: vi.fn(() => undefined),
      scanSessionDir: vi.fn(async () => scanned),
    })
    const result = await deleteSessionRecord(deps, 'session-1')
    expect(deps.logWarn).toHaveBeenCalledOnce()
    expect(deps.removeDir).toHaveBeenCalledWith(scanned)
    expect(result.wasPersisted).toBe(false)
  })

  it('refuses to remove a directory that is not the session dir (path verification)', async () => {
    const deps = makeDeps({
      locateSessionDir: vi.fn(() => 'C:/root/somewhere-else'),
    })
    await expect(deleteSessionRecord(deps, 'session-1')).rejects.toThrow(/refusing to delete non-session directory/)
    expect(deps.dirExists).not.toHaveBeenCalled()
    expect(deps.removeDir).not.toHaveBeenCalled()
    // The transaction aborts before any registry mutation: no half-deleted state.
    expect(deps.removeFromWorkspaces).not.toHaveBeenCalled()
    expect(deps.removeFromProjectionCache).not.toHaveBeenCalled()
  })

  it('refuses an ambiguous session split across two directories', async () => {
    const located = join('C:/root', '--A--', encodeSegment('session-1'))
    const scanned = join('C:/root', '--B--', encodeSegment('session-1'))
    const deps = makeDeps({
      locateSessionDir: vi.fn(() => located),
      dirExists: vi.fn(async () => true),
      scanSessionDir: vi.fn(async () => scanned),
    })
    await expect(deleteSessionRecord(deps, 'session-1')).rejects.toThrow(/multiple directories/)
    expect(deps.removeDir).not.toHaveBeenCalled()
  })

  it('is idempotent for an already-deleted session (nothing throws)', async () => {
    const deps = makeDeps({
      liveSession: vi.fn(() => undefined),
      listPersisted: vi.fn(async () => []),
    })
    const result = await deleteSessionRecord(deps, 'session-1')
    expect(result.removedPaths).toEqual([])
  })
})

// ── client helpers ─────────────────────────────────────────────────────────
describe('parseSessionTitle', () => {
  it('parses the zh trigger label with full-width quotes', () => {
    expect(parseSessionTitle('会话“新会话”的操作')).toBe('新会话')
  })

  it('parses the zh trigger label with half-width quotes', () => {
    expect(parseSessionTitle('会话"新会话"的操作')).toBe('新会话')
  })

  it('parses the en trigger label', () => {
    expect(parseSessionTitle('Session actions for New Session')).toBe('New Session')
  })

  it('returns null for unrelated labels', () => {
    expect(parseSessionTitle('搜索会话')).toBeNull()
    expect(parseSessionTitle('')).toBeNull()
  })
})

describe('matchSessions', () => {
  it('matches by display title', () => {
    const byId = {
      a: { displayTitle: 'Alpha', updatedAt: 1 },
      b: { displayTitle: 'Beta', updatedAt: 2 },
      c: { displayTitle: 'Alpha', updatedAt: 3 },
    }
    expect(matchSessions(byId, 'Alpha')).toEqual([
      { id: 'a', displayTitle: 'Alpha', updatedAt: 1 },
      { id: 'c', displayTitle: 'Alpha', updatedAt: 3 },
    ])
    expect(matchSessions(byId, 'Beta')).toEqual([{ id: 'b', displayTitle: 'Beta', updatedAt: 2 }])
    expect(matchSessions(byId, 'Gamma')).toEqual([])
  })
})

describe('localizeFailure', () => {
  it('maps the agent-running code to friendly copy', () => {
    expect(localizeFailure('agent-running', 'server says', { errorAgentRunning: '运行中' } as never)).toBe('运行中')
  })

  it('passes unknown messages through', () => {
    expect(localizeFailure('internal', 'boom', { errorAgentRunning: 'x' } as never)).toBe('boom')
  })
})

// ── sleep ──────────────────────────────────────────────────────────────────
describe('sleep', () => {
  it('resolves after the window', async () => {
    const before = Date.now()
    await sleep(10)
    expect(Date.now() - before).toBeGreaterThanOrEqual(9)
  })
})

// keep the unused import warning away
void basename
