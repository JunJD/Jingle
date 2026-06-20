# Agent Message State And Checkpoint Storage Redesign

## 背景

Openwork 当前使用 LangGraph checkpointer 持久化 agent runtime state。这个模型适合早期快速迭代：业务状态可以先放在 graph state 里，由 checkpoint 负责恢复，不需要一开始就为每类状态设计独立表。

随着长任务、工具调用、HITL、人类可见历史、搜索和 trace 能力变复杂，`messages` 继续作为普通 checkpoint channel 存储会带来明显问题：

- `messages` 是高频变化、长序列状态，几乎每一步都会产生新 version。
- 当前 `checkpoint_blobs` 按 `channel + version` 存真实 value，`messages` value 是完整 messages snapshot。
- 长任务会产生很多完整 messages snapshot，数据库体积和 Prisma/SQLite 写入压力迅速放大。
- 产品历史、搜索和审计本质上已经是长期事实，不应该依赖 checkpoint snapshot。

因此需要把 `messages` 从普通 checkpoint value channel 中拆出来，升级为 Openwork 自己维护的消息事实源和可重建消息状态。

## 当前存储语义

当前 LangGraph checkpoint 在 Openwork 中大致分成三层：

```text
checkpoints
  checkpoint manifest
  不直接存 channel_values
  保留 channel_versions

checkpoint_blobs
  每个 channel/version 的真实 value
  主键: thread_id + checkpoint_ns + channel + version

writes
  pending writes / task writes
```

关系示例：

```text
checkpoints.checkpoint
  channel_versions.messages = "v123"
  channel_versions.todos = "v45"

checkpoint_blobs(channel="messages", version="v123")
  value = 完整 messages array

checkpoint_blobs(channel="todos", version="v45")
  value = todos state
```

这个设计对小的 schema state 是合理的，例如 `title`、`todos`、`__interrupt__`、其他 runtime control state。因为这些 state 体积小、变化频率低，多个 checkpoint 可以复用同一个 version blob。

但 `messages` 不适合继续作为普通 blob：

```text
checkpoint 1 -> messages:v1 -> 完整 messages[1..20]
checkpoint 2 -> messages:v2 -> 完整 messages[1..21]
checkpoint 3 -> messages:v3 -> 完整 messages[1..22]
...
```

实际结果是同一段历史被重复存储很多次。

## 核心判断

`checkpoint_blobs` 应该只维护小型 value/schema state。

`messages` 不应该继续作为普通 checkpoint blob。它应该由 Openwork 自己的消息系统维护：

```text
checkpoint_blobs
  存 non-message channels:
    todos
    title
    __interrupt__
    agent-specific schema state

message_events / messages / message_state_versions
  存 messages channel 的事实、投影和可重建版本
```

LangGraph 仍然可以在运行时看到完整的 `checkpoint.channel_values.messages`，但这个完整数组应该在 `getTuple()` 时从消息事实源重建，而不是长期重复存在 `checkpoint_blobs` 里。

## 目标

1. `checkpoint_blobs` 不再存完整 `messages` snapshot。
2. `messages` 成为可重建 LangGraph messages channel 的长期事实源，而不仅是 UI projection。
3. UI 历史、搜索、thread hydrate 从 `messages` / `message_events` 读取，不再依赖 checkpoint。
4. LangGraph resume 仍通过 `BaseCheckpointSaver` 边界完成，调用方不需要知道 messages 已被拆出。
5. checkpoint 继续负责 runtime resume 所需的小型 state，例如 HITL interrupt、pending writes、todos、title。
6. 支持后续 checkpoint retention/compaction，避免长期保存无用 parent chain。

## 后续实现 Goal

后续实现的目标不是一次性重写 agent runtime，而是建立一条可以逐步切换、每一步都可验证的迁移路径。

建议把后续 goal 定义为：

