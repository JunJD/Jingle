# 运行第一次 Agent Task

[English](./first-agent-run.md)

用 launcher 从当前上下文启动一个 agent task。

## 开始前

确认你已经：

- 在 Settings -> Models 配置了模型；
- 选择了可信 workspace；
- 理解当前 permission mode。

Agent 可以读取 workspace context，也可能请求运行命令或编辑文件。只批准你理解的 action。

## 从 Launcher 开始

1. 打开 launcher。
2. 输入你希望 agent 完成的任务。
3. 从 launcher result 打开 AI surface。
4. 在 AI header 检查选中的模型和 permission mode。
5. 提交任务。

运行过程中，对话会显示进度、tool activity、approval prompts 和最终结果。生成的文件、patches、links 和 summaries 可能作为 artifacts 出现在 thread 中。

## Approvals

如果 agent 需要人工批准，run 会暂停并显示 approval card。批准前先阅读请求的 action。如果 command、file edit 或 external action 不是你的意图，请拒绝。

## 停止或继续

你可以从 AI surface 停止正在运行的任务。之前的工作会保留在 thread history 中，因此你可以稍后从 main history window 或 thread search 回来。

如果任务应该从早些时候继续，使用 thread controls 继续或 fork 这份工作，而不是从头开始。
