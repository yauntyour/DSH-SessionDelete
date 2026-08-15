/**
 * Client half of dsh-session-delete: injects the "Delete session" row below
 * "Archive session" in every session row menu, and runs the delete flow —
 * confirm dialog → fenced /session-delete/api/delete → (the host wire
 * pushes host/session-removed / host/workspace-changed /
 * host/archived-sessions-changed refresh the session list without a reload).
 *
 * The bundle is pure DOM (no react imports): it reads the client runtime
 * services through the apply context only.
 */
import type { SessionDeleteClientContext } from '../context-types.ts'
import { deleteSession, SessionDeleteApiError } from './api.ts'
import { createMenuInjector, parseSessionTitle, setDeleteLabel } from './inject-menu.ts'
import { openDialog } from './confirm-dialog.ts'
import { en, formatRelativeTime, resolveLocale, zh, type ConfirmDict } from './locales.ts'

/** Services required before mounting (provided by the client runtime). */
export const inject = ['sessions', 'locale']

/** A resolved candidate session (title match). */
interface SessionCandidate {
  id: string
  displayTitle: string
  updatedAt?: number
}

/**
 * Resolve the sessions whose display title matches, in list order.
 * @param byId - the sessions list snapshot's byId map.
 * @param title - the clicked row's title.
 * @returns matching candidates.
 */
export function matchSessions(
  byId: Record<string, { displayTitle: string; updatedAt?: number }>,
  title: string,
): SessionCandidate[] {
  const matches: SessionCandidate[] = []
  for (const id of Object.keys(byId)) {
    const row = byId[id]
    if (row !== undefined && row.displayTitle === title) {
      matches.push({ id, displayTitle: row.displayTitle, updatedAt: row.updatedAt })
    }
  }
  return matches
}

/**
 * Client plugin body.
 * @param ctx - the client cordis context (sessions, locale).
 */
export function apply(ctx: SessionDeleteClientContext): void {
  const dict = (): ConfirmDict => (resolveLocale(ctx.locale.preference) === 'zh' ? zh : en)
  setDeleteLabel(dict().menuDeleteSession)

  const disposers: Array<() => void> = []

  // The injected row is re-labelled on every injection pass, so a locale
  // change picks the new label up on the next menu open. The dialog copy is
  // read at open time for the same reason.
  disposers.push(createMenuInjector({
    onDelete: (title: string) => {
      void runDeleteFlow(ctx, title)
    },
  }))

  ctx.effect(() => {
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-session-delete: menu injection')
}

/**
 * The full delete flow: resolve the session id, confirm, delete, refresh.
 * @param ctx - client context.
 * @param title - the clicked session row's title.
 */
async function runDeleteFlow(ctx: SessionDeleteClientContext, title: string): Promise<void> {
  const d = resolveLocale(ctx.locale.preference) === 'zh' ? zh : en
  const snapshot = ctx.sessions.list.getSnapshot()
  const candidates = matchSessions(snapshot.byId, title)
  if (candidates.length === 0) {
    // Nothing matched: the session may have disappeared meanwhile.
    const dialog = openDialog({
      title: d.deleteTitle,
      body: d.sessionNotFound.replace('{name}', title),
      confirmLabel: d.cancel,
      cancelLabel: d.cancel,
      danger: false,
    })
    dialog.confirmButton.addEventListener('click', () => dialog.close())
    return
  }

  const locale = resolveLocale(ctx.locale.preference)
  const selected: { id: string; displayTitle: string } | undefined = candidates.length === 1
    ? { id: candidates[0].id, displayTitle: candidates[0].displayTitle }
    : undefined

  const dialog = openDialog({
    title: d.deleteTitle,
    body: selected === undefined
      ? d.deleteDescMulti
        .replace('{count}', String(candidates.length))
        .replace('{name}', title)
      : d.deleteDesc.replace('{name}', selected.displayTitle),
    candidates: selected === undefined
      ? candidates.map((candidate) => ({
          id: candidate.id,
          label: `${candidate.displayTitle}  ·  ${formatRelativeTime(candidate.updatedAt, Date.now(), locale)}`,
        }))
      : undefined,
    confirmLabel: d.confirmDelete,
    cancelLabel: d.cancel,
    danger: true,
  })

  // A candidate click settles the dialog directly; confirm only acts for the
  // single-match case.
  dialog.settled.then((answer) => {
    if (answer?.candidateId === undefined) return
    void performDelete(ctx, dialog, answer.candidateId, d)
  })
  dialog.confirmButton.addEventListener('click', () => {
    if (selected === undefined) return
    void performDelete(ctx, dialog, selected.id, d)
  })
}

/** Run the fenced delete call and drive the dialog through the states. */
async function performDelete(
  ctx: SessionDeleteClientContext,
  dialog: ReturnType<typeof openDialog>,
  sessionId: string,
  d: ConfirmDict,
): Promise<void> {
  dialog.confirmButton.disabled = true
  dialog.status.textContent = d.deletePending
  dialog.status.classList.add('sd-pending')
  try {
    await deleteSession(sessionId)
    // The host wire pushes refreshed the list; if the deleted session was
    // current, clear the selection back to the New Session view, then
    // re-pull the baseline so sessions removed from storage disappear from
    // every grouping (including ungrouped rows).
    if (ctx.sessions.list.getSnapshot().current === sessionId) {
      ctx.sessions.clear()
    }
    void ctx.sessions.refresh()
    dialog.status.classList.remove('sd-pending')
    dialog.status.textContent = d.deleteSuccess
    window.setTimeout(() => dialog.close(), 700)
  } catch (error) {
    dialog.status.classList.remove('sd-pending')
    dialog.confirmButton.disabled = false
    dialog.status.textContent = d.deleteFailed.replace(
      '{message}',
      error instanceof SessionDeleteApiError ? localizeFailure(error.code, error.message, d) : String(error),
    )
  }
}

/**
 * Map a wire failure code to friendly copy; unknown codes pass the server
 * message through unchanged.
 * @param code - the SessionDeleteApiError code.
 * @param message - the server-provided message.
 * @param d - the active dictionary.
 */
function localizeFailure(code: string, message: string, d: ConfirmDict): string {
  if (code === 'agent-running') return d.errorAgentRunning
  return message
}

/** Re-export the menu helpers for tests. */
export { parseSessionTitle, setDeleteLabel }
export { localizeFailure }