# Checkpoint 与 Agent Event Log 存储待办

## 当前判断

- `PrismaCheckpointSaver` 已经完成 checkpoint manifest 与 `channel_values` 的物理拆分。
- `checkpoints.checkpoint` 不再直接存完整 `channel_values`，channel 内容存到 `checkpoint_blobs`。
- `checkpoint_blobs` 已按 `threadId + checkpointNs + channel + version` 存储，并遵循 LangGraph `newVersions` 语义。
- 现阶段不应继续把主要精力放在重写 saver 上，除非有明确 checkpoint 持久化 bug。
- 本地 agent 排查困难是当前真实痛点；后续 `agent_events` 有两个目标：一是参考 opencode 建立 Openwork 自己的 durable event fact layer，二是先服务 trace viewer / CLI 的诊断体验。

## Trace viewer / CLI 目标

第一阶段目标是让本地开发能回答这些问题：

- 单次 run 卡在第几步？
- 哪一步调用了哪个模型、哪个工具？
- LLM 当时实际拿到的 messages / system / tool schema 是什么？
- 哪个 tool 输出最大、最脏、最可能污染上下文？
- token、耗时、错误分别集中在哪一步？
- HITL / interrupt / resume 发生在什么位置？

建议 trace 存储按以下实体设计：

- `agent_traces`：run/trace 级摘要与状态。
- `agent_trace_steps`：step/span 级耗时、模型、token、tool 调用摘要。
- `agent_trace_events`：append-only 事件流，作为 trace 领域事实源。
- `agent_trace_blobs`：完整 LLM 输入、messages baseline、tool output、context snapshot 等大 payload。

第一版 CLI 可以先支持：

```text
jl trace list
jl trace inspect <traceId>
jl trace inspect <traceId> --step <n>
jl trace inspect <traceId> --events
jl trace inspect <traceId> --tools
jl trace inspect <traceId> --messages
```

## 待办

1. 量化 checkpoint blob 占用

   先用真实本地数据确认哪些 channel 占用最高，不凭感觉继续改 saver。

   ```sql
   select channel, count(*), sum(length(value))
   from checkpoint_blobs
   group by channel
   order by sum(length(value)) desc;
   ```

2. 评估 checkpoint retention 是否必要

   如果 `messages` 或其他 channel blob 明显增长，再设计保留策略，例如：

   - 每个 thread 保留最近 N 个 checkpoint。
   - 保留 HITL、run 边界、最终状态等关键 checkpoint。
   - 删除旧 checkpoint 前必须确认对应 blob 是否仍被其他 checkpoint manifest 引用。

3. 评估孤儿 blob GC 是否必要

   当前 thread 删除会清理 checkpoint、writes、checkpoint_blobs。只有在出现独立 orphan blob 证据时，再增加维护任务。

4. 设计 Openwork durable agent event log

   checkpoint 继续作为 LangGraph 恢复层；agent event log 作为 Openwork 的事实层和 trace 层。优先持久化语义边界事件，不持久化所有 token delta。

   候选事件：

   - `run.started`
   - `message.user.created`
   - `assistant.message.started`
   - `assistant.text.completed`
   - `tool.call.started`
   - `tool.call.completed`
   - `tool.call.failed`
   - `approval.requested`
   - `approval.resolved`
   - `run.finished`

5. 让 messages 表逐步变成投影读模型

   后续方向是 `agent_events -> messages -> FTS/history UI`。不要让前端历史消息长期依赖从 checkpoint 提取；但也不要让 messages 表反向替代 LangGraph checkpoint。

## 暂不做

- 暂不移除 checkpoint 中的 `messages` channel。
- 暂不让 `messages` 表反向重建 LangGraph checkpoint。
- 暂不把所有 streaming delta 当作 durable event 存储。
- 暂不在纯 `PrismaCheckpointSaver` 里塞 Openwork message 同步职责。
