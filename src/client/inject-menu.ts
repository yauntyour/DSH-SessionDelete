/**
 * Injects a "Delete session" row into the session row action menu, right
 * below the "Archive session" item.
 *
 * The session menu is rendered by @deepseek-ai/dsh-client-ui-workspace
 * (SessionNodeItem -> ui-primitives Menu, portal into document.body) and its
 * items are hardcoded (rename / fork / archive) — there is no menu
 * extension slot. The injection therefore works at the DOM level:
 *
 * - a MutationObserver watches document.body for role=menu lists that
 *   contain the archive item; when one appears, the archive row is cloned
 *   and re-labelled "Delete session" and appended right after it,
 * - the clone keeps the row wrapper (identical layout), then swaps the icon
 *   slot for a trash icon and paints the row with the theme danger color
 *   (--dsw-alias-state-error-primary plus the danger hover background,
 *   mirroring the Menu component danger item styling),
 * - the menu portal DOM is rebuilt by React on every open, so the injected
 *   row disappears with the menu and is re-injected on the next open,
 * - the session title comes from the trigger button aria-label
 *   ("会话“{name}”的操作" / "Session actions for {name}"), captured in a
 *   capture-phase click listener — the zh label uses full-width quotes, so
 *   the parser accepts both “” and "",
 * - the injected button closes the React menu first (a pointerdown on
 *   document makes the Menu outside-click listener call onClose) and then
 *   reports the title to the flow, which owns the confirm dialog.
 *
 * This mirrors how the rest of the UI keeps the row menu DOM-coupled; the
 * hook points are the stable role/text/aria-label contract, not hashed
 * classes.
 */

/** The archive-item copy (matched by label text in both shipped locales). */
const ARCHIVE_LABELS = ['归档会话', 'Archive session']

/** The delete-item copy (set by the flow through getDeleteLabel). */
let deleteLabel = '删除会话'

/** Set the current delete-item label (re-read on every injection pass). */
export function setDeleteLabel(label: string): void {
  deleteLabel = label
}

/** The trash (delete) icon, drawn with currentColor so the row red applies. */
const TRASH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>'

/**
 * Parse the session title out of the trigger button aria-label. The zh
 * label ships with full-width quotes ("会话“{name}”的操作"); accept both
 * full-width and half-width quotes so a UI copy change never strands the
 * parse.
 * @param ariaLabel - the button aria-label value.
 * @returns the session title, or null when the label does not match the
 *   known session-row action pattern.
 */
export function parseSessionTitle(ariaLabel: string): string | null {
  const zhCurly = /^会话“(.+)”的操作$/.exec(ariaLabel)
  if (zhCurly !== null) return zhCurly[1]
  const zhStraight = /^会话"(.+)"的操作$/.exec(ariaLabel)
  if (zhStraight !== null) return zhStraight[1]
  const enMatch = /^Session actions for (.+)$/.exec(ariaLabel)
  if (enMatch !== null) return enMatch[1]
  return null
}

/** Whether an element is one session-row action trigger button. */
function isSessionRowTrigger(element: Element | null): element is HTMLButtonElement {
  if (!(element instanceof HTMLButtonElement)) return false
  const label = element.getAttribute('aria-label')
  return label !== null && parseSessionTitle(label) !== null
}

/** Find the archive menu item inside one open menu, if present. */
function findArchiveItem(menu: Element): Element | null {
  const items = menu.querySelectorAll('[role="menuitem"]')
  for (const item of items) {
    const text = item.textContent ?? ''
    if (ARCHIVE_LABELS.some((label) => text.includes(label))) return item
  }
  return null
}

/** Close a React-rendered open menu by triggering its outside-click listener. */
export function closeOpenMenu(): void {
  document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
}

/** Options for {@link createMenuInjector}. */
export interface MenuInjectorOptions {
  /** Called when the injected "Delete session" row is clicked. */
  onDelete(title: string): void
}

/**
 * Inject the danger hover styling for the injected row. The Menu own
 * danger item styles are hashed classes this plugin cannot reference, so
 * the same look is reproduced through a stable data attribute.
 */
function injectMenuStyle(): void {
  if (document.querySelector('style[data-session-delete-menu-css]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.sessionDeleteMenuCss = ''
  tag.textContent = [
    '[data-session-delete-item]{color:var(--dsw-alias-state-error-primary)}',
    '[data-session-delete-item] span:first-child{color:inherit}',
    '[data-session-delete-item]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(242,95,92,.12)) !important}',
  ].join('\n')
  document.head.appendChild(tag)
}

/** Start the menu injection; returns a disposer. */
export function createMenuInjector(options: MenuInjectorOptions): () => void {
  let disposed = false
  injectMenuStyle()

  const injectIntoMenu = (menu: Element): void => {
    if (menu.hasAttribute('data-session-delete-injected')) return
    const archiveItem = findArchiveItem(menu)
    if (archiveItem === null) return
    const archiveWrap = archiveItem.parentElement
    if (archiveWrap === null) return

    // Clone the archive row: same wrapper → identical layout, then restyle.
    const deleteWrap = archiveWrap.cloneNode(true) as HTMLElement
    const deleteButton = deleteWrap.querySelector('[role="menuitem"]')
    if (!(deleteButton instanceof HTMLButtonElement)) return
    deleteButton.setAttribute('aria-label', deleteLabel)
    deleteButton.dataset.sessionDeleteItem = ''
    // Red row: the theme danger color, matching the Menu danger item look.
    deleteButton.style.color = 'var(--dsw-alias-state-error-primary, #f25f5c)'
    // Icon slot: swap the archive icon for a trash icon (first span = icon).
    const iconSpan = deleteButton.querySelector('span')
    if (iconSpan !== null) {
      iconSpan.innerHTML = TRASH_SVG
      iconSpan.style.color = 'inherit'
    }
    // Label slot: the last span carries the text.
    const labelSpan = deleteButton.querySelector('span:last-child')
    if (labelSpan !== null) labelSpan.textContent = deleteLabel
    deleteButton.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      // Close the React menu before the flow opens its own dialog.
      closeOpenMenu()
      options.onDelete(titleOf(menu))
    })
    archiveWrap.after(deleteWrap)
    menu.setAttribute('data-session-delete-injected', '')
  }

  // Resolve the session title for one open menu: prefer the most recently
  // clicked trigger button's label, fall back to scanning the visible rows.
  const triggers = new Map<Element, string>()
  const onCaptureClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return
    const trigger = isSessionRowTrigger(event.target) ? event.target : event.target.closest('button[aria-label]')
    if (!isSessionRowTrigger(trigger)) return
    const label = trigger.getAttribute('aria-label')
    const title = label === null ? null : parseSessionTitle(label)
    if (title !== null) triggers.set(trigger, title)
  }
  const titleOf = (_menu: Element): string => {
    // The last clicked trigger wins (menus open from their own trigger).
    let title: string | undefined
    for (const value of triggers.values()) title = value
    if (title !== undefined) return title
    return ''
  }

  const scan = (): void => {
    if (disposed) return
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      injectIntoMenu(menu)
    }
  }

  const observer = new MutationObserver(scan)
  observer.observe(document.body, { childList: true, subtree: true })
  document.addEventListener('click', onCaptureClick, true)
  scan()

  return () => {
    disposed = true
    observer.disconnect()
    document.removeEventListener('click', onCaptureClick, true)
  }
}
