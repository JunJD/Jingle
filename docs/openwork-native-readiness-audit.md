# Openwork 原生化上线体检交付

日期：2026-04-28

范围：除 AI 识别能力和 extension 功能开发外，检查 Openwork 是否接近跨平台桌面端上线条件。

## 总结

当前还不是上线态。

主要阻塞集中在：

1. 首次启动数据库路径。
2. 桌面打包发布链路。
3. Electron 安全边界。
4. 外链打开收口。
5. 原生窗口体验。
6. 键盘可访问性。
7. Windows/Linux 能力缺口。

## 关键入口

| 模块 | 文件 |
|---|---|
| Electron 主入口 | `src/main/index.ts` |
| 组合根/IPC 注册 | `src/main/composition-root.ts` |
| 主窗口 | `src/main/windows/main-window.ts` |
| 启动器窗口 | `src/main/windows/launcher-window.ts` |
| 设置窗口 | `src/main/windows/settings-window.ts` |
| preload typed API | `src/preload/api/index.ts` |
| preload Electron API | `src/preload/electron-api.ts` |
| renderer 入口 | `src/renderer/src/main.tsx` |
| BDD 测试 | `tests/bdd/features/*.feature` |

## P1 阻塞问题

### 1. 首次启动会卡在未迁移数据库

文件：`src/main/db/lifecycle.ts`

问题：

主进程启动时直接 `await initializeDatabase()`。当前初始化逻辑检查表/列缺失后抛错，提示手动跑 `prisma:migrate:deploy`。BDD 会预先迁移临时库，所以掩盖了真实用户首次安装路径。

影响：

新用户安装后首次启动可能失败，属于上线阻塞。

最小修法：

- 明确 app 启动拥有数据库 schema 初始化职责。
- packaged app 首启自动执行迁移或内置 schema bootstrap。
- 迁移失败时展示原生错误窗口，而不是静默启动失败。
- 增加 `OPENWORK_HOME=$(mktemp -d)` 的首启 BDD/Node 验证。

### 2. 没有真正桌面发布链路

文件：`package.json`

问题：

当前 `build`/`build:electron` 主要产出 `out`。缺少 installer、签名、公证、auto-update、平台 artifact 配置。

影响：

无法达到跨平台桌面应用上线条件。

最小修法：

- 引入明确的 package 脚本，例如 `dist:mac`、`dist:win`、`dist:linux`。
- 配置 electron-builder artifact。
- macOS 增加 signing/notarization/entitlements。
- Windows 增加 NSIS 或 MSI、AppUserModelId、签名。
- Linux 增加 AppImage/deb/rpm 取舍。
- CI 输出安装包，而不是只上传 `out`。

### 3. workspace 路径越界判断可被前缀绕过

文件：`src/main/workspace/service.ts`

问题：

如果使用 `resolvedPath.startsWith(resolvedWorkspace)` 判断路径归属，`/tmp/foo` 和 `/tmp/foobar` 这类前缀关系可能绕过边界。

影响：

workspace 文件访问边界不可靠，属于安全问题。

最小修法：

使用 `path.relative(resolvedWorkspace, resolvedPath)`：

```ts
const relativePath = path.relative(resolvedWorkspace, resolvedPath)
const isInsideWorkspace =
  relativePath === "" ||
  (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
```

### 4. preload 暴露通用 ipcRenderer

文件：`src/preload/electron-api.ts`

问题：

renderer 可通过 `window.electron.ipcRenderer.send/on/invoke` 调用任意 channel，绕过 typed API 的最小暴露原则。

影响：

一旦 renderer 内容渲染或依赖出现 XSS/注入问题，攻击面会被放大。

最小修法：

- 移除通用 `ipcRenderer` 暴露。
- 只保留 typed `window.api.*`。
- 对仍需事件监听的能力建立白名单包装。
- 所有主进程 handler 逐步补 schema 校验。

### 5. 外链打开没有统一走安全 URL guard

文件：

- `src/main/windows/main-window.ts`
- `src/main/windows/settings-window.ts`
- `src/main/launcher/service.ts`

问题：

部分路径直接 `shell.openExternal(url)`，而仓库已有 `ExternalLinksService` 和 `assertSafePublicHttpUrl`。

影响：

外链协议、私网 URL、非 http(s) URL 处理不一致。

最小修法：

- 所有外链入口收口到 `ExternalLinksService.openExternal`。
- window open handler 不直接调用 `shell.openExternal`。
- BDD 覆盖 `javascript:`、`file:`、localhost/private IP、公网 https。

