# Workspace

[English](./workspace.md)

Workspace 是 agent task 的本地项目或文件夹边界。

Workspace 很重要，因为 Openwork/Jingle 是桌面 Agent。它可以检查本地文件、引用 workspace paths、运行命令并创建 artifacts。请选择你信任且理解的 workspace。

## 默认 Workspace

Settings -> General 可以设置默认 workspace。Launcher 和新的 threads 会使用这个 workspace，除非 thread 自己选择了不同的 workspace。

Thread-level workspace 可以覆盖默认值。这能让不同项目保持分离。

## Agent 可以看到什么

根据 task 和 approvals，agent 可能使用：

- 当前 workspace path；
- 你附加的文件；
- workspace file mentions；
- local memory 和 workspace context sources；
- 已批准命令的 tool outputs。

除非你愿意让 agent task 访问相关上下文，否则不要选择包含 secrets 或无关私有项目的文件夹。

## 什么会被保存

Openwork/Jingle 会把 thread history、run state、artifacts、memory records 和 local logs 存在本地 Openwork data directory 下。默认目录是 `~/.openwork`。测试和 support builds 可以用 `OPENWORK_HOME` 覆盖。

## 什么时候切换 Workspace

以下情况适合切换 workspace：

- task 属于另一个项目；
- agent 说找不到预期文件；
- run 在错误的 folder 中启动；
- 你希望 memory 和 context 归属于另一个项目。
