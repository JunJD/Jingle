# Jingle

[English](README.md) | [简体中文](README.zh-CN.md)

[![License: Apache-2.0][license-badge]][license-url]

[license-badge]: https://img.shields.io/badge/License-Apache--2.0-blue.svg
[license-url]: https://www.apache.org/licenses/LICENSE-2.0

Jingle 是一个桌面命令启动器和 Agent 工作台。

官方网站：[jingle.cool](https://jingle.cool)

它把 Raycast 那种键盘优先、快速启动的体验作为基础，然后补上 Agent 真正开始做事后
需要的部分：审批、工具执行、checkpoint、线程历史、本地记忆，以及用户能检查的扩展
工具。

> [!CAUTION]
> Jingle 可以让 AI Agent 访问文件、本地工具和 shell 命令。批准工具调用前请先检查，
> 并只在你信任的工作区中运行 Jingle。

## 快速开始

### 1. Setup

```bash
git clone https://github.com/JunJD/Jingle.git
cd Jingle
make setup
```

需要 Node.js 20.19+ 或 22.12+，以及 pnpm 10+。

`make setup` 会安装依赖、生成 Prisma client，并执行本地 Jingle 数据库 migrations。

如果需要本地环境变量，可以把 `.env.example` 复制成 `.env`，只填写你需要的值。不要提交
`.env` 或真实 secret。

### 2. 开发

```bash
make dev
```

Makefile 是公开开发入口：

- `make help` 查看稳定的公开命令
- `make check` 运行 lint、typecheck 和架构 guardrails
- `make test` 运行 node tests 和 BDD smoke
- `make build` 生成接近生产环境的本地产物

BDD 测试会先构建应用，再启动打包后的 Electron 入口；每个场景都会创建隔离的
`JINGLE_HOME` 目录，并在应用启动前执行 Prisma migrations。

### 3. 使用

```bash
make use
```

`make use` 会构建 Jingle 并打开本地预览应用。首次构建后，可以用 `make start` 再次启动
最近一次本地预览。

Jingle 本地状态优先使用 `JINGLE_HOME`，没有设置时写入 `~/.jingle`。

## Jingle 是什么

Jingle 主要做三件事：

- 快速启动应用、命令、扩展和 AI 工作流
- 把 Agent 工作放进可恢复的线程里运行，并保留 checkpoint 和审批记录
- 让扩展同时提供 UI 命令和可被 Agent 调用的工具

Raycast 是 Jingle 的主要 UX 参照：启动器速度、扩展体验、AI Commands、Agents、
Skills 和 MCP 类集成。Jingle 希望达到这种日常桌面工具的顺手程度，同时更重视
Agent 执行过程本身：Agent 看到了什么、改了什么、用了哪些工具，以及用户在哪里保留
控制权。

参考资料：

- [Raycast AI](https://manual.raycast.com/ai)
- [Raycast AI Commands](https://manual.raycast.com/ai/ai-commands)
- [Raycast AI Extensions](https://manual.raycast.com/ai/ai-extensions)
- [Raycast Agents](https://manual.raycast.com/ai/agents)
- [Raycast Skills](https://manual.raycast.com/ai/skills)
- [Raycast MCP](https://manual.raycast.com/model-context-protocol)
- [Raycast extension docs](https://developers.raycast.com/)

Jingle 是一个活跃开发中的开源项目。稳定 release 前，API、扩展契约和本地数据 schema
仍可能调整。

## 扩展开发

Jingle 扩展使用 `@jingle/*` workspace packages：

- `@jingle/extension-api`
- `@jingle/extension-utils`
- `@jingle/extension-cli`

```bash
make extensions
make extension-dev EXTENSION=installable-extensions/coffee
```

扩展包契约见 [docs/extension-package-contract.md](docs/extension-package-contract.md)。

## Roadmap

产品和开源路线图见 [roadmap.zh-CN.md](roadmap.zh-CN.md)。英文版见
[roadmap.md](roadmap.md)。

## 发布

Jingle 使用稳定版和 nightly 版两个发布通道。Tag 格式和发布规则见
[docs/release-channels.zh-CN.md](docs/release-channels.zh-CN.md)。

## 贡献

欢迎贡献。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，让改动保持清晰边界；如果修改
runtime 或 renderer 之间的职责边界，请在 PR 里说明。

Bug 请通过 [GitHub Issues](https://github.com/JunJD/Jingle/issues) 提交。项目支持见
[SUPPORT.md](SUPPORT.md)，安全报告见 [SECURITY.md](SECURITY.md)，社区行为规范见
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## License

Apache License 2.0。详见 [LICENSE](LICENSE)。