## P2 上线质量问题

### 1. 主窗口状态持久化实现未接入

文件：`src/main/windows/main-window.ts`

现状：

已有 `main-window-state.ts`，但 `createMainWindow` 仍使用固定尺寸。

建议：

- 接入 `getMainWindowPlacement`。
- `ready-to-show` 后附加窗口状态持久化。
- 区分 main/settings/launcher 的状态归属。

### 2. Tab 导航被全局拦截

文件：`src/renderer/src/lib/use-disable-tab-navigation.ts`

问题：

全局 capture 阶段拦截 Tab 并强制聚焦输入框，破坏设置页、聊天页、表单、菜单的原生键盘可达性。

建议：

- 仅在 launcher 搜索框的明确模式内接管 Tab。
- 设置页和主窗口恢复浏览器/原生焦点顺序。
- BDD 增加 keyboard navigation 场景。

### 3. 空状态仍是营销页且存在 TODO 入口

文件：`src/renderer/src/components/home/HomeEntry.tsx`

问题：

空状态包含较重欢迎文案和卡片式 quick actions，其中 quick actions 点击只留 TODO。

建议：

- 删除不可执行入口。
- 空状态改为可执行工作流：打开 workspace、新建 thread、打开 settings。
- 文案更像桌面工具，不像 landing page。

### 4. Windows 支持仍有缺口

已有文档：`docs/windows-support-gap-audit.md`

确认缺口：

- Windows file search 缺失。
- Windows browser history search 缺失。
- Windows clipboard file/folder context 缺失。
- native minimal island macOS-only。
- Windows build/BDD smoke 曾有失败记录。

## 推荐修复分组

### 组 1：上线基础设施

范围：

- `src/main/index.ts`
- `src/main/db/**`
- `scripts/run-prisma-openwork-db.mjs`
- `package.json`
- CI workflow

内容：

- 首启迁移。
- 启动失败展示。
- packaged app 资源路径。
- installer 构建。

冲突：

会和打包发布任务共享 `package.json`，建议合并。

### 组 2：Electron 安全边界

范围：

- `src/preload/electron-api.ts`
- `src/preload/api/**`
- `src/main/ipc/**`
- 各 controller
- 外链入口

内容：

- 移除通用 IPC。
- handler schema 校验。
- 外链 allowlist 收口。

冲突：

所有 IPC 改动都应进入同一组，不宜拆散。

### 组 3：原生窗口体验

范围：

- `src/main/windows/**`
- `src/main/preferences.ts`
- `src/renderer/src/index.css`

内容：

- 窗口状态持久化。
- titlebar/traffic lights/Windows overlay 细节。
- show/focus/activate 行为。
- multi-display 行为。

### 组 4：UI/可访问性

范围：

- `src/renderer/src/components/home/HomeEntry.tsx`
- `src/renderer/src/lib/use-disable-tab-navigation.ts`
- settings/sidebar/tabbar 相关组件

内容：

- 空状态落地。
- Tab/focus 恢复。
- 原生菜单/快捷键语义。

### 组 5：跨平台 launcher 补齐

范围：

- `src/main/services/launcher-search/providers/files.ts`
- `src/main/services/launcher-search/providers/browser-history.ts`
- `src/main/services/clipboard.ts`

内容：

- Windows file search。
- Windows browser history。
- Windows clipboard files。

## 验证命令

基础：

```bash
npm run doctor
npm run check:guardrails
npm run typecheck
npm run lint
npm run test:node
```

BDD：

```bash
npm run test:bdd:smoke
npm run test:bdd -- --tags @settings
npm run test:bdd -- --tags @shortcuts
```

首启验证：

```bash
OPENWORK_HOME=$(mktemp -d) npm run start
```

打包完成后：

```bash
npm run build
npm run build:electron
```

并在 macOS、Windows、Linux 分别验证：

- 安装。
- 首启。
- 重启。
- 更新。
- 卸载后残留。
- 快捷键注册。
- launcher 唤醒。
- 设置页修改持久化。
- 外链打开。

## 上线门槛

P1 全部关闭后，才建议进入 beta：

- 新用户空数据目录可首启。
- installer 可安装。
- 主要平台可启动。
- 外链和 IPC 安全边界收口。
- workspace 路径边界修复。
- BDD smoke 通过。

P2 完成后，才接近正式上线：

- 窗口状态持久化。
- 键盘可访问性恢复。
- 空状态无 TODO。
- Windows launcher 核心能力补齐。

