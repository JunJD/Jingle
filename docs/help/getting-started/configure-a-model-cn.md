# 配置模型

[English](./configure-a-model.md)

Agent runs 需要已配置的模型。打开 Settings -> Models 添加 credentials、选择可用模型，并设置新的 launcher AI tasks 使用的默认模型。

## 添加 Provider

1. 打开 launcher。
2. 打开 Settings。
3. 选择 Models tab。
4. 添加或编辑 provider credential。
5. 保存，并等待模型列表加载。

Models tab 是当前可用模型的事实源。不要依赖旧文档或 release notes 里的静态模型列表。

## Provider 类型

Openwork/Jingle 可以使用：

- built-in provider adapters；
- 已配置的 cloud providers；
- 本地 model registries；
- 自定义 OpenAI-compatible endpoints。

有些 provider 会在 credentials 保存后远程获取模型列表。如果 provider 没有返回支持的 chat models，模型列表会显示错误，或这个 provider 会保持不可用于 agent runs。

## 默认模型

新的 launcher AI tasks 会使用应用默认模型，除非你在 launcher AI header 中选择了另一个模型。Extension commands 在需要时也可以暴露自己的模型偏好。

## Troubleshooting

如果 run 无法启动：

- 确认 Settings -> Models 中已经配置 provider；
- 确认选中的模型可用；
- 检查 provider key 是否正确保存；
- 当 UI error 不能解释失败原因时，查看 [本地日志](../logs-and-diagnostics/find-logs-cn.md)。
