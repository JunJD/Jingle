---
name: openwork-electron-cdp
description: Connect dev3000 or agent-browser to Openwork's Electron renderer through Chrome DevTools Protocol. Use when the user asks whether dev3000/d3k can connect to Openwork Electron, wants to inspect or drive the real Electron window with agent-browser, or needs an isolated Electron CDP session without disturbing an already-running Openwork instance.
user_invocable: true
version: "1.0.0"
---

# openwork-electron-cdp

把 `dev3000` 这类面向 Chromium/CDP 的工具接到 Openwork 的 Electron renderer。

## 结论边界

- 可以连。
- 能观察和驱动的是 Electron 里的 renderer 页签，包括真实窗口里的 DOM、console、network、截图和交互。
- 不能把 `d3k` 的整套“起 web dev server + 起外部 Chrome”流程原样套到 Openwork 上。对 Electron，优先用 `agent-browser --cdp` 这条链路。
- 不能直接通过这个技能看到 main process、preload 内部实现或 IPC handler 代码路径；这些仍然要结合仓库代码和 Electron 日志判断。

## 默认做法

默认不要碰用户当前正在跑的 Openwork 实例。优先起一个隔离实例：

```bash
.agents/skills/openwork-electron-cdp/scripts/start_isolated_electron_cdp.sh 9333
```

这个脚本会：

1. 创建临时 `OPENWORK_HOME`
2. 跑 Prisma migration
3. 用 `OPENWORK_BDD=1` 绕过单实例锁
4. 用 `OPENWORK_REMOTE_DEBUGGING_PORT=<port>` 打开 Electron CDP 端口
5. 启动 `npm run dev`

## 验证顺序

### 1. 验证 Electron 确实暴露了 CDP

```bash
curl -sf http://127.0.0.1:9333/json/version
curl -sf http://127.0.0.1:9333/json
```

预期结果：

- `/json/version` 返回 `Electron/...`
- `/json` 里能看到 `type: "page"`
- `url` 通常是 `http://localhost:<vite-port>/?window=launcher` 或 settings 页

### 2. 用 agent-browser 挂到 Electron

始终带一个独立 session，避免 agent-browser 默认 socket 冲突：

```bash
bun x agent-browser --session openwork-d3k --cdp 9333 get url
bun x agent-browser --session openwork-d3k --cdp 9333 snapshot -i
```

常用命令：

```bash
bun x agent-browser --session openwork-d3k --cdp 9333 click @e2
bun x agent-browser --session openwork-d3k --cdp 9333 fill @e6 "test"
bun x agent-browser --session openwork-d3k --cdp 9333 screenshot /tmp/openwork-electron.png
```

### 3. 如果用户明确提 `dev3000` / `d3k`

说明要点：

- `d3k` 主命令默认假设自己来起浏览器和 web app，不是 Openwork/Electron 的默认路径。
- 真正能复用的是它底下的 CDP 客户端能力，也就是 `agent-browser --cdp`.
- 如果机器上已经装了 `d3k`/`agent-browser`，优先直接用现成命令；没有再用 `bun x agent-browser`.

## 手动接现有实例

只有在用户明确要接当前正在跑的实例时，才让他重启那份 Electron 并带上：

```bash
OPENWORK_REMOTE_DEBUGGING_PORT=9333 npm run dev
```

如果当前已有 Openwork 在跑，这个方法会被单实例锁影响；默认还是隔离实例更稳。
