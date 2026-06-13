# Permission Modes

[English](./permission-modes.md)

Permission modes 控制 agent 在询问你之前能做多少事。它们是信任与安全边界，不只是 UI 偏好。

## 它们影响什么

Permission modes 可能影响：

- shell commands；
- file edits；
- desktop automation；
- extension write actions；
- 外部服务变更，例如创建 issues、更新 reminders 或添加 Notion content。

具体 approval 取决于工具和任务。当应用显示 approval card 时，那张 approval card 就是当前决策点。

## 常见模式

Launcher AI surface 会暴露这些 permission choices：

- `Auto`：对应用认为安全或已允许的 action 降低摩擦。
- `Explore`：适合 read-heavy investigation 和更谨慎的探索。
- `Ask to edit`：对写入倾向的 action 先询问。

当你在敏感 workspace 中工作，或不确定任务需要什么时，请使用更受限的模式。

## Approval Cards

当 approval 出现时：

1. 阅读 command 或 action。
2. 检查目标 file、app、service 或 account。
3. 只有当它符合你的意图时才批准。
4. 如果 action 令人意外或范围过大，请拒绝。

拒绝 approval 是安全的。Agent 应该根据这个决定继续，或解释它无法做什么。

## 实用规则

对于新项目，先谨慎。等你信任 workspace、model 和任务形状之后，再为日常工作放宽 permission mode。