> 将 `messages` 从 `checkpoint_blobs` 的普通 value channel 迁出，建立 `message_events + messages + message_state_versions` 作为消息事实和状态版本系统；新 run 不再写入 `checkpoint_blobs.channel = "messages"`，同时 LangGraph `getTuple()` 仍能透明恢复 `checkpoint.channel_values.messages`。

这个 goal 完成时，应该满足三个收敛判断：

1. 产品历史与 UI hydrate 不再从 checkpoint messages 读取。
2. LangGraph resume 仍能通过 checkpointer 读取完整 messages state。
3. 新写入路径不会再产生 full messages snapshot blob。

实现时优先收敛最小可用路径：

```text
destructive migration
  -> messages channel 写入 message facts
  -> UI hydrate 改读 messages projection
  -> getTuple 从 message_state_versions 重建 messages
  -> checkpoint_blobs 只保存 non-message channels
```

不要先做 Redis、完整 time-travel、复杂 compaction 或跨设备同步。这些都可以后置，避免把核心迁移做散。

## 非目标

- 不要求无损保留所有历史 checkpoint 的完整 messages snapshot。
- 不把 `agent_events` 当作唯一消息事实源。`agent_events` 负责 trace/审计/process events，消息事实需要独立设计。
- 不要求 Redis 或外部服务作为桌面端必需依赖。
- 不在第一版实现完整 time-travel 产品体验。
- 不保证 checkpoint 丢失后还能原地恢复 LangGraph 执行栈。可以从 messages 构建新 run 上下文，但这不是同一个 checkpoint resume。

## 术语

### LangGraph stream mode

运行时 stream 可能有 `"messages"` 和 `"values"` mode。这个 mode 是流式输出分类，不等于 checkpoint storage 的 channel 分类。

### Checkpoint channel

checkpoint 中的 `channel_values` 是 graph state：

```text
channel_values.messages
channel_values.todos
channel_values.title
channel_values.__interrupt__
```

本文讨论的是把 `channel_values.messages` 从普通 checkpoint blob 中拆出。

### Message fact

能够重建 LangGraph message 的长期事实，包括：

- message id
- role/type
- raw LangChain message payload
- tool calls
- tool call id
- metadata
- run id
- seq/order
- create/update/remove/truncate/summarize 等事件

### Message projection

给 UI、搜索、历史列表读取的当前消息视图。projection 可以从 message facts 重建。

## 目标架构

```text
LangGraph runtime
  |
  | put(checkpoint)
  v
Openwork CheckpointSaver
  |
  |-- non-message channels --> checkpoint_blobs
  |
  |-- messages channel ------> message_events
                             messages
                             message_state_versions

LangGraph runtime
  ^
  | getTuple()
  |
Openwork CheckpointSaver
  |
  |-- restore non-message channels from checkpoint_blobs
  |
  |-- restore messages from message_state_versions + message_events/messages
```

## 数据模型

### MessageEvent

`message_events` 是 append-log，表达消息状态如何演化。它是重建 LangGraph messages channel 的核心事实源。

建议 schema：

```prisma
model MessageEvent {
  threadId      String @map("thread_id")
  checkpointNs  String @default("") @map("checkpoint_ns")
  seq           Int
  eventId       String @id @map("event_id")
  type          String
  messageId     String? @map("message_id")
  runId         String? @map("run_id")
  checkpointId  String? @map("checkpoint_id")
  payload       String
  createdAt     BigInt @map("created_at")

  thread Thread @relation(fields: [threadId], references: [threadId], onDelete: Cascade)
  run    Run?   @relation(fields: [runId], references: [runId], onDelete: SetNull)

  @@unique([threadId, checkpointNs, seq], map: "uidx_message_events_thread_ns_seq")
  @@index([threadId, checkpointNs, checkpointId], map: "idx_message_events_checkpoint")
  @@index([threadId, runId, seq], map: "idx_message_events_thread_run_seq")
  @@map("message_events")
}
```

