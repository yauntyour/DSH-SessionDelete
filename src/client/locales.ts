/**
 * Minimal zh/en copy for the session-delete client. The DSH i18n system is
 * host-backed: the client apply reads `ctx.locale.preference` (the Host
 * preference wins over the raw browser language) and re-renders the
 * injected strings on change.
 */

/** The complete copy key set (both dictionaries share it). */
export interface ConfirmDict {
  menuDeleteSession: string
  deleteTitle: string
  deleteDesc: string
  deleteDescMulti: string
  deletePending: string
  deleteSuccess: string
  deleteFailed: string
  errorAgentRunning: string
  sessionNotFound: string
  cancel: string
  confirmDelete: string
  sessionRow: string
  multipleMatch: string
  created: string
}

/** Simplified Chinese dictionary. */
export const zh: ConfirmDict = {
  menuDeleteSession: '删除会话',
  deleteTitle: '删除会话',
  deleteDesc: '将永久删除会话「{name}」及其全部消息记录，此操作不可恢复。',
  deleteDescMulti: '找到 {count} 个同名会话（{name}），请选择要删除的会话：',
  deletePending: '正在删除…',
  deleteSuccess: '会话已删除',
  deleteFailed: '删除失败：{message}',
  errorAgentRunning: '该会话的代理仍在运行，请等待其结束后再删除。',
  sessionNotFound: '找不到会话「{name}」，可能已被删除。',
  cancel: '取消',
  confirmDelete: '确认删除',
  sessionRow: '会话「{name}」',
  multipleMatch: '（共 {count} 个同名会话）',
  created: '创建于 {time}',
}

/** English dictionary. */
export const en: ConfirmDict = {
  menuDeleteSession: 'Delete session',
  deleteTitle: 'Delete session',
  deleteDesc: 'This permanently deletes session "{name}" and its entire message history. This cannot be undone.',
  deleteDescMulti: 'Found {count} sessions named "{name}". Pick one to delete:',
  deletePending: 'Deleting…',
  deleteSuccess: 'Session deleted',
  deleteFailed: 'Delete failed: {message}',
  errorAgentRunning: 'This session has a running agent — wait for it to finish before deleting.',
  sessionNotFound: 'Session "{name}" not found. It may already be deleted.',
  cancel: 'Cancel',
  confirmDelete: 'Delete',
  sessionRow: 'Session "{name}"',
  multipleMatch: '({count} matching sessions)',
  created: 'Created {time}',
}

/** Resolve the active locale ('zh' wins over 'en', falling back to the browser language). */
export function resolveLocale(preference: string | undefined, navigatorLanguage = navigator.language): 'zh' | 'en' {
  if (preference === 'zh' || preference === 'en') return preference
  return navigatorLanguage.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/** Format a duration like the harness's relative-time labels. */
export function formatRelativeTime(time: number | undefined, now = Date.now(), locale: 'zh' | 'en'): string {
  if (time === undefined) return ''
  const delta = Math.max(0, now - time)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const month = 30 * day
  const year = 365 * day
  const number = (n: number): string => (locale === 'zh' ? String(n) : String(n))
  if (delta < minute) return locale === 'zh' ? '刚刚' : 'just now'
  if (delta < hour) return locale === 'zh' ? `${number(Math.floor(delta / minute))}分钟前` : `${number(Math.floor(delta / minute))}m ago`
  if (delta < day) return locale === 'zh' ? `${number(Math.floor(delta / hour))}小时前` : `${number(Math.floor(delta / hour))}h ago`
  if (delta < month) return locale === 'zh' ? `${number(Math.floor(delta / day))}天前` : `${number(Math.floor(delta / day))}d ago`
  if (delta < year) return locale === 'zh' ? `${number(Math.floor(delta / month))}个月前` : `${number(Math.floor(delta / month))}mo ago`
  return locale === 'zh' ? `${number(Math.floor(delta / year))}年前` : `${number(Math.floor(delta / year))}y ago`
}