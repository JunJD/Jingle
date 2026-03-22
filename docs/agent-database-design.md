# Agent 数据库设计

## 背景

当前 `openwork` 的 agent 数据已经统一到：

- 一个 SQLite 文件：`~/.openwork/openwork.sqlite`
- 一个访问层：`Prisma`
- 一个 checkpoint saver：自定义 Prisma-backed saver

迁移原则：

- 不在运行时自动建表或自动迁移
- 所有 schema 变化都通过 `prisma/migrations/*/migration.sql` 落库
- 本地开发改动 `prisma/schema.prisma` 后，必须生成新的 migration 文件

当前的重点不再是兼容旧路径，而是把统一后的模型定清楚，支撑 3.2 的 `sessionKey -> thread` 绑定。

## 核心概念

### Thread

`Thread` 是真实的 agent 会话实体。

它代表：

- 一条独立对话线
- 一份独立的 LangGraph checkpoint 历史
- 一个独立的 workspace/model/runtime 上下文

`thread_id` 是物理会话 ID。  
checkpoint、消息恢复、tool 状态、HITL 状态都最终归属于 `thread_id`。

### SessionKey

`sessionKey` 不是会话本身，它是逻辑归属键。

它代表：

- “当前这个 workspace，默认应该落到哪条 thread 上”

它的作用是：

- 只区分不同 workspace
- 让 launcher / 主界面 / 以后其他入口，稳定找到同一个 workspace 主会话
- 允许以后 reset/new conversation 时，保留逻辑入口不变，但切换到底层新的 `thread_id`

本项目里：

- session 本身仍然独立
- `sessionKey` 只是它上面那层稳定索引

### Assistant

`Assistant` 当前只保留为未来多 agent / preset 能力的扩展位，不进入这次主链设计。

这意味着：

- 统一存储先围绕 `Thread / sessionKey / Checkpoint` 建模
- `assistants` 表只保留扩展位，不作为 3.2 的前置依赖
- 如果以后真的做多 agent，再让 `Run` 去关联 `Assistant`

当前主关系先收敛成：

- `Thread 1 -> N Run`
- `Thread 1 -> N Checkpoint`
- `sessionKey 1 -> 1 current Thread`

## 设计原则

1. 一个物理库。
2. checkpoint 继续是一级公民，不降级成附属 JSON 字段。
3. `Thread` 和 `sessionKey` 解耦。
4. `Assistant` 只作为扩展位保留，不进入当前主链。
5. 不再保留旧 checkpoint 路径和 fallback 逻辑。

## 目标存储结构

统一后的主库仍然是：

- `~/.openwork/openwork.sqlite`

Prisma 负责访问这一个文件。  
checkpoint 也直接落在这个主库里。

## 目标表设计

### 1. `threads`

职责：

- thread 元数据
- workspace/model/title/status

建议字段：

- `thread_id TEXT PRIMARY KEY`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`
- `metadata TEXT`
- `status TEXT NOT NULL`
- `thread_values TEXT`
- `title TEXT`

说明：

- `metadata` 先继续存 JSON 字符串
- `workspacePath`、`model` 仍先放在 `metadata` 中

### 2. `runs`

职责：

- 一次 agent 执行的生命周期

建议字段：

- `run_id TEXT PRIMARY KEY`
- `thread_id TEXT NOT NULL`
- `assistant_id TEXT`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`
- `status TEXT`
- `metadata TEXT`
- `kwargs TEXT`

说明：

- 继续保留，方便后续补运行诊断和运行历史
- 当前主链虽然没充分用上，但它在概念上是对的

### 3. `assistants`

职责：

- 可复用 assistant 定义

建议字段：

- `assistant_id TEXT PRIMARY KEY`
- `graph_id TEXT NOT NULL`
- `name TEXT`
- `model TEXT`
- `config TEXT`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`

说明：

- 当前先保留，不把它和 thread 强绑定
- 当前主链可以只有默认 assistant

### 4. `session_bindings`

职责：

- `sessionKey -> current_thread_id` 的稳定映射

建议字段：

- `session_key TEXT PRIMARY KEY`
- `workspace_key TEXT NOT NULL`
- `workspace_path TEXT NOT NULL`
- `current_thread_id TEXT NOT NULL`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`
- `metadata TEXT`

说明：

- 这是 3.2 最关键的新表
- `sessionKey` 是逻辑入口
- `current_thread_id` 是当前指向的真实会话
- 以后 reset/new conversation 时，只需要改这个映射

### 5. `checkpoints`

职责：

- LangGraph checkpoint 主状态

建议字段：

- `thread_id TEXT NOT NULL`
- `checkpoint_ns TEXT NOT NULL DEFAULT ''`
- `checkpoint_id TEXT NOT NULL`
- `parent_checkpoint_id TEXT`
- `type TEXT`
- `checkpoint TEXT`
- `metadata TEXT`
- `PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)`