`type` 第一版只落两个事件：

```ts
type MessageEventType = "message.upsert" | "message.remove"
```

`payload` 示例：

```json
{
  "rawMessage": {
    "type": "constructor",
    "id": ["langchain_core", "messages", "AIMessage"],
    "kwargs": {
      "id": "msg_1",
      "content": "Done",
      "tool_calls": []
    }
  },
  "role": "assistant",
  "createdAt": 1760000000000
}
```

### Message

`messages` 是当前 UI/search projection。它可以继续保留现有职责，但需要升级为可从 facts 重建，并补充必要字段。

建议字段：

```prisma
model Message {
  threadId      String @map("thread_id")
  messageId     String @map("message_id")
  seq           Int?
  role          String
  kind          String
  content       String
  rawMessage    String? @map("raw_message")
  toolCalls     String? @map("tool_calls")
  toolCallId    String? @map("tool_call_id")
  name          String?
  metadata      String?
  runId         String? @map("run_id")
  createdAt     BigInt @map("created_at")
  updatedAt     BigInt @map("updated_at")
  searchText    String @map("search_text")

  thread Thread @relation(fields: [threadId], references: [threadId], onDelete: Cascade)
  run    Run?   @relation(fields: [runId], references: [runId], onDelete: SetNull)

  @@id([threadId, messageId])
  @@index([threadId, seq], map: "idx_messages_thread_seq")
  @@index([threadId, createdAt], map: "idx_messages_thread_created_at")
  @@map("messages")
}
```

说明：

- `content` 继续服务 UI 展示。
- `rawMessage` 存可反序列化回 LangChain message 的原始 payload。
- `seq` 用于当前 projection 的稳定顺序。
- `message_events` 是事实流，`messages` 是当前投影。

### MessageStateVersion

`message_state_versions` 把 LangGraph `channel_versions.messages` 映射到 Openwork message state。

```prisma
model MessageStateVersion {
  threadId      String @map("thread_id")
  checkpointNs  String @default("") @map("checkpoint_ns")
  version       String
  throughSeq    Int @map("through_seq")
  stateHash     String? @map("state_hash")
  createdAt     BigInt @map("created_at")

  thread Thread @relation(fields: [threadId], references: [threadId], onDelete: Cascade)

  @@id([threadId, checkpointNs, version])
  @@index([threadId, checkpointNs, throughSeq], map: "idx_message_state_versions_thread_ns_seq")
  @@map("message_state_versions")
}
```

语义：

```text
checkpoint.channel_versions.messages = "v123"

message_state_versions(thread_id, checkpoint_ns, version="v123")
  through_seq = 1008

getTuple()
  restore messages state through seq 1008
```

注意：`message_state_versions` 不存 `checkpoint_id`。checkpoint 到 messages state 的关联只通过 checkpoint manifest 中的 `channel_versions.messages` 完成；`message_events.checkpoint_id` 只用于审计每个 delta 的来源。

### CheckpointBlob

`checkpoint_blobs` 保持现有结构，但第一版规则改变：

```text
channel != "messages"
  正常写 checkpoint_blobs

channel == "messages"
  不写 checkpoint_blobs
  写 message_events + message_state_versions
```

可以在代码层保证，不一定第一版加数据库 constraint。本次 destructive migration 会删除既有 `checkpoint_blobs.messages`。

## 写入流程

### saver.put()

输入：

```text
checkpoint
  id
  channel_values
  channel_versions
metadata
newVersions
```

目标流程：

```text
1. copy checkpoint
2. ensure channel_versions
3. 分离 messages channel 和 non-message channels
4. non-message channels:
   写 checkpoint_blobs
5. messages channel:
   diff 上一个 messages state
   写 message_events
   更新 messages projection
   写 message_state_versions(version -> throughSeq)
6. 写 checkpoints manifest
7. afterPut:
   写 checkpoint.committed event
   写/更新 HITL request
   不再从 checkpoint snapshot 同步 messages projection
```

