/**
 * A lightweight confirm dialog for the session-delete flow, rendered as
 * plain DOM with the harness's theme CSS variables (--dsw-alias-*) so it
 * follows the active theme without pulling React or ui-primitives into the
 * bundle.
 *
 * Usage: open a dialog with {@link openDialog}; the returned handle carries
 * the confirm button and a status line, so the flow can bind its async
 * deletion to the click and report progress/failure in place. The promise
 * settles with the chosen candidate id (multi-match) or `null` when the
 * user cancels; the flow can also settle it itself via `settle` after a
 * successful deletion.
 */

export interface DialogQuestion {
  title: string
  body: string
  /** Optional candidate rows (multi-match resolution); clicking one settles with its id. */
  candidates?: Array<{ id: string; label: string }>
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
}

export interface DialogAnswer {
  /** The clicked candidate id, when a candidate list was shown. */
  candidateId?: string
}

/** One open dialog: the promise settles on cancel/candidate/overlay/Escape/settle. */
export interface DialogHandle {
  /** Settles with the candidate id, or `null` on cancel. */
  settled: Promise<DialogAnswer | null>
  /** The primary action button (bind the async flow here). */
  confirmButton: HTMLButtonElement
  /** The status line under the actions (progress / error copy). */
  status: HTMLDivElement
  /** Settle the dialog early (e.g. after a successful deletion). */
  settle(answer: DialogAnswer | null): void
  /** Close and settle with `null`; idempotent. */
  close(): void
}

const CSS = `
.sd-overlay{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)}
.sd-card{box-sizing:border-box;width:min(420px,calc(100vw - 48px));background:var(--dsw-alias-bg-module-platform,#202127);border:1px solid var(--dsw-alias-border-l2,#33343d);border-radius:12px;padding:20px;box-shadow:0 12px 40px rgba(0,0,0,.35);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--dsw-alias-label-primary,#e8e8ea)}
.sd-title{margin:0 0 8px;font-size:15px;font-weight:600}
.sd-body{margin:0 0 4px;color:var(--dsw-alias-label-secondary,#9a9aa3);white-space:pre-wrap;word-break:break-all}
.sd-cands{margin:8px 0 4px;display:flex;flex-direction:column;gap:6px}
.sd-cand{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;text-align:left;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#33343d);background:var(--dsw-alias-bg-l1,#26272e);color:var(--dsw-alias-label-primary,#e8e8ea);cursor:pointer}
.sd-cand:hover{background:var(--dsw-alias-interactive-bg-hover,#30313a)}
.sd-cand-id{flex:1;font-size:12px;color:var(--dsw-alias-label-secondary,#9a9aa3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-actions{margin-top:16px;display:flex;justify-content:flex-end;gap:8px}
.sd-btn{box-sizing:border-box;min-width:72px;padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#33343d);background:var(--dsw-alias-bg-l1,#26272e);color:var(--dsw-alias-label-primary,#e8e8ea);cursor:pointer;font:inherit}
.sd-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#30313a)}
.sd-btn:disabled{opacity:.55;cursor:default}
.sd-btn-primary{background:var(--dsw-alias-brand-bg,#4c6ef5);border-color:transparent;color:#fff}
.sd-btn-primary:hover{background:var(--dsw-alias-brand-bg-hover,#3b5bdb)}
.sd-btn-danger{background:var(--dsw-alias-state-error-primary,#f25f5c);border-color:transparent;color:#fff}
.sd-btn-danger:hover{background:var(--dsw-alias-state-error-hover,#e04845)}
.sd-status{margin-top:10px;min-height:18px;font-size:12px;color:var(--dsw-alias-state-error-primary,#f25f5c)}
.sd-card-danger .sd-title{color:var(--dsw-alias-state-error-primary,#f25f5c)}
.sd-btn svg{display:inline-block;vertical-align:-3px;margin-right:6px}
`;

function injectStyle(): void {
  if (document.querySelector('style[data-session-delete-css]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.sessionDeleteCss = ''
  tag.textContent = CSS
  document.head.appendChild(tag)
}

/** Open one dialog and return its handle (style injection on first use). */
export function openDialog(question: DialogQuestion): DialogHandle {
  injectStyle()
  let settled = false
  let resolveSettled: (answer: DialogAnswer | null) => void = () => {}
  const promise = new Promise<DialogAnswer | null>((resolve) => {
    resolveSettled = resolve
  })

  const host = document.createElement('div')
  host.className = 'sd-overlay'
  host.setAttribute('data-session-delete-dialog', '')
  const card = document.createElement('div')
  card.className = `sd-card${question.danger === false ? '' : ' sd-card-danger'}`
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-modal', 'true')

  const title = document.createElement('p')
  title.className = 'sd-title'
  title.textContent = question.title

  const body = document.createElement('p')
  body.className = 'sd-body'
  body.textContent = question.body

  const status = document.createElement('div')
  status.className = 'sd-status'

  const actions = document.createElement('div')
  actions.className = 'sd-actions'

  const cancelButton = document.createElement('button')
  cancelButton.type = 'button'
  cancelButton.className = 'sd-btn'
  cancelButton.textContent = question.cancelLabel

  const confirmButton = document.createElement('button')
  confirmButton.type = 'button'
  confirmButton.className = `sd-btn ${question.danger === false ? 'sd-btn-primary' : 'sd-btn-danger'}`
  if (question.danger !== false) {
    const confirmIcon = document.createElement('span')
    confirmIcon.className = 'sd-btn-icon'
    confirmIcon.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>'
    confirmButton.append(confirmIcon)
  }
  confirmButton.append(document.createTextNode(question.confirmLabel))

  const finish = (answer: DialogAnswer | null): void => {
    if (settled) return
    settled = true
    host.remove()
    document.removeEventListener('keydown', onKey)
    resolveSettled(answer)
  }
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') finish(null)
  }

  card.append(title, body)
  if (question.candidates !== undefined && question.candidates.length > 0) {
    const list = document.createElement('div')
    list.className = 'sd-cands'
    for (const candidate of question.candidates) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'sd-cand'
      const name = document.createElement('span')
      name.textContent = candidate.label
      const idSpan = document.createElement('span')
      idSpan.className = 'sd-cand-id'
      idSpan.textContent = candidate.id
      row.append(name, idSpan)
      row.addEventListener('click', () => finish({ candidateId: candidate.id }))
      list.appendChild(row)
    }
    card.appendChild(list)
  }
  actions.append(cancelButton, confirmButton)
  card.appendChild(actions)
  card.appendChild(status)
  host.appendChild(card)
  host.addEventListener('pointerdown', (event) => {
    if (event.target === host) finish(null)
  })
  cancelButton.addEventListener('click', () => finish(null))
  document.addEventListener('keydown', onKey)
  document.body.appendChild(host)

  return {
    settled: promise,
    confirmButton,
    status,
    settle: finish,
    close: () => finish(null),
  }
}