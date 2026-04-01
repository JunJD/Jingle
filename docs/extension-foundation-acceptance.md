# Extension Foundation 验收口径

## 结论先行

第一段基建不要按“功能列表打勾”验收，要按四道门验收：

1. `contract` 是否成立
2. `demo path` 是否跑通
3. `auto-check` 是否存在
4. `failure semantics` 是否清楚

只要四道门里缺一门，就不算真的完成。

## 总体验收原则

### 一、contract 验收

判断标准：

- 是否存在共享类型和共享 manifest
- renderer / main / assistant 是否都从同一个 contract 出发
- 是否还能绕开 contract 走私有接线

不通过的典型信号：

- 还有平行 registry
- 还有页面私有配置读取
- 还有 `window.xxx` 式隐式大对象

### 二、demo 验收

判断标准：

- 必须用真实 case 跑，不接受“类型看起来可以”
- 每层都至少要有一个 first-party fixture 去证明

### 三、auto-check 验收

判断标准：

- 启动期校验
- 类型约束
- 最小单测或集成测试

至少要做到：

- 错 manifest 启动就报错
- 越权 capability 启动或调用时就报错
- substrate 读写有自动回归测试

### 四、failure semantics 验收

判断标准：

- 缺配置时怎么失败
- 缺 capability 时怎么失败
- action 执行失败时怎么反馈
- background job 失败时怎么记录

要求：

- 失败必须显式
- 失败必须可定位
- 不能靠吞错把问题藏掉

## 推荐的验收样例集

不要空讲平台，先固定 5 个样例 extension。

### 样例 A：`ai`

覆盖：

- `launcher-view`
- `assistant-tool`
- `preferences`
- `secrets`
- 高 capability host

### 样例 B：`translate`

覆盖：

- `launcher-view`
- `no-view`
- `rpc`
- `primary/secondary actions`

### 样例 C：`quick-notes`

覆盖：

- `menu-bar`
- `storage`
- `cache`

### 样例 D：`calendar-sync`

覆盖：

- `background-job`
- `supportPath`
- 定时执行和失败记录

### 样例 E：`pure-tool`

覆盖：

- 无页面
- 只有 `assistant-tool`
- capability 最小集

如果这 5 个样例跑不通，说明基建还没成立。

## 分项验收

## 1. `extension manifest v1`

### contract 验收

必须满足：

- 存在共享 `OpenworkExtensionManifest`
- 至少包含：
  - `id`
  - `role`
  - `entries`
  - `capabilities`
  - `preferences?`
  - `storage?`
  - `skills?`
- `AI` 和 `translate` 已迁到新 manifest
- renderer / main / assistant 不允许再手写平行注册表

### demo 验收

手工演示至少包括：

1. 新增一个最小 extension，只改 manifest + adapter 就能被发现
2. 改掉一个 entry id，系统启动时直接报错
3. 删除一个 adapter 实现，系统启动时直接报错

### auto-check 验收

必须有：

- manifest schema/type 校验
- 启动期唯一性校验：
  - `extension.id`
  - `entry.id`
  - `assistant-core` 唯一
- manifest 与 renderer/main adapter 对齐校验

### failure semantics 验收

报错必须能直接指出：

- 哪个 extension
- 哪个字段
- 为什么无效

### 通过线

满足下面 4 条才算过：

- manifest 成为唯一事实源
- `AI` 和 `translate` 已迁移
- 启动期坏配置会硬失败
- 没有旧 authoring path 继续被新增使用

## 2. `entry taxonomy`

目标类型：

- `launcher-view`
- `no-view`
- `menu-bar`
- `assistant-tool`
- `background-job`

### contract 验收

必须满足：

- 每个 entry 必须显式声明 `kind`
- route / executor / scheduler / assistant projection 都按 `kind` 分发
- 不允许再靠页面组件类型或散落 if/else 猜 entry 行为

### demo 验收

五种 entry 都要有样例：

1. `launcher-view`：能打开 UI 并返回
2. `no-view`：执行后有明确结果反馈
3. `menu-bar`：能在后台常驻并响应状态变化
4. `assistant-tool`：assistant 能发现并调用
5. `background-job`：能被调度并产生运行记录

### auto-check 验收

必须有：

- 不支持的 `kind` 启动时报错
- 缺少所需字段时报错
- 调度器不会错误拉起 `launcher-view`
- assistant 不会误消费非 `assistant-tool`

### failure semantics 验收

必须定义清楚：

- `no-view` 的执行失败如何反馈
- `menu-bar` 初始化失败是否降级
- `background-job` 失败是否重试、是否记日志
- `assistant-tool` 缺参数时如何返回结构化错误