伪代码：

```ts
async function put(config, checkpoint, metadata, newVersions) {
  const prepared = copyCheckpoint(checkpoint)
  ensureCheckpointChannelVersions(prepared, newVersions)

  const messages = prepared.channel_values.messages
  const messagesVersion = prepared.channel_versions.messages

  const nonMessageValues = omit(prepared.channel_values, "messages")
  const nonMessageVersions = omit(prepared.channel_versions, "messages")

  const messageState =
    Array.isArray(messages) && messagesVersion
      ? await persistMessageState({
          threadId,
          checkpointNs,
          checkpointId: prepared.id,
          runId,
          version: messagesVersion,
          messages
        })
      : null

  await writeCheckpointBlobs(nonMessageValues, nonMessageVersions)
  await writeCheckpointManifest(prepared)
}
```

### Message diff

第一版实现直接 delta，不保留 reset/truncate 旁路：

```text
如果上一个 message state 存在：
  找出 next messages 相对 previous messages 的变化
  追加 message.upsert / message.remove events

same message id + same raw hash + same order:
  不写新 event

same message id + changed raw hash/order:
  写 message.upsert

new message id:
  写 message.upsert

missing previous message id:
  写 message.remove
```

遇到无法解析 role 或无法序列化 payload，直接失败暴露；不把未知消息猜成 assistant，也不 fallback 到 checkpoint messages snapshot。

### messages projection 更新

`messages` projection 应该和 message_events 在同一个 transaction 中更新，保证 UI 读到的是完整状态。

```text
message.upsert
  upsert messages row

message.remove
  delete messages row
```

搜索索引继续从 `messages` projection 重建或增量更新。

## 读取流程

### saver.getTuple()

目标：LangGraph 仍然拿到完整 checkpoint。

流程：

```text
1. 读 checkpoints row
2. deserialize checkpoint manifest
3. load non-message channel_values from checkpoint_blobs
4. 如果 channel_versions.messages 存在：
   4.1 读 message_state_versions
   4.2 通过 through_seq 重建 messages
   4.3 写入 checkpoint.channel_values.messages
5. load pending writes
6. return CheckpointTuple
```

伪代码：

```ts
async function loadChannelValues(threadId, checkpointNs, channelVersions) {
  const values = await loadNonMessageBlobs(channelVersions)

  const messagesVersion = channelVersions.messages
  if (messagesVersion) {
    values.messages = await loadMessagesForVersion({
      threadId,
      checkpointNs,
      version: messagesVersion
    })
  }

  return values
}
```

### UI hydrate

当前 UI hydrate 不应该继续从 checkpoint 提取 messages。

目标：

```text
Thread hydrate:
  messages: 从 messages projection 读取
  artifacts: 从 artifacts 读取
  pendingApproval: 从 hitl_requests 优先读取，必要时 fallback checkpoint
  todos/title/forkState: checkpoint 或专门 projection
```

这样用户刷新、关闭后再打开、搜索历史，都不依赖 checkpoint 是否保留完整 messages。

## HITL 和 resume

HITL resume 仍然需要 checkpoint 中的 runtime state，例如 `__interrupt__`、pending writes、config parent 等。

拆出 messages 不等于删除 checkpoint：

```text
保留:
  latest resumable checkpoint
  __interrupt__
  pending writes
  small schema state

删除/迁出:
  full messages snapshot
```

如果 checkpoint 不存在，只从 messages 可以重建“下一轮模型上下文”，但不能保证原地恢复 LangGraph interrupt 执行栈。

产品语义建议：

```text
checkpoint 存在:
  resume original run

checkpoint 不存在:
  start new run from reconstructed messages context
  或提示 retry/fork
```

## clone / fork / edit last message

### clone thread

长期目标：clone 应该从事实层复制，而不是复制所有 checkpoint blobs。

第一版可以保守：