说明：

- 不把 checkpoint 打散进别的表
- 这是恢复现场的权威数据

### 6. `writes`

职责：

- LangGraph pending writes / 中间写入记录

建议字段：

- `thread_id TEXT NOT NULL`
- `checkpoint_ns TEXT NOT NULL DEFAULT ''`
- `checkpoint_id TEXT NOT NULL`
- `task_id TEXT NOT NULL`
- `idx INTEGER NOT NULL`
- `channel TEXT NOT NULL`
- `type TEXT`
- `value TEXT`
- `PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)`

说明：

- `writes` 和 `checkpoints` 一起构成恢复执行现场的权威状态

## 为什么不把 checkpoint 做成单独 JSON 字段

不建议把 checkpoint 全塞进 `threads.metadata` 或者某个单列表里。

原因：

- LangGraph checkpoint 是一串有父子关系的状态快照
- `writes` 也是恢复执行现场的一部分
- 把它们塞成单 blob 后，后续调试、恢复、清理都会更差

所以这里的原则是：

- 统一物理库
- 但不牺牲 checkpoint 结构

## `Assistant` 和 `Thread` 的关系结论

明确结论：

- `Assistant` 当前不是 `Thread` 的父实体
- `Thread` 也不从属于某个 `Assistant`
- 如果以后启用多 agent，合理关系仍然是 `Run` 把两者连起来

也就是：

- `Thread` = 对话实例
- `Assistant` = 未来可选的配置模板
- `Run` = 某次执行，必要时连接 `Thread` 和 `Assistant`

即便未来启用 `Assistant`，也不建议走“一个 assistant 下挂很多 thread”，因为：

- 同一条 thread 以后可能切模型
- 同一条 thread 未来可能切 runtime preset
- 真正执行时的 assistant 配置应该体现在 run 上

## `sessionKey` 的建议格式

当前先不要引入 `channel`、`surface`、`entrypoint` 这些额外维度。

第一版只围绕 workspace：

- `agent:main:workspace:<workspaceKey>:main`

其中：

- `agent:main`：保留未来扩展空间
- `workspaceKey`：由 `workspacePath` 派生出的稳定 key
- `main`：这个 workspace 的默认主会话

说明：

- 现在不把 launcher 单独拆成另一种 key
- launcher 只是进入同一个 workspace 主会话的快捷入口

## `workspaceKey` 的建议

不要直接把原始路径塞进 key。

建议：

- 保留原始 `workspace_path`
- 另外生成一个稳定 `workspace_key`

推荐做法：

- 规范化绝对路径
- 转小写处理仅在 Windows 做
- 再做 hash 或 slug

这样：

- key 更短
- 不暴露完整路径
- 迁移和索引更稳定

## 与当前 runtime 的对应关系

当前 runtime 依赖：

- `thread_id`
- `thread.metadata.workspacePath`

所以统一存储后的最小方案是：

- runtime 继续按 `thread_id` 工作
- workspace 仍先从 `thread.metadata.workspacePath` 读取
- `session_bindings` 只负责在进入时把 `sessionKey` 解析到 `thread_id`

也就是说：

- 先不重写 agent runtime 协议
- 只先把底层存储和入口绑定统一

## 3.2 的数据库流程

launcher 进入 AI 页时：

1. 读取默认 workspace path
2. 计算 `workspaceKey`
3. 生成 `sessionKey`
4. 查询 `session_bindings`
5. 如果存在：
   - 取 `current_thread_id`
6. 如果不存在：
   - 创建新 `thread`
   - 把 `workspacePath` 写进 thread metadata
   - 创建一条 `session_bindings`
7. 把 launcher 输入写入该 thread 的 `draftInput`

这样 3.2 就不需要重新发明一套 session 逻辑。

## 不直接复制竞品的表复杂度

竞品里出现大量表并不代表当前也要一次性照抄。

对 `openwork` 来说，更合理的是拆成两层：

- 核心事务层：真正代表业务真相，未来迁后端时也尽量原样保留
- 派生索引层：为了 FTS、向量检索、缓存、性能优化而存在，未来最容易替换

收敛原则是：

- 先把核心事务层定清楚
- 不把 FTS / embedding / cache 当成第一层数据模型
- 不让 checkpoint 承担检索层职责

## 当前代码里的真相分布

当前代码里有两个事实要正视：

- agent 恢复现场依赖 `checkpoints / writes`
- renderer 读历史消息、todos、HITL 时，实际是从最新 checkpoint 的 `channel_values` 里恢复

这意味着现在的 checkpoint 更像“执行现场真相”，但它不是一个适合查询、搜索、记忆提取、后端同步的业务模型。

所以后续要补的是：

- 保留 checkpoint 作为 runtime truth
- 新增 query-friendly 的 message / memory 模型

