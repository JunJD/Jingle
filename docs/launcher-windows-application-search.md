# Launcher Windows 应用搜索方案

## 背景

当前 `openwork launcher` 的应用搜索只覆盖 macOS。

- `src/main/services/launcher-search/providers/applications.ts` 里的 `loadApplicationCatalog()` 目前只处理 `darwin`
- `src/main/windows/launcher-window.ts` 的执行链已经能在 Windows 上走 `shell.openPath(path)`
- 也就是说，当前真正缺的是 Windows 应用发现与归一化，不是 renderer，也不是执行入口

隔壁项目已经有可参考实现，但不适合直接照搬：

- `Jingle` 已实现 Windows 应用搜索，方式是扫描 Start Menu 的 `.lnk`，再用字符串命令 `start "dummyclient" "<target>"` 启动
- `rubick-base` / `rubick-native` 也有 Windows 快捷方式扫描实现，但它们把能力拆在 Rust / Native / Adapter 多层，超出 `openwork` 当前需要

这份方案的目标不是“复刻 Rubick/Jingle”，而是把 Windows 应用搜索以最小改动接入当前 launcher 架构。

## 目标

V1 目标：

- 在 Windows 上搜索大多数通过 Start Menu 暴露的桌面应用
- 复用现有 `applications provider -> search service -> IPC -> launcher action executor` 主链
- 保持 renderer、IPC contract、结果结构和主窗口逻辑基本不变
- 保持结果可解释，避免引入字符串命令执行模型

## 非目标

V1 明确不做：

- Microsoft Store / UWP 应用完整覆盖
- 全盘扫描 `Program Files` / `Program Files (x86)` / 任意磁盘上的 `.exe`
- 基于注册表的应用枚举
- 引入 `rubick-base`、`rubick-native`、Rust/NAPI 依赖
- 为 Windows 首版新增通用 `open-command` action

原因很简单：这些都会扩大边界，但并不解决当前最短路径需求。

## 核心决策

### 1. Windows V1 只扫描 Start Menu 快捷方式

首版只扫描下面两个目录：

- `%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs`
- `%ProgramData%\\Microsoft\\Windows\\Start Menu\\Programs`

不扫描桌面，不扫全盘。

这样做的原因：

- 覆盖系统里最稳定、最标准的一批“可启动应用入口”
- 和 `Jingle` / `rubick` 的主路径一致，经验上可行
- 噪音明显低于桌面和全盘 `exe`
- 不需要引入外部依赖，Electron 自带能力足够

### 2. 发现逻辑继续留在主进程 provider

Windows 支持仍然收口在：

- `src/main/services/launcher-search/providers/applications.ts`

这个模块负责：

- 目录扫描
- 快捷方式解析
- 去重
- subtitle / keywords / icon 所需字段归一化

这个模块不负责：

- renderer 展示
- 键盘语义
- 执行动作分发
- history 策略

### 3. V1 继续使用现有 `open-path` action

首版不新增 action 类型。

Windows 应用结果继续产出：

```ts
{
  executor: "shell",
  type: "open-path",
  target: {
    kind: "application",
    path: shortcutPath
  }
}
```

这里的 `path` 不是解析后的 `target.exe`，而是 `.lnk` 自身路径。

这样做的原因：

- 能复用现有 `launcher-window.ts` 的 `shell.openPath(path)`
- 快捷方式里的参数、工作目录、shell 语义更容易被系统保留
- 不需要把 `Jingle` 那种字符串命令 `start "dummyclient" ...` 带进当前结构化 action 模型

如果未来验证发现某类快捷方式在 `shell.openPath(.lnk)` 下不稳定，再针对那一类加 Windows 专用 fallback；这不属于 V1 默认设计。

### 4. 不引入外部原生依赖

V1 直接使用 Electron 自带的：

- `shell.readShortcutLink()`
- `app.getFileIcon()`

不引入：

- `win-lnk-parser`
- `extract-file-icon`
- Rust backend
- NAPI addon

理由：

- 当前需求只需要扫描与解析 Start Menu 快捷方式
- Electron 已经覆盖了这个能力
- 可以避免打包、签名、跨平台构建复杂度上升

## 模块边界

### Source 层

落点：

- `src/main/services/launcher-search/providers/applications.ts`

职责：

- 扫描 Windows Start Menu
- 调用 `shell.readShortcutLink()` 读取 `.lnk`
- 归一化成 `LauncherApplicationRecord`

### Candidate / Result 层