```text
clone thread:
  复制 messages projection / message_events 到新 thread
  复制 latest checkpoint 的 non-message state
  给新 thread 生成新的 message_state_versions
```

### clone until message

这类能力天然需要“某个历史边界的消息状态”。

如果产品要保留它，不能只依赖 checkpoint parent chain。应该改为：

```text
找到目标 message seq
复制 message_events through target seq
创建新 thread
创建 synthetic latest checkpoint / message_state_version
```

如果短期不保留该能力，可以先禁用入口；不要回退到旧 checkpoint messages blob。

### edit last user message

当前逻辑依赖 checkpoint 中的 messages 来判断 latest user message 和 remove ids。

迁移后应改为：

```text
从 messages projection 找 latest user message
校验只能编辑最后一个 user message
把该 user 之后的 UI 投影消息作为删除列表传给新 run
提交新 user message
启动新 run
下一次 checkpoint messages state 通过 message.remove/upsert delta 收敛
```

## Retention 和 compaction

拆出 messages 后，checkpoint retention 可以更激进。

建议策略：

```text
running/interrupted run:
  保留 latest checkpoint
  保留必要 parent/pending writes

successful run:
  保留 final checkpoint 或只保 compacted latest checkpoint
  删除旧 checkpoint parent chain

failed/cancelled run:
  保留可诊断 metadata 和 events
  checkpoint 可按 debug 设置保留
```

message_events compaction：

```text
定期把 old event log 压成 baseline snapshot:
  新建 message-state baseline 机制
  删除 baseline 之前已被覆盖的 upsert/remove events

messages projection 始终是当前读模型
```

注意：baseline 是消息系统自己的 compacted state，不是 `checkpoint_blobs.messages`。

## 本次实施计划

这次正式重构不保留旧 checkpoint/messages 数据，也不做 legacy fallback。

进入条件：

- 可以执行 destructive migration。
- 旧 `messages` projection 和旧 `checkpoint_blobs.channel = "messages"` 可以删除。
- 新 run 是唯一需要支持的运行数据。

任务：

- 重建 `messages` 表，使它成为当前 UI/search projection。
- 新增 `message_events`，作为 messages channel 的 append-log 事实源。
- 新增 `message_state_versions`，把 LangGraph `channel_versions.messages` 映射到 message event seq 边界。
- `PrismaCheckpointSaver.put()`：
  - `messages` channel 不写 `checkpoint_blobs`。
  - 使用 LangGraph serializer 预序列化 raw message payload。
  - 只把新增、变更、删除的 message 写成 `message_events`，不按 checkpoint 重复写完整历史。
  - 写 `message_state_versions(version -> throughSeq)`。
- `PrismaCheckpointSaver.getTuple()`：
  - non-message channels 从 `checkpoint_blobs` 恢复。
  - `messages` 从 `message_state_versions + message_events` 恢复，并重新交给 LangGraph。
- `RuntimeCheckpointSaver.afterPut()`：
  - 只保留 checkpoint.committed event 和 HITL request。
  - 不再从 checkpoint snapshot 同步 messages projection。
- thread hydrate：
  - messages 从 `messages` projection 读取。
  - todos/HITL/fork runtime state 仍从 checkpoint 或专门表读取。
- edit last user message：
  - 从 `messages` projection 判断最后一条 user message 和要删除的后续 message ids。
- clone/fork：
  - 复制 message facts、message state versions、messages projection。
  - `checkpoint_blobs` 只复制 non-message channels。

退出条件：

- 新 run 的 `checkpoint_blobs` 中 `channel = "messages"` 为 0。
- 每个 checkpoint manifest 中的 `channel_versions.messages` 都能在 `message_state_versions` 找到对应行。
- `getTuple()` 在没有 message blob 的情况下可以恢复 `checkpoint.channel_values.messages`。
- 同一 message 未变化时，新的 checkpoint 只新增 `message_state_versions`，不重复新增 `message.upsert` event。
- thread hydrate 的 messages 主路径不调用 `extractMessagesFromCheckpoint()`。
- HITL pending writes 中的 `__pregel_tasks.args.messages` 仍是 ref，不落完整 messages array。

