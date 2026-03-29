# Message Tree Branching OKR

## 目标

为 Openwork 建立一套以后端为事实源的消息树体系，使聊天系统同时具备：

- 正确的 `retry` 语义
- 可切换的消息分支能力
- 面向未来 `edit user message` / `/btw` 等新指令的统一扩展基础
- 前端展示路径、持久化路径、发送给大模型的路径三者一致

这次设计不再接受以下方案：

- 不再把 `active_in_path` 放进 `messages` 表
- 不再让 renderer 生成 canonical `message_id`
- 不再使用 `checkpoint:${threadId}:${index}:${role}` 这类 fallback 作为正式消息身份
- 不再保留 `MessageBubble` 这层消息壳组件

## OKR

### Objective

建立一套生产可用的消息树与 replay 机制，让 `retry`、分支切换、未来 `edit` 和 `/btw` 都复用同一套后端语义，而不是各自拼接特殊逻辑。

### Key Results

1. `retry` 后不会新增重复的 user message，同一个 user 节点下产生多个 assistant sibling。
2. 前端左右切换基于真实 sibling 分支展示，默认加载最后一个叶子路径。
3. 前端当前展示的消息路径，与后端压缩后发送给模型的消息路径完全一致。
4. 所有 canonical `message_id` 均由主进程生成并持有，renderer 不再生成正式消息 id。
5. assistant / tool message 在框架层获得稳定 id，checkpoint 提取阶段不再依赖 fallback id。
6. `Messages.tsx + message.tsx` 成为唯一消息展示体系，`MessageBubble.tsx` 删除。

## 范围

### 本次范围

- 消息树模型
- retry / branch 的统一语义
- renderer 与 main 之间的消息 id 边界
- LangChain / LangGraph message id 挂载机制
- 统一消息 UI 组件体系

### 非本次范围

- 多窗口共享分支选择
- branch selection 持久化到数据库
- 完整 edit UI
- `/btw` 的产品交互细节

## 整体设计

## 一、设计原则

### 1. 后端拥有事实，后端拥有 canonical id

消息树、checkpoint、retry、replay 都在主进程主导，因此 canonical `message_id` 由主进程生成。

renderer 可以拥有临时 UI 标识，但不能拥有正式消息身份。

### 2. 视图状态不污染消息事实

`messages` 表只表达消息树本身，不表达当前窗口正在看哪条路径。

branch selection 是窗口级临时视图状态，不入库。

### 3. 同一条路径必须贯穿 UI 和模型输入

当前窗口选中的 leaf 决定：

- 前端实际展示的消息路径
- 发送给模型前压缩和裁剪时使用的消息路径
- 后续继续对话时的 parent / replay 基点

这三者必须由同一个 path projection 结果驱动。

## 二、核心语义

### 1. retry

- 语义：同一个 user 输入，重新生成 assistant 输出
- 树结构：复用原 user 节点，生成新的 assistant sibling
- 结果：不会出现两个内容相同的 user message

### 2. edit

- 语义：用户输入发生变化
- 树结构：在原 user 的父节点下新建一个 user sibling，再生成新的 assistant 子树

### 3. /btw

- 语义：新的用户意图，只是输入形式是 command
- 树结构：本质是新的 user message，允许带 command metadata

## 三、数据边界

### 1. messages 表

建议 `messages` 只保留 canonical tree 字段：

- `message_id`
- `thread_id`
- `run_id`
- `parent_message_id`
- `role`
- `kind`
- `content`
- `tool_calls`
- `tool_call_id`
- `name`
- `seq`
- `checkpoint_id`
- `created_at`
- `updated_at`

明确删除或不再使用：

- `active_in_path`

### 2. checkpoint 的职责

checkpoint 只负责 replay 和恢复运行时，不再承担消息树身份生成职责。

checkpoint 中的 message 必须带上我们自己的稳定 id，持久化层只提取，不再猜测。

### 3. branch selection 的职责

branch selection 不入库，只存在窗口本地。

窗口本地只维护一个状态：

- `selectedLeafMessageId`

默认策略：

- 加载 thread 后，选“最后一个可见叶子”
- 通过 `selectedLeafMessageId` 反向回溯整条 ancestor path

## 四、ID 设计

### 1. canonical message id

所有正式消息 id 都由主进程生成：

- 新 user message：主进程生成
- retry：不生成新的 user id
- edit：主进程生成新的 user id
- assistant message：主进程在框架层生成
- tool message：主进程在框架层生成

### 2. client request id

renderer 可以生成临时 `client_request_id` 用于 optimistic UI 对齐，但它不能进入消息树，也不能进入 checkpoint 语义。

### 3. ack 机制

发送消息后，renderer 不需要等模型返回。

流程应为：

