# Issue Bug 0618

## 已处理

- `message-projection` 原先尝试用同一个 `isToolResultLikeMessage` 同时决定“是否进入 toolResults”和“是否从聊天正文隐藏”。这会让 assistant-shaped task result 被误当成普通 tool result。已拆成 `isToolResultMessage` 和 `isHiddenToolResultLikeMessage`：真实 `tool` role 才进入 `toolResults`，assistant-shaped tool result 只从聊天正文隐藏。
