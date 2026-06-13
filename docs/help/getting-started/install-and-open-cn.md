# 安装并打开

[English](./install-and-open.md)

Openwork/Jingle 是一个桌面 Agent 工作区。应用打开后首先进入 launcher；你可以在这里搜索、启动 AI 工作、打开命令，并回到之前的 threads。

## 安装

npm package：

```bash
npx openwork
```

或者全局安装：

```bash
npm install -g openwork
openwork
```

需要 Node.js 18+。

桌面 release 构建请使用 GitHub Release 中对应平台的 assets。macOS preview 构建可能未签名或未 notarize；测试这类构建时请使用 [macOS preview 安装指南](../../macos-dev-preview-install.md)。

## 打开应用

应用启动后会先显示 launcher。你可以从 launcher：

- 输入请求并开始 AI task；
- 搜索 apps、files、browser history、quicklinks、extension commands 和 threads；
- 打开 Settings；
- 打开 history window，回到之前的工作。

## 第一次设置

运行 agent task 前，先打开 Settings -> Models，至少配置一个 model provider。应用可以使用已配置的 cloud providers、本地 model registries 或自定义 OpenAI-compatible endpoints。

然后在让 agent 检查或修改文件前，选择一个你信任的 workspace。Workspace 是这个 task 的本地项目边界。

## 从源码运行

本地开发：

```bash
pnpm install
pnpm run dev
```

`dev` 脚本会先构建 bundled installable extensions，再启动 Electron。