1. renderer 发起发送意图，携带 `client_request_id`
2. main 立即生成 canonical `user_message_id`
3. main 立即回 `message_ack`
4. renderer 把 pending bubble 对齐到真实 user 节点
5. agent stream 正式开始

这里等待的是本机主进程分配 id，不是等待模型响应。

## 五、框架层实现

### 1. user message

主进程在发起 invoke / edit 时构造：

```ts
new HumanMessage({
  id: canonicalUserMessageId,
  content
})
```

### 2. assistant message

新增一个 `OpenworkMessageIdsMiddleware`，挂在 `wrapModelCall`。

职责：

- 在模型返回 `AIMessage` 后，为其补全 canonical `id`
- 保证进入 LangGraph 状态树的是带稳定 id 的 assistant message

### 3. tool message

同一个 `OpenworkMessageIdsMiddleware` 挂在 `wrapToolCall`。

职责：

- 在 tool 执行结果返回 `ToolMessage` 前，为其补全 canonical `id`
- 保证 tool result 也是正式树节点，而不是临时运行时对象

### 4. checkpoint 提取

`extractMessagesFromCheckpoint()` 只认稳定 id。

正式顺序：

1. `kwargs.id`
2. 不接受基于索引的 fallback

`tool_call_id` 只用于 tool linkage，不再兼职 message identity。

## 六、路径投影

需要一个共享的 path projection 能力：

```ts
collectPathFromLeaf(messages, selectedLeafMessageId)
```

它的输出同时服务于：

- renderer 展示
- retry 目标计算
- 压缩前的 message path 选择
- 后续继续对话时的 parent 计算

这样可以保证“用户看到的路径”和“模型真正吃到的路径”一致。

## 七、前端展示层

前端消息体系统一为：

- `Messages.tsx`
- `message.tsx`

职责划分：

- `message.tsx`
  只做消息原语和样式结构
- `Messages.tsx`
  负责树路径投影、branch selector、retry/copy、tool/hitl block 组装

明确删除：

- `MessageBubble.tsx`

tool 样式、采纳/拒绝、toolbar 都迁移到新的消息结构体系里。

## 八、动作流设计

### 1. 新发消息

输入：

- `client_request_id`
- `content`
- `selected_leaf_message_id`

后端动作：

- 生成 canonical user id
- 计算 parent
- ack 给前端
- 从当前 leaf 对应路径继续运行

### 2. retry

输入：

- `retry_target_user_message_id`
- `selected_leaf_message_id`

后端动作：

- 不生成新的 user id
- 找到目标 user 节点对应 replay 基点
- 复用原 user id 重新运行
- 生成新的 assistant sibling

### 3. edit

输入：

- `target_user_message_id`
- `selected_leaf_message_id`
- `new_content`

后端动作：

- 生成新的 user id
- 挂到原 user 的父节点下
- 从共同父级 replay
- 长出新的 assistant 子树

## 验收标准

## 一、功能验收

### 1. 新消息

- 用户发送消息后，UI 立即出现 pending user bubble
- 收到主进程 ack 后，pending bubble 对齐成正式 user 节点
- 最终落库的 user message id 来自主进程，不来自 renderer

### 2. retry

- 对最后一个 assistant 点击 retry
- 数据库中不会新增重复 user message
- 同一个 parent 下出现多个 assistant sibling
- UI 出现左右切换按钮

### 3. branch 切换

- 切换左右分支时，不写数据库
- 当前窗口展示路径发生变化
- 再次发送消息时，后端使用当前窗口选中的 leaf 作为继续对话基点

### 4. 重新加载

- 重新加载 thread 后，默认命中最后一个叶子
- 展示的路径能从 leaf 回溯得到完整 ancestor path

### 5. 模型输入一致性

- 当前窗口看到的 messages
- 压缩后送给模型的 messages
- 后续继续对话的 parent path

三者必须可证明来自同一个 path projection 结果。

## 二、数据验收

- `messages` 表中不存在 `active_in_path` 语义依赖
- 每条消息都有稳定 `message_id`
- `parent_message_id` 能构成有效树结构
- checkpoint 提取阶段不再生成 `checkpoint:${threadId}:${index}:${role}` 这类 id

## 三、工程验收

- `MessageBubble.tsx` 删除
- `Messages.tsx` 不再依赖旧 bubble 壳
- retry / path projection / message id 生成有最小测试覆盖

最少应覆盖：

1. `retry` 不新增 user message
2. assistant sibling 能正确形成 branch
3. `collectPathFromLeaf()` 输出与 UI 展示一致
4. 压缩前输入路径与 UI 路径一致

## 四、上线判定

满足以下条件才算可上线：

1. 功能验收全部通过
2. 数据验收全部通过
3. 旧的 fallback id 逻辑已删除
4. 旧的 `MessageBubble` 体系已删除
5. retry / branch / 压缩路径一致性已有可重复验证步骤