## 建议的核心事务层

为了同时满足“现在先落地”和“以后迁后端”，建议把核心事务层控制在下面这些表：

### 1. `threads`

继续保留。

职责：

- 对话主实体
- metadata / title / status
- 与 checkpoint、messages、runs、memory 建立归属关系

### 2. `session_bindings`

继续保留。

职责：

- `sessionKey -> current_thread_id`
- 让同一个 workspace 稳定命中当前主会话

### 3. `runs`

继续保留。

职责：

- 一次 agent 执行
- 记录运行状态、参数、诊断信息

### 4. `checkpoints`

继续保留。

职责：

- LangGraph checkpoint 主状态
- 恢复执行现场的权威数据

### 5. `writes`

继续保留。

职责：

- LangGraph pending writes
- 与 checkpoint 一起构成恢复现场的权威数据

### 6. `messages`

建议现在就补。

职责：

- 面向展示、搜索、历史、同步的消息日志
- 不再让 UI 只能从 checkpoint 反推消息

建议字段：

- `message_id TEXT PRIMARY KEY`
- `thread_id TEXT NOT NULL`
- `run_id TEXT`
- `role TEXT NOT NULL`
- `kind TEXT NOT NULL`
- `seq INTEGER NOT NULL`
- `parent_message_id TEXT`
- `tool_call_id TEXT`
- `name TEXT`
- `content_text TEXT`
- `content_json TEXT`
- `status TEXT NOT NULL`
- `usage_json TEXT`
- `created_at BIGINT NOT NULL`
- `updated_at BIGINT NOT NULL`

说明：

- `role` 解决 user / assistant / tool / system
- `kind` 解决 text / tool_call / tool_result / summary / hitl
- `seq` 解决线程内稳定排序
- `content_json` 保留完整结构
- `content_text` 便于 FTS 和简单检索
- `status` 可覆盖 streaming / completed / interrupted / failed

### 7. `memories`

建议现在就补，但先做最小版。

职责：

- 从消息中提炼出的可复用记忆
- 不和 embedding 强绑定

建议字段：

- `memory_id TEXT PRIMARY KEY`
- `workspace_key TEXT NOT NULL`
- `thread_id TEXT`
- `source_message_id TEXT`
- `type TEXT NOT NULL`
- `title TEXT`
- `summary TEXT NOT NULL`
- `content_json TEXT`
- `importance REAL NOT NULL DEFAULT 0`
- `status TEXT NOT NULL DEFAULT 'active'`
- `created_at BIGINT NOT NULL`
- `updated_at BIGINT NOT NULL`

说明：

- `type` 可以先支持 `fact / preference / summary / task / decision`
- `workspace_key` 是记忆归属的主维度
- `thread_id` 和 `source_message_id` 只做追溯，不做主键

## 建议的派生索引层

这些是未来大概率会需要，但不建议现在就放进“核心事务层”的：

- `messages_fts`
- `memory_chunks`
- `memory_embeddings`
- `provider_models_cache`
- `model_capabilities_cache`

原因：

- 这些表高度依赖具体实现
- 未来迁到后端、切向量库、切 FTS 引擎时最容易变化
- 它们应该由核心事务层派生，而不是反过来成为系统真相

## 面向未来后端化的收敛方式

如果以后数据要放后端，现在就不要把 SQLite / Prisma 当成业务协议本身。

更稳的做法是把存储层接口收敛成下面几组仓储：

- `ThreadStore`
- `SessionBindingStore`
- `RunStore`
- `MessageStore`
- `MemoryStore`
- `CheckpointStore`

约束是：

- 上层业务只依赖这些 store 接口
- Prisma 只是本地实现
- 以后换 HTTP / Postgres / hosted service，只替换 store 实现

这比先把所有表都设计得很大更重要，因为这才是真正决定“未来好替换”的边界。

## 当前落地状态

已经完成：

- 用 Prisma 替代原有元数据库访问层
- `checkpoints / writes` 已进入主库
- runtime 已切到 unified Prisma saver
- 不再保留 per-thread checkpoint 文件读写逻辑

## 这版设计刻意不做的事

- 不直接复制竞品那种几十张表的复杂度
- 不先把 FTS / embedding / cache 变成主数据模型
- 不先引入多入口 routing 维度
- 不先重写 assistant runtime 协议

原因是当前要先服务：

- 统一存储
- 3.2 sessionKey 绑定
- checkpoint 可恢复性
- 为 `messages / memories` 预留稳定核心模型

## 实施顺序建议

1. 写 Prisma schema
2. 写 unified DB 访问层
3. 替换 `threads` 元数据库访问
4. 写 Prisma-backed saver
5. 接 `session_bindings`
6. 补 `messages`
7. 补最小 `memories`
8. 再进入 launcher 3.2
9. 最后再做 FTS / embedding / 远端存储替换