## 收敛校验

后续实现完成时，应该用测试、SQL 和代码搜索三类校验共同收敛。

### SQL 校验

新 run 不应该再写 full messages blob：

```sql
SELECT COUNT(*) AS message_blob_count
FROM checkpoint_blobs
WHERE channel = 'messages';
```

在只看新建测试 thread 时，结果应为 `0`。

每个 checkpoint messages version 都应该能找到 message state version：

```sql
SELECT c.thread_id, c.checkpoint_ns, c.checkpoint_id
FROM checkpoints c
WHERE json_extract(c.checkpoint, '$.channel_versions.messages') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM message_state_versions msv
    WHERE msv.thread_id = c.thread_id
      AND msv.checkpoint_ns = c.checkpoint_ns
      AND msv.version = json_extract(c.checkpoint, '$.channel_versions.messages')
  );
```

结果应为空。注意：如果 checkpoint payload 不是纯 JSON text，需要用项目里的 serializer/codec 写诊断脚本代替这条 SQL。

messages projection 应该有可重建 raw payload：

```sql
SELECT COUNT(*) AS missing_raw_message_count
FROM messages
WHERE raw_message IS NULL
  AND role IN ('user', 'assistant', 'tool', 'system');
```

结果应为 `0`。

message events seq 应该连续或至少严格递增：

```sql
SELECT thread_id, checkpoint_ns, COUNT(*) AS event_count, MIN(seq) AS min_seq, MAX(seq) AS max_seq
FROM message_events
GROUP BY thread_id, checkpoint_ns;
```

后续可以用测试断言同一个 `(thread_id, checkpoint_ns)` 内没有重复 seq。

### 代码搜索校验

产品历史主路径不应该依赖 checkpoint messages：

```bash
rg "extractMessagesFromCheckpoint" src/main/threads src/renderer src/preload
```

允许保留的位置：

- tests
- checkpointer getTuple/reconstruction path

不允许作为 thread hydrate 的主路径。

新写入路径不应该把 `messages` 送进 `dumpChannelBlobs()`：

```bash
rg "dumpChannelBlobs|checkpointBlob.*messages|channel.*messages" src/main/checkpointer src/main/db
```

检查点：

- `dumpChannelBlobs()` 明确跳过 `messages`。
- `loadChannelValues()` 明确对 `messages` 走 `message_state_versions`。
- `putWrites()` 不保存 `__pregel_tasks.args.messages` 的完整数组。

### 测试校验

至少需要这些测试：

- `PrismaCheckpointSaver.put/getTuple restores messages from message_state_versions`
- `PrismaCheckpointSaver.put does not write checkpoint_blobs messages`
- `RuntimeCheckpointSaver persists message facts on checkpoint put`
- `ThreadsService hydrates messages from messages projection`
- `AgentService editLastUserMessage reads messages projection`
- `HITL resume works without checkpoint_blobs messages`
- `tool call consistency is preserved after message reconstruction`
- `unchanged messages do not create repeated message.upsert events`

### 手动长任务校验

用一个会产生多轮工具调用的长任务验证：

```text
1. 开新 thread。
2. 跑一个会产生至少 20 个 checkpoint 的任务。
3. 中途触发 tool approval。
4. 刷新 UI，确认历史完整。
5. approve/reject，确认 resume 正常。
6. 任务结束后检查 checkpoint_blobs 没有新 messages blob。
7. 检查 messages/message_events/message_state_versions 行数合理增长。
```

### 回归风险边界

如果下列任一条件不满足，不应该合并本次重构：

