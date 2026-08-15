# dsh-session-delete

<!-- Hero -->
<div align="center">
  <b style="font-size: 1.15em;">DSH 会话删除插件：在「归档会话」下方新增「删除会话」</b><br /><br />
  <code>一键删除</code> <code>二次确认</code> <code>宿主推送即时刷新</code> <code>同名会话多选</code><br /><br />
  <b>永久删除</b> 会话及其全部消息记录（日志文件 + 工作区账目 + 投影缓存），
  列表通过 DSH 宿主推送自动刷新，无需刷新页面。
</div>

## ✨ 功能

- **🗑️ 菜单注入**：每个会话行的 `⋯` 操作菜单里，在「归档会话」正下方新增「删除会话」——红色危险配色（跟随主题 `--dsw-alias-state-error-primary`）+ 垃圾桶图标 + 危险态悬停底色；
- **🛡️ 二次确认**：危险操作弹窗（跟随主题变量），确认前不会删除任何数据；
- **🪞 同名会话多选**：存在多个同名会话时，弹窗列出全部候选（标题 + id + 相对时间），由你选择；
- **⚡ 即时刷新**：删除通过 DSH 既有 wire 推送（`host/session-removed` / `host/workspace-changed` / `host/archived-sessions-changed`）更新会话列表，**不需要刷新页面**；删除当前会话时自动回到「新会话」视图；
- **🧹 干净删除**：不只删日志文件——同时清理工作区账目（`workspace.sessionIds`）、归档集合（`archivedSessionIds`）与投影缓存（`session_projcache`），重启后不会出现幽灵会话；
- **🔒 与官方同源的安全围栏**：删除接口复用 `/api` 网关同款的浏览器信任围栏（loopback Host 或受信主机 + 同源检查）。

## 📦 安装（Profile Bundle，推荐）

```sh
# 在插件目录构建并打包（已打包可直接用 dsh-session-delete-0.2.0.tgz）
cd D:/Developments/Workspace/DSH-SessionDelete
npm install && npm run build && npm pack

# 挂载到 web profile（路径用正斜杠）
dsh plugin --profile web add "D:/Developments/Workspace/DSH-SessionDelete/dsh-session-delete-0.2.0.tgz"
```

> 若 `pnpm` 报 `ERR_PNPM_UNEXPECTED_STORE`（profile 的 node_modules 与当前 store 不一致，
> 通常是 pnpm 版本/配置变更导致），先在 profile 目录重装对齐：
>
> ```sh
> cd ~/.dsh/profiles/web
> pnpm install --no-frozen-lockfile --config.confirmModulesPurge=false
> ```
>
> 再重新执行上面的 `dsh plugin --profile web add`。

## ✅ 验证安装

```sh
dsh --profile web --dump-config | grep session-delete
# → # == dsh-session-delete
#   - id: session-delete
#     name: dsh-session-delete
```

**重启 `dsh web` 使插件生效**，然后刷新浏览器页面：
在左侧会话列表任意会话行的 `⋯` 菜单中，「归档会话」下方即出现「删除会话」。

## 🚀 使用

1. 将鼠标移到会话行上，点击行尾的 `⋯`；
2. 在菜单中点击「归档会话」下方的 **删除会话**；
3. 在确认弹窗中核对会话标题（多个同名会话时先选择目标）；
4. 点击「删除」，等待「会话已删除」提示——列表自动移除该会话。

> ⚠️ 删除**不可恢复**：会话日志文件会被永久移除。请谨慎操作。

## 🔧 工作原理

### 客户端（lib/client.js，纯 DOM，无框架依赖）

- `MutationObserver` 监听 `document.body`，发现包含「归档会话」项的行操作菜单时，
  克隆该项并改标为「删除会话」插入其正下方（同一哈希类名 → 样式一致）；
- 会话标题取自触发按钮的 `aria-label`（「会话“xxx”的操作」/「Session actions for xxx」，
  全角/半角引号都兼容），再通过客户端会话列表（`ctx.sessions.list`）解析出会话 id；标题重复时列出候选；
- 删除成功后调用 `ctx.sessions.refresh()` 重拉会话基线，配合宿主推送保证
  工作区分组、未分组列表即时同步移除；
- 删除请求发往插件自有的 fenced 路由 `POST /session-delete/api/delete { sessionId }`。

### 服务端（lib/index.js）

删除事务（`src/delete-session.ts`）按顺序执行：

0. **运行守卫**：live 会话若其 agent 仍处于 `running`，直接拒绝（返回 `agent-running`，
   客户端给出友好提示），避免运行中的回合在目录删除后继续落盘重建文件；
1. **flush + detach**：若会话在内存 store 中（live），先走 store 自有的
   `sessions.flush`（官方指定的持久化入口，无监听时回退 `session/flush` emit），
   再 detach（触发 `session/disposed` → 持久化协调器排空写后批次），并等待 300ms
   写批窗口，**避免迟到批次在目录删除后重建文件**；
2. **删除文件（双路径定位）**：先用 `sessionPersistence.locate(header)` 按会话头的
   cwd 计算目录；**目录不存在或头里没有 cwd 时，回退扫描持久化根目录下所有工作区
   目录**（`<root>/<工作区>/<encodeSegment(id)>`，即「按工作区存储」的布局），
   校验目录名 === `encodeSegment(sessionId)`（防误删）后 `rm -rf`；两条路径
   同时命中且不一致时拒绝删除（防歧义）；
3. **工作区账目**：从每个 workspace 记录移除该 id（走 `workspaceRegistry` 实体
   的 `detachSession` 官方写路径，缓存与持久域同步），并从全局 `archivedSessionIds`
   中移除该 id（经 storage-domain 全局写入）；两者都触发 `domain/changed` →
   宿主推送 `host/workspace-changed` / `host/archived-sessions-changed`；
4. **投影缓存**：从 `session_projcache` 域删除该会话行（fail-soft）。

每一步都幂等：对已删除的会话重复执行不报错、无副作用。

## 📌 边界与说明

- **附件**：会话附件（`~/.dsh/attachments`）按对象寻址、无会话索引，删除时**不清理**附件对象；
- **内容搜索索引**：若部署启用了会话内容搜索（session-query），旧索引行可能残留，
  不影响列表显示；重启后索引重建会自然失效；
- **当前打开的会话**：删除后自动回到「新会话」视图；
- **live 会话**：会话在内存中时先 flush 再 detach 后删除；**正在运行 agent 的会话
  会被拒绝删除**（提示等待运行结束），避免运行中的回合重建已删除的目录；
- **菜单注入是 DOM 级**：依赖「归档会话」菜单项的稳定文案与 role 契约；若未来
  DSH 官方 UI 重构该菜单结构，需要同步更新注入逻辑。

## 🔧 开发

```sh
npm install          # devDependencies 自包含
npm run typecheck    # tsc --noEmit
npm test             # vitest（29 个契约测试）
npm run build        # tsc（server lib/）+ tsdown（client bundle lib/client.js）
npm pack             # 发布 tarball
```

## 🗑️ 卸载

```sh
dsh plugin --profile web remove dsh-session-delete
```

移除后重启 `dsh web`，菜单恢复原样。

## 📄 License

MIT
