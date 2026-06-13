# openwork

[English README](README.md)

Openwork 是一个 harness-first 的桌面 Agent 工作区，面向非程序员，也适合需要可控执行、审批和持久运行可见性的本地工作流。它基于 [deepagentsjs](https://github.com/langchain-ai/deepagentsjs) 构建。

> [!CAUTION]
> Openwork 会让 AI Agent 访问你的文件系统，并具备执行 shell 命令的能力。批准任何工具调用前请先阅读内容，并只在你信任的 workspace 中运行。

## 快速开始

```bash
# 直接用 npx 运行
npx openwork

# 或全局安装
npm install -g openwork
openwork
```

需要 Node.js 18+。

应用打开后，先在 Settings -> Models 配置模型 provider，再开始 agent run。

### 从源码运行

```bash
git clone https://github.com/langchain-ai/openwork.git
cd openwork
pnpm install
pnpm run dev
```

源码开发使用 pnpm。`dev` 脚本会先构建 bundled installable extensions，再启动 Electron。

## 文档

- [文档索引](docs/README-cn.md)
- [English docs index](docs/README.md)
- [用户帮助中心](docs/help/README-cn.md)
- [开发者指南](docs/dev/README-cn.md)
- [生产发布治理](docs/production-readiness/README.md)
- [Electron 调试](docs/openwork-electron-debugging.md)

## 桌面发布

桌面打包由 [Desktop Release](.github/workflows/desktop-release.yml) 负责。它会在 tag push 时运行，也可以从 GitHub Actions 手动触发。当前打包矩阵会构建 macOS、Windows 和 Linux 产物。

推送 release tag 会创建 GitHub Release，并上传生成的桌面应用资产：

```bash
git tag v1.2.3
git push origin v1.2.3
```

Release tag 使用 `v1.2.3` 或 `app-v1.2.3`。桌面 workflow 会去掉 `v` / `app-v` 前缀，并把 `1.2.3` 作为应用版本。`v1.2.3-beta.1` 这类 prerelease tag 会被标记为 prerelease。

独立的 [Release](.github/workflows/release.yml) workflow 会在 `v*` tag 上发布 npm package。当前 `v*` tag 会同时触发 npm 发布和桌面打包；`app-v*` tag 用于只打包桌面应用、不发布 npm。

本地打包命令：

```bash
pnpm run dist:mac
pnpm run dist:mac:dir
pnpm run dist:win
pnpm run dist:linux
```

macOS dev preview 构建可能未签名或未 notarize。测试安装说明见 [docs/macos-dev-preview-install.md](docs/macos-dev-preview-install.md)。

## 验证

核心检查：

```bash
pnpm run doctor
pnpm run check:guardrails
pnpm run check:extensions
pnpm run typecheck
pnpm run test:node
```

仓库还包含基于 Cucumber 和 Playwright 的 Electron BDD harness：

```bash
pnpm run test:bdd:smoke
pnpm run test:bdd
```

BDD runner 会先构建应用，启动 packaged Electron entrypoint，为每个 scenario 创建隔离的 `OPENWORK_HOME` 临时目录，并在应用启动前执行 Prisma migrations。

完整质量门禁见 [docs/dev/validation-matrix-cn.md](docs/dev/validation-matrix-cn.md)，打包和发布验证见 [docs/dev/release-runbook-cn.md](docs/dev/release-runbook-cn.md)。

## 模型 Provider

Openwork/Jingle 支持通过 Settings -> Models 配置云 provider、本地模型 registry 和自定义 OpenAI-compatible endpoint。可用模型以应用内模型列表为当前事实源。

## Contributing

欢迎贡献。贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

Bug 请通过 [GitHub Issues](https://github.com/langchain-ai/openwork/issues) 提交。

## License

MIT，详见 [LICENSE](LICENSE)。