落点：

- 继续复用当前 `LauncherSearchResult`

职责：

- 维持统一结果结构
- 不引入 Windows 特供结果类型

### Executor 层

落点：

- `src/main/windows/launcher-window.ts`

职责：

- 继续执行 `open-path`
- 不在 V1 中引入字符串命令执行

### Renderer 层

V1 不需要修改。

原因：

- Windows 应用搜索对 renderer 来说只是 provider 结果从“空”变成“有值”
- UI、交互、键盘语义、结果列表组件都无需知道 Windows 细节

## 数据设计

对 shared action/result 结构不做变更。

内部只在 provider 层增加 Windows 快捷方式辅助信息：

```ts
interface WindowsShortcutRecord {
  shortcutPath: string
  targetPath?: string
  arguments?: string
  workingDirectory?: string
  sourceRoot: "user-start-menu" | "system-start-menu"
}
```

它只在 `applications.ts` 内部使用，最终仍然映射回现有的：

```ts
interface LauncherApplicationRecord {
  id: string
  bundleName: string
  displayName: string
  keywords: string[]
  path: string
  subtitle: string
}
```

字段语义在 Windows 下约定如下：

- `id`: 选中的快捷方式身份，一般等于 `.lnk` 路径
- `bundleName`: 快捷方式文件名去扩展名
- `displayName`: 默认与 `bundleName` 相同
- `keywords`: `displayName + target basename + compact + acronym`
- `path`: 用于执行的路径，V1 为 `.lnk` 路径
- `subtitle`: Start Menu 相对父目录名，默认可回退为 `开始菜单`

## 发现与归一化流程

### Step 1. 构建扫描根目录

定义两个固定根目录：

- user root: `%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs`
- system root: `%ProgramData%\\Microsoft\\Windows\\Start Menu\\Programs`

优先级：

- user root 高于 system root

原因：

- 同一个应用如果在两个根目录里都有快捷方式，优先保留用户级入口更符合直觉

### Step 2. 递归收集 `.lnk`

只收集：

- 后缀为 `.lnk` 的文件

先不收集：

- `.appref-ms`
- `.url`
- 任意 `.exe`

原因：

- `.lnk` 是 Start Menu 中最主要的桌面应用入口
- 其他类型会显著增加分支和例外

### Step 3. 解析快捷方式

对每个 `.lnk` 执行：

```ts
const details = shell.readShortcutLink(shortcutPath)
```

读取这些字段：

- `target`
- `args`
- `cwd`

解析失败或无 `target` 的快捷方式直接跳过。

### Step 4. 过滤明显噪音

V1 只做少量、可解释的过滤：

- 无有效 `target`
- 快捷方式名称明显是卸载入口，例如 `Uninstall` / `卸载` / `Unins`

不做复杂黑名单体系。

原因：

- Start Menu 常见噪音主要就是卸载器
- 复杂启发式会让结果不可解释

### Step 5. 构建搜索关键词

沿用当前 `applications.ts` 里已有的 `buildSearchKeywords()` 和拼音匹配能力。

Windows 侧额外补一类关键词：

- 目标程序名 `basename(targetPath, ext)`

例如：

- 快捷方式名：`Visual Studio Code`
- target basename：`Code`

最终关键词集合可以覆盖：

- 完整名称
- 去空格名称
- 首字母缩写
- 目标程序名

### Step 6. 生成 subtitle

`subtitle` 不展示完整磁盘路径，而展示相对容器名。

推荐规则：

- 快捷方式位于根目录下：显示 `开始菜单`
- 快捷方式位于 `Programs\\Some Folder\\App.lnk`：显示 `Some Folder`
- 多层目录时优先取最靠近快捷方式的父目录名

这样比直接显示 `C:\\ProgramData\\...` 更可读。

### Step 7. 去重

Windows provider 需要在 catalog 构建阶段去重。

去重 key：

- 优先 `normalizedTargetPath`
- 没有 `targetPath` 时回退到 `shortcutPath`

冲突解决：

1. user root 胜过 system root
2. 名称更短、更稳定的快捷方式优先
3. 最后按路径排序稳定输出

原因：

- 同一应用常常同时出现在用户级和系统级 Start Menu
- 当前全局 search service 的去重粒度是 `source + id`，不适合解决 provider 内部别名问题

## 图标与执行

### 图标

继续复用当前逻辑：

```ts
app.getFileIcon(applicationPath, { size: "small" })
```

