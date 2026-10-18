window.__ModuleLoader__.load({
	id: "dsh-session-delete",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/api.ts
		/**
		* Typed fetch wrapper over the /session-delete JSON API. One method:
		* POST /session-delete/api/delete { sessionId }. Failures surface as
		* {@link SessionDeleteApiError} with the wire code.
		*/
		/** One wire failure. */
		var SessionDeleteApiError = class extends Error {
			code;
			constructor(code, message) {
				super(message);
				this.code = code;
			}
		};
		async function call(method, payload) {
			let response;
			try {
				response = await fetch(`/session-delete/api/${method}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload)
				});
			} catch (error) {
				throw new SessionDeleteApiError("network", error instanceof Error ? error.message : String(error));
			}
			const parsed = await response.json().catch(() => ({}));
			if (parsed.ok !== true) throw new SessionDeleteApiError(parsed.error?.code ?? "unknown", parsed.error?.message ?? `HTTP ${response.status}`);
			return parsed.value;
		}
		/** Delete one session permanently. */
		function deleteSession(sessionId) {
			return call("delete", { sessionId });
		}
		//#endregion
		//#region src/client/inject-menu.ts
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
		const ARCHIVE_LABELS = ["归档会话", "Archive session"];
		/** The delete-item copy (set by the flow through getDeleteLabel). */
		let deleteLabel = "删除会话";
		/** Set the current delete-item label (re-read on every injection pass). */
		function setDeleteLabel(label) {
			deleteLabel = label;
		}
		/** The trash (delete) icon, drawn with currentColor so the row red applies. */
		const TRASH_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M3 6h18\"/><path d=\"M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2\"/><path d=\"M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6\"/><path d=\"M10 11v6\"/><path d=\"M14 11v6\"/></svg>";
		/**
		* Parse the session title out of the trigger button aria-label. The zh
		* label ships with full-width quotes ("会话“{name}”的操作"); accept both
		* full-width and half-width quotes so a UI copy change never strands the
		* parse.
		* @param ariaLabel - the button aria-label value.
		* @returns the session title, or null when the label does not match the
		*   known session-row action pattern.
		*/
		function parseSessionTitle(ariaLabel) {
			const zhCurly = /^会话“(.+)”的操作$/.exec(ariaLabel);
			if (zhCurly !== null) return zhCurly[1];
			const zhStraight = /^会话"(.+)"的操作$/.exec(ariaLabel);
			if (zhStraight !== null) return zhStraight[1];
			const enMatch = /^Session actions for (.+)$/.exec(ariaLabel);
			if (enMatch !== null) return enMatch[1];
			return null;
		}
		/** Whether an element is one session-row action trigger button. */
		function isSessionRowTrigger(element) {
			if (!(element instanceof HTMLButtonElement)) return false;
			const label = element.getAttribute("aria-label");
			return label !== null && parseSessionTitle(label) !== null;
		}
		/** Find the archive menu item inside one open menu, if present. */
		function findArchiveItem(menu) {
			const items = menu.querySelectorAll("[role=\"menuitem\"]");
			for (const item of items) {
				const text = item.textContent ?? "";
				if (ARCHIVE_LABELS.some((label) => text.includes(label))) return item;
			}
			return null;
		}
		/** Close a React-rendered open menu by triggering its outside-click listener. */
		function closeOpenMenu() {
			document.dispatchEvent(new PointerEvent("pointerdown", {
				bubbles: true,
				cancelable: true
			}));
		}
		/**
		* Inject the danger hover styling for the injected row. The Menu own
		* danger item styles are hashed classes this plugin cannot reference, so
		* the same look is reproduced through a stable data attribute.
		*/
		function injectMenuStyle() {
			if (document.querySelector("style[data-session-delete-menu-css]") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.sessionDeleteMenuCss = "";
			tag.textContent = [
				"[data-session-delete-item]{color:var(--dsw-alias-state-error-primary)}",
				"[data-session-delete-item] span:first-child{color:inherit}",
				"[data-session-delete-item]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(242,95,92,.12)) !important}"
			].join("\n");
			document.head.appendChild(tag);
		}
		/** Start the menu injection; returns a disposer. */
		function createMenuInjector(options) {
			let disposed = false;
			injectMenuStyle();
			const injectIntoMenu = (menu) => {
				if (menu.hasAttribute("data-session-delete-injected")) return;
				const archiveItem = findArchiveItem(menu);
				if (archiveItem === null) return;
				const archiveWrap = archiveItem.parentElement;
				if (archiveWrap === null) return;
				const deleteWrap = archiveWrap.cloneNode(true);
				const deleteButton = deleteWrap.querySelector("[role=\"menuitem\"]");
				if (!(deleteButton instanceof HTMLButtonElement)) return;
				deleteButton.setAttribute("aria-label", deleteLabel);
				deleteButton.dataset.sessionDeleteItem = "";
				deleteButton.style.color = "var(--dsw-alias-state-error-primary, #f25f5c)";
				const iconSpan = deleteButton.querySelector("span");
				if (iconSpan !== null) {
					iconSpan.innerHTML = TRASH_SVG;
					iconSpan.style.color = "inherit";
				}
				const labelSpan = deleteButton.querySelector("span:last-child");
				if (labelSpan !== null) labelSpan.textContent = deleteLabel;
				deleteButton.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					closeOpenMenu();
					options.onDelete(titleOf(menu));
				});
				archiveWrap.after(deleteWrap);
				menu.setAttribute("data-session-delete-injected", "");
			};
			const triggers = /* @__PURE__ */ new Map();
			const onCaptureClick = (event) => {
				if (!(event.target instanceof Element)) return;
				const trigger = isSessionRowTrigger(event.target) ? event.target : event.target.closest("button[aria-label]");
				if (!isSessionRowTrigger(trigger)) return;
				const label = trigger.getAttribute("aria-label");
				const title = label === null ? null : parseSessionTitle(label);
				if (title !== null) triggers.set(trigger, title);
			};
			const titleOf = (_menu) => {
				let title;
				for (const value of triggers.values()) title = value;
				if (title !== void 0) return title;
				return "";
			};
			const scan = () => {
				if (disposed) return;
				for (const menu of document.querySelectorAll("[role=\"menu\"]")) injectIntoMenu(menu);
			};
			const observer = new MutationObserver(scan);
			observer.observe(document.body, {
				childList: true,
				subtree: true
			});
			document.addEventListener("click", onCaptureClick, true);
			scan();
			return () => {
				disposed = true;
				observer.disconnect();
				document.removeEventListener("click", onCaptureClick, true);
			};
		}
		//#endregion
		//#region src/client/confirm-dialog.ts
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
		function injectStyle() {
			if (document.querySelector("style[data-session-delete-css]") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.sessionDeleteCss = "";
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		/** Open one dialog and return its handle (style injection on first use). */
		function openDialog(question) {
			injectStyle();
			let settled = false;
			let resolveSettled = () => {};
			const promise = new Promise((resolve) => {
				resolveSettled = resolve;
			});
			const host = document.createElement("div");
			host.className = "sd-overlay";
			host.setAttribute("data-session-delete-dialog", "");
			const card = document.createElement("div");
			card.className = `sd-card${question.danger === false ? "" : " sd-card-danger"}`;
			card.setAttribute("role", "dialog");
			card.setAttribute("aria-modal", "true");
			const title = document.createElement("p");
			title.className = "sd-title";
			title.textContent = question.title;
			const body = document.createElement("p");
			body.className = "sd-body";
			body.textContent = question.body;
			const status = document.createElement("div");
			status.className = "sd-status";
			const actions = document.createElement("div");
			actions.className = "sd-actions";
			const cancelButton = document.createElement("button");
			cancelButton.type = "button";
			cancelButton.className = "sd-btn";
			cancelButton.textContent = question.cancelLabel;
			const confirmButton = document.createElement("button");
			confirmButton.type = "button";
			confirmButton.className = `sd-btn ${question.danger === false ? "sd-btn-primary" : "sd-btn-danger"}`;
			if (question.danger !== false) {
				const confirmIcon = document.createElement("span");
				confirmIcon.className = "sd-btn-icon";
				confirmIcon.innerHTML = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M3 6h18\"/><path d=\"M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2\"/><path d=\"M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6\"/><path d=\"M10 11v6\"/><path d=\"M14 11v6\"/></svg>";
				confirmButton.append(confirmIcon);
			}
			confirmButton.append(document.createTextNode(question.confirmLabel));
			const finish = (answer) => {
				if (settled) return;
				settled = true;
				host.remove();
				document.removeEventListener("keydown", onKey);
				resolveSettled(answer);
			};
			const onKey = (event) => {
				if (event.key === "Escape") finish(null);
			};
			card.append(title, body);
			if (question.candidates !== void 0 && question.candidates.length > 0) {
				const list = document.createElement("div");
				list.className = "sd-cands";
				for (const candidate of question.candidates) {
					const row = document.createElement("button");
					row.type = "button";
					row.className = "sd-cand";
					const name = document.createElement("span");
					name.textContent = candidate.label;
					const idSpan = document.createElement("span");
					idSpan.className = "sd-cand-id";
					idSpan.textContent = candidate.id;
					row.append(name, idSpan);
					row.addEventListener("click", () => finish({ candidateId: candidate.id }));
					list.appendChild(row);
				}
				card.appendChild(list);
			}
			actions.append(cancelButton, confirmButton);
			card.appendChild(actions);
			card.appendChild(status);
			host.appendChild(card);
			host.addEventListener("pointerdown", (event) => {
				if (event.target === host) finish(null);
			});
			cancelButton.addEventListener("click", () => finish(null));
			document.addEventListener("keydown", onKey);
			document.body.appendChild(host);
			return {
				settled: promise,
				confirmButton,
				status,
				settle: finish,
				close: () => finish(null)
			};
		}
		//#endregion
		//#region src/client/locales.ts
		/** Simplified Chinese dictionary. */
		const zh = {
			menuDeleteSession: "删除会话",
			deleteTitle: "删除会话",
			deleteDesc: "将永久删除会话「{name}」及其全部消息记录，此操作不可恢复。",
			deleteDescMulti: "找到 {count} 个同名会话（{name}），请选择要删除的会话：",
			deletePending: "正在删除…",
			deleteSuccess: "会话已删除",
			deleteFailed: "删除失败：{message}",
			errorAgentRunning: "该会话的代理仍在运行，请等待其结束后再删除。",
			sessionNotFound: "找不到会话「{name}」，可能已被删除。",
			cancel: "取消",
			confirmDelete: "确认删除",
			sessionRow: "会话「{name}」",
			multipleMatch: "（共 {count} 个同名会话）",
			created: "创建于 {time}"
		};
		/** English dictionary. */
		const en = {
			menuDeleteSession: "Delete session",
			deleteTitle: "Delete session",
			deleteDesc: "This permanently deletes session \"{name}\" and its entire message history. This cannot be undone.",
			deleteDescMulti: "Found {count} sessions named \"{name}\". Pick one to delete:",
			deletePending: "Deleting…",
			deleteSuccess: "Session deleted",
			deleteFailed: "Delete failed: {message}",
			errorAgentRunning: "This session has a running agent — wait for it to finish before deleting.",
			sessionNotFound: "Session \"{name}\" not found. It may already be deleted.",
			cancel: "Cancel",
			confirmDelete: "Delete",
			sessionRow: "Session \"{name}\"",
			multipleMatch: "({count} matching sessions)",
			created: "Created {time}"
		};
		/** Resolve the active locale ('zh' wins over 'en', falling back to the browser language). */
		function resolveLocale(preference, navigatorLanguage = navigator.language) {
			if (preference === "zh" || preference === "en") return preference;
			return navigatorLanguage.toLowerCase().startsWith("zh") ? "zh" : "en";
		}
		/** Format a duration like the harness's relative-time labels. */
		function formatRelativeTime(time, now = Date.now(), locale) {
			if (time === void 0) return "";
			const delta = Math.max(0, now - time);
			const minute = 6e4;
			const hour = 60 * minute;
			const day = 24 * hour;
			const month = 30 * day;
			const year = 365 * day;
			const number = (n) => locale === "zh" ? String(n) : String(n);
			if (delta < minute) return locale === "zh" ? "刚刚" : "just now";
			if (delta < hour) return locale === "zh" ? `${number(Math.floor(delta / minute))}分钟前` : `${number(Math.floor(delta / minute))}m ago`;
			if (delta < day) return locale === "zh" ? `${number(Math.floor(delta / hour))}小时前` : `${number(Math.floor(delta / hour))}h ago`;
			if (delta < month) return locale === "zh" ? `${number(Math.floor(delta / day))}天前` : `${number(Math.floor(delta / day))}d ago`;
			if (delta < year) return locale === "zh" ? `${number(Math.floor(delta / month))}个月前` : `${number(Math.floor(delta / month))}mo ago`;
			return locale === "zh" ? `${number(Math.floor(delta / year))}年前` : `${number(Math.floor(delta / year))}y ago`;
		}
		//#endregion
		//#region src/client/index.ts
		/** Services required before mounting (provided by the client runtime). */
		const inject = ["sessions", "locale"];
		/**
		* Resolve the sessions whose display title matches, in list order.
		* @param byId - the sessions list snapshot's byId map.
		* @param title - the clicked row's title.
		* @returns matching candidates.
		*/
		function matchSessions(byId, title) {
			const matches = [];
			for (const id of Object.keys(byId)) {
				const row = byId[id];
				if (row !== void 0 && row.displayTitle === title) matches.push({
					id,
					displayTitle: row.displayTitle,
					updatedAt: row.updatedAt
				});
			}
			return matches;
		}
		/**
		* Client plugin body.
		* @param ctx - the client cordis context (sessions, locale).
		*/
		function apply(ctx) {
			const dict = () => resolveLocale(ctx.locale.preference) === "zh" ? zh : en;
			setDeleteLabel(dict().menuDeleteSession);
			const disposers = [];
			disposers.push(createMenuInjector({ onDelete: (title) => {
				runDeleteFlow(ctx, title);
			} }));
			ctx.effect(() => {
				return () => {
					for (const dispose of disposers) dispose();
				};
			}, "dsh-session-delete: menu injection");
		}
		/**
		* The full delete flow: resolve the session id, confirm, delete, refresh.
		* @param ctx - client context.
		* @param title - the clicked session row's title.
		*/
		async function runDeleteFlow(ctx, title) {
			const d = resolveLocale(ctx.locale.preference) === "zh" ? zh : en;
			const candidates = matchSessions(ctx.sessions.list.getSnapshot().byId, title);
			if (candidates.length === 0) {
				const dialog = openDialog({
					title: d.deleteTitle,
					body: d.sessionNotFound.replace("{name}", title),
					confirmLabel: d.cancel,
					cancelLabel: d.cancel,
					danger: false
				});
				dialog.confirmButton.addEventListener("click", () => dialog.close());
				return;
			}
			const locale = resolveLocale(ctx.locale.preference);
			const selected = candidates.length === 1 ? {
				id: candidates[0].id,
				displayTitle: candidates[0].displayTitle
			} : void 0;
			const dialog = openDialog({
				title: d.deleteTitle,
				body: selected === void 0 ? d.deleteDescMulti.replace("{count}", String(candidates.length)).replace("{name}", title) : d.deleteDesc.replace("{name}", selected.displayTitle),
				candidates: selected === void 0 ? candidates.map((candidate) => ({
					id: candidate.id,
					label: `${candidate.displayTitle}  ·  ${formatRelativeTime(candidate.updatedAt, Date.now(), locale)}`
				})) : void 0,
				confirmLabel: d.confirmDelete,
				cancelLabel: d.cancel,
				danger: true
			});
			dialog.settled.then((answer) => {
				if (answer?.candidateId === void 0) return;
				performDelete(ctx, dialog, answer.candidateId, d);
			});
			dialog.confirmButton.addEventListener("click", () => {
				if (selected === void 0) return;
				performDelete(ctx, dialog, selected.id, d);
			});
		}
		/** Run the fenced delete call and drive the dialog through the states. */
		async function performDelete(ctx, dialog, sessionId, d) {
			dialog.confirmButton.disabled = true;
			dialog.status.textContent = d.deletePending;
			dialog.status.classList.add("sd-pending");
			try {
				await deleteSession(sessionId);
				if (ctx.sessions.list.getSnapshot().current === sessionId) ctx.sessions.clear();
				ctx.sessions.refresh();
				dialog.status.classList.remove("sd-pending");
				dialog.status.textContent = d.deleteSuccess;
				window.setTimeout(() => dialog.close(), 700);
			} catch (error) {
				dialog.status.classList.remove("sd-pending");
				dialog.confirmButton.disabled = false;
				dialog.status.textContent = d.deleteFailed.replace("{message}", error instanceof SessionDeleteApiError ? localizeFailure(error.code, error.message, d) : String(error));
			}
		}
		/**
		* Map a wire failure code to friendly copy; unknown codes pass the server
		* message through unchanged.
		* @param code - the SessionDeleteApiError code.
		* @param message - the server-provided message.
		* @param d - the active dictionary.
		*/
		function localizeFailure(code, message, d) {
			if (code === "agent-running") return d.errorAgentRunning;
			return message;
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.localizeFailure = localizeFailure;
		exports.matchSessions = matchSessions;
		exports.parseSessionTitle = parseSessionTitle;
		exports.setDeleteLabel = setDeleteLabel;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map