### 通过线

只有当五种 kind 都各有一个真实 case 跑通，才算过。

## 3. `preferences / storage / supportPath / cache / secrets`

### contract 验收

必须满足：

- manifest 可声明 preferences schema
- host 提供统一 substrate API
- 数据作用域至少按 `extension-id` 隔离
- 明确区分：
  - `preferences`
  - `storage`
  - `cache`
  - `supportPath`
  - `secrets`

### demo 验收

至少跑这几条：

1. required preference 未填写时，entry 不允许执行
2. extension A 写入 storage，extension B 读不到
3. cache 可清除，不影响 storage
4. `supportPath` 稳定可读写
5. secret 不出现在普通设置导出和日志里

### auto-check 验收

必须有：

- preference 默认值与 schema 回归测试
- storage/cache 作用域隔离测试
- supportPath 创建与路径稳定性测试
- secret 读写测试

### failure semantics 验收

必须清楚：

- 缺 preference 是阻塞执行，还是弹 setup
- secret 缺失时报什么错
- cache 失效后如何回源
- supportPath 无权限或损坏时怎么报错

### 通过线

只要 extension 还在自己读全局 `settings.json`、自己拼私有路径、自己往 renderer localStorage 随便写，就不算过。

## 4. `action runtime`

### contract 验收

必须满足：

- 有共享 action 对象协议
- 区分 `primary` 和 `secondary actions`
- action 由统一 runtime 分发，不由页面各自写 click handler

第一版至少支持：

- open entry
- copy
- remove/delete
- pin/favorite
- reveal/open settings

### demo 验收

至少证明同一套 action runtime 能驱动：

1. root search item
2. history item
3. extension item

并且至少有一个对象带：

- primary action
- 两个以上 secondary actions

### auto-check 验收

必须有：

- action id 唯一性校验
- action dispatch 测试
- disabled / hidden 状态测试
- action context 透传测试

### failure semantics 验收

必须清楚：

- action 执行失败如何反馈
- destructive action 是否需要确认
- 后台 action 是否显示完成状态

### 通过线

如果“更多操作”还只是每个页面自己画一个按钮、自己绑定事件，这层就没过。

## 5. `capability-gated host`

### contract 验收

必须满足：

- 所有 capability 都必须 manifest 显式声明
- host 只注入声明过的能力
- main-side RPC 方法必须与 manifest 对齐

建议 capability 第一版至少有：

- `navigation`
- `surface`
- `clipboard`
- `rpc`
- `threads`
- `workspace`
- `preferences`
- `storage`
- `secrets`

### demo 验收

至少要跑这几条负例：

1. 没声明 `clipboard` 的 extension 读 clipboard，直接报错
2. 声明了 `rpc` 但没实现方法，启动时报错
3. 实现了未声明的 rpc 方法，启动时报错
4. 低 capability extension 无法访问高 capability host

正例也要有：

5. 声明了 capability 的 extension 可以正常调用

### auto-check 验收

必须有：

- capability 注入矩阵测试
- 越权调用测试
- manifest/rpc 对齐测试

### failure semantics 验收

错误必须直接说明：

- 哪个 extension
- 调用了哪个 capability
- 为什么被拒绝

### 通过线

只要 extension 还能通过某个全局对象、隐藏 context 或私有 import 绕过 capability gate，这层就不算过。

## 总体验收门槛

这五块不是分别勾完就算结束，还要过一个整体门槛。

### 整体验收必须同时满足

1. 5 个样例 extension 全部跑通
2. 至少 10 个负例校验能稳定报错
3. `AI` 与 `translate` 已迁到新 contract
4. 没有新增旧写法
5. assistant 已经至少能消费一个 `assistant-tool`

## 我建议的阶段出口

### Phase A 出口

范围：

- `manifest v1`
- `entry taxonomy`

出口条件：

- `AI` / `translate` 迁移完成
- 五种 entry kind 至少各跑通一个样例

### Phase B 出口

范围：

- `preferences / storage / supportPath / cache / secrets`
- `capability-gated host`

出口条件：

- substrate 与 capability 负例测试全部通过
- 没有 extension 继续走私有配置路径

### Phase C 出口

范围：

- `action runtime`

出口条件：

- root search / history / extension item 统一切到 action runtime

## 最后的硬标准

如果你想要一句最硬的验收定义，就是这个：

`新增一个 extension 时，只需要写 manifest + entry implementation；系统会自动发现、自动校验、自动注入能力；一旦越界或缺配置，系统会在启动期或调用期给出明确错误。`

只有做到这句，第一段基建才算真的过线。