在 Windows 下这里的 `applicationPath` 就是 `.lnk` 路径。

优点：

- 不需要单独提取 icon 文件
- 不需要像 `Jingle` 那样把 icon 落到临时目录

### 执行

继续复用当前 executor：

```ts
shell.openPath(shortcutPath)
```

这意味着 V1 无需修改：

- renderer action shape
- IPC contract
- action executor registry

## 代码改动范围

V1 预期只需要改动一个核心文件：

- `src/main/services/launcher-search/providers/applications.ts`

可能的小范围配套改动：

- 如果要把 Windows subtitle 处理提成 helper，可以继续留在同文件
- 如果执行验证证明 `.lnk` 需要专门 fallback，再改 `src/main/windows/launcher-window.ts`

V1 不预期改动：

- `src/shared/launcher-search.ts`
- preload
- renderer launcher hooks / components

## 实施步骤

### Phase 1. Windows catalog

在 `applications.ts` 中新增：

- Windows Start Menu 根目录常量
- `.lnk` 递归扫描函数
- 快捷方式解析函数
- Windows catalog 构建函数

然后接入：

```ts
switch (process.platform) {
  case "darwin":
    return loadMacApplications()
  case "win32":
    return loadWindowsApplications()
  default:
    return []
}
```

### Phase 2. 去重与排序收紧

补齐：

- 同 target 多快捷方式去重
- user root / system root 优先级
- Windows subtitle 输出

### Phase 3. 手工验收

至少验证以下样例：

- `Chrome`
- `Visual Studio Code`
- 一个中文应用，例如 `微信`
- 一个通过用户级 Start Menu 安装的应用

验收点：

- 搜得到
- 排序稳定
- 图标可见
- 回车可启动
- history 记录正常

## 为什么不直接照搬 Jingle / Rubick

### 不照搬 Jingle 的原因

`Jingle` 的 Windows 方案可用，但不适合直接迁移：

- 它把 action 表达成字符串命令
- 它在 renderer 中直接 `exec(plugin.action)`
- 它会把 icon 落到临时目录
- 它的 app search 数据结构和 `openwork` 当前 launcher result 模型不一致

其中最不该带进来的，是字符串命令执行模型。

`openwork` 现在已经有结构化 action：

- `type`
- `executor`
- `target`

不应为了 Windows 首版倒回命令字符串。

### 不照搬 rubick-base / rubick-native 的原因

`rubick-base` / `rubick-native` 的核心经验可以借，但实现层不必引入：

- 它们把 Windows 发现拆到 Rust / Native / Adapter，多了构建和发布负担
- 当前 `openwork` 并不需要 native 扫描性能
- Electron 已经能完成当前所需的 `.lnk` 解析与 icon 获取

因此这里借的是“扫描 Start Menu `.lnk`”这个产品决策，不是它的技术栈。

## 后续扩展

### 1. ClickOnce / `.appref-ms`

如果后续发现一批常见 Windows 应用只通过 `.appref-ms` 暴露，可以在 V1 稳定后补这一类入口。

这个扩展仍然可以留在 `applications provider` 内完成，不必先改 action 模型。

### 2. Microsoft Store / UWP

这一类不建议塞进 V1。

原因：

- 它们通常不是普通文件路径
- 更适合用 `appUserModelId` 或 `shell:AppsFolder` 启动
- 这会自然要求一个新的 action 类型，例如 `open-app-id`

所以它应该是 V2：

- provider 负责发现 `AUMID`
- action 负责表达 `open-app-id`
- executor 负责调用对应的 Windows shell 启动方式

### 3. 桌面快捷方式

不建议默认并入 V1 的 applications provider。

更适合的路径有两个：

- 作为后续可选扫描源
- 或者继续通过现有 `local-start` 解决用户自定义入口

原因：

- 桌面文件噪音比 Start Menu 大得多
- 它更像“用户自定义入口”，不是“系统应用目录”

## 最终结论

Windows 应用搜索的最小正确方案是：

1. 在主进程 `applications provider` 中扫描 Windows Start Menu 的 `.lnk`
2. 用 `shell.readShortcutLink()` 解析目标与基础元数据
3. 继续映射到现有 `LauncherApplicationRecord`
4. 用 `.lnk` 路径作为 `open-path` 的执行目标
5. 继续复用 `shell.openPath()`、`app.getFileIcon()`、现有 IPC 和 renderer

这条路径改动最小、边界最清晰，也最符合当前 launcher 的架构原则。