- `getTuple()` 不能在无 `checkpoint_blobs.messages` 时恢复 messages。
- HITL resume 仍依赖 message blob。
- UI hydrate 仍从 checkpoint messages 读取。
- raw LangChain message payload 不能完整还原 tool calls/tool results。
- edit last user message 不能从 messages projection 判断截断边界。

## 失败模式和处理

### message_state_version 缺失

如果 checkpoint manifest 有 `channel_versions.messages`，但找不到对应 `message_state_versions`：

```text
视为存储损坏，抛出明确错误。
不 fallback 到 checkpoint_blobs.messages。
```

### message_events 无法重建合法 provider messages

可能原因：

- orphan tool message
- assistant tool call 和 tool result 不匹配
- RemoveMessage/truncate 顺序错误

处理：

- hydrate 前运行现有 `tool-call-consistency` 类似校验。
- 对 provider 输入做最后一道 sanitize。
- 记录诊断事件，避免静默产生错误上下文。

### Redis/内存缓存丢失

如果未来引入 Redis 或内存缓存，只能作为 active-run cache。

长期事实仍应是：

```text
messages / message_events
agent_events
hitl_requests
runs
threads
optional latest checkpoint small state
```

缓存丢失后可以从 messages 构建新 run，但不能承诺原地 resume checkpoint。

## 代码改动边界

### Checkpointer

主要文件：

- `src/main/checkpointer/prisma-saver.ts`
- `src/main/checkpointer/runtime-checkpointer.ts`
- `src/main/checkpointer/storage-codec.ts`

职责变化：

- `checkpoint_blobs` 只处理 non-message channels。
- `messages` channel 交给 message state repository。
- `getTuple()` 对 LangGraph 透明恢复完整 messages。

### Message persistence

建议新增：

- `src/main/db/message-events.ts`
- `src/main/db/message-state-versions.ts`
- `src/main/db/messages.ts`

职责：

- append message events
- update messages projection
- rebuild messages array for checkpoint version
- rebuild search index

### Thread service

主要文件：

- `src/main/threads/service.ts`

职责变化：

- thread hydrate 从 `messages` projection 读取历史。
- checkpoint 只用于 pending runtime state/fork state/todos 等。

### Agent service

主要文件：

- `src/main/agent/service.ts`
- `src/main/agent/runtime-state.ts`

职责变化：

- edit last user message 改读 messages projection。
- `extractMessagesFromCheckpoint` 保留给兼容和测试，但不再是产品历史主路径。

## 验收标准

功能验收：

- 新 thread 正常聊天。
- 长任务不会在 `checkpoint_blobs` 生成新的 `messages` row。
- 刷新页面后历史完整显示。
- 搜索仍能找到历史消息。
- HITL interrupt 后可以 approve/reject 并 resume。
- 编辑最后一条 user message 后重新运行正常。
- tool call / tool result 顺序合法。

存储验收：

- `checkpoint_blobs` 中 `channel = "messages"` 对新 run 为 0。
- `message_state_versions` 每个 checkpoint messages version 有记录。
- `messages` projection 和 reconstructed messages state 可校验一致。
- 长任务数据库增长主要来自新增消息本身和事件，而不是重复 snapshot。

性能验收：

- `getTuple()` 重建 latest messages 的耗时可接受。
- 长 thread 可以通过 summary/recent window 控制 provider input。
- message_events 可 compact，避免无限增长。

## 最终状态

最终边界应为：

```text
checkpoint_blobs
  LangGraph small value/schema state
  不存完整 messages history

message_events
  messages channel 的事实流
  可重建任意被保留的 message state version

messages
  当前 UI/search projection

message_state_versions
  LangGraph channel_versions.messages -> Openwork message state boundary

agent_events
  trace / audit / runtime process events
```

一句话总结：

`messages` 不是普通 checkpoint value。它是 Openwork 的核心长期事实流，checkpoint 只应该保存它的版本边界，并在运行恢复时由 Openwork 重建给 LangGraph 使用。
