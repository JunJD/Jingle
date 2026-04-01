# Next Seam: Entry First

## 结论

下一步最该先动的是 `entry` 层。

更准确地说：

`先把 entry 从“页面入口”改成“带类型的入口”；manifest 只做最小配套改动，host 和 rpc 先不动。`

## 为什么先动 `entry`

当前系统里，真正卡住继续演进的地方，不是 capability host，也不是 main RPC，而是：

`entry 仍然被硬编码成一个 React 页面。`

证据很直接：

- shared manifest 里的 entry 现在只有 `id`，没有 entry kind，见 [src/shared/launcher-plugin.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/shared/launcher-plugin.ts#L11)
- renderer entry definition 强制要求 `Component`，见 [src/renderer/src/launcher/pages/types.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/launcher/pages/types.ts#L66)
- built plugin authoring 也强制每个 entry 都提供 `Component + viewport`，见 [src/renderer/src/launcher/built-plugins/sdk.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/launcher/built-plugins/sdk.ts#L39)

这三处合在一起，实际表达的是：

`当前 entry = launcher view`

所以只要这层不拆开，后面你想引入：

- `no-view`
- `menu-bar`
- `assistant-tool`
- `background-job`

都会被迫塞进“伪页面”模型里。那不是扩展平台，只是页面平台。

## 为什么不是 `manifest`

`manifest` 现在的问题不是“不存在”，而是“还太薄”。

它已经承担了真实边界职责：

- capability 声明
- default entry
- entry 去重
- rpc 声明与 capability 对齐

见 [src/shared/launcher-plugin.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/shared/launcher-plugin.ts#L15) 和 [src/shared/launcher-plugin.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/shared/launcher-plugin.ts#L36)。

但如果现在只先扩 manifest，比如先加一堆 `entry.kind`、`preferences`、`outputs` 字段，而 renderer runtime 仍然要求每个 entry 都是 `Component + viewport`，那 manifest 只会变成“更丰富的注释”，不会变成真正生效的 contract。

所以：

`manifest 不该单独先动；它应该作为 entry taxonomy 的最小配套一起动。`

## 为什么不是 `host`

`host` 是当前最成熟、最不该先碰的一层。

它现在已经满足三个好条件：

- shell 按 manifest capability 注入能力
- 插件按 hook 读取能力
- 未声明 capability 时硬失败

见 [src/renderer/src/launcher/LauncherPluginHost.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/launcher/LauncherPluginHost.ts#L49) 和 [src/renderer/src/launcher/LauncherPluginHost.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/launcher/LauncherPluginHost.ts#L83)。

如果现在先扩 host，结果通常会是：

- 多加几个 hook
- 多塞几块上下文
- 但 entry 还是页面入口

这会让 host 先膨胀，而不是让平台先收口。

所以：

`host 现在应该被冻结，当作稳定底座；等 entry taxonomy 立起来，再判断哪些 entry kind 真需要新的 host 能力。`

## 为什么不是 `rpc`

`rpc` 现在确实很薄，但它还不是第一堵墙。

当前 RPC 至少已经有一条清楚的约束链：

- manifest 声明方法名
- main service 必须逐项实现
- capability 和 service 不匹配时启动报错

见 [src/main/services/built-plugins/index.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/services/built-plugins/index.ts#L25)。

它的问题是：

- 还只是 transport
- 还不是 work model
- 还没有 approvals / outputs / checkpoints

但这些都应该建立在“入口类型先被定义清楚”之后。否则你不知道是在为：

- `launcher-view`
- `no-view command`
- `assistant-tool`
- `background-job`

哪一种执行语义设计 RPC。

所以：

`先补 rpc 会过早进入执行细节；先补 entry 才知道执行模型该怎么长。`

## 这一步的最小改动边界

这一步只应该做成下面这个量级：

1. shared manifest entry 从只有 `id`，变成 `id + kind`
2. renderer entry definition 从单一页面结构，变成按 `kind` 分流
3. 第一阶段只显式支持 `launcher-view`
4. 第二阶段再加第一个非页面 entry，优先建议 `no-view`

也就是先把系统从：

`entry = page`

改成：

`entry = typed unit`

而不是一口气把五种 entry 全做完。

## 这一小步的验收线

只要做到下面 4 条，这一步就算过：

- `manifest.entries[]` 里能显式写出 entry kind
- `launcher-view` entry 仍然保持现在的行为
- 类型层禁止 `no-view` 继续要求 `Component + viewport`
- host 和 rpc 在这一阶段不需要跟着重构

## 下一步应该怎么做

下一步不要直接做完整 extension platform。

只做一个很小的结构改动：

- 给现有 entry 补 `kind: "launcher-view"`
- 把 `LauncherPluginEntryDefinition` 改成 discriminated union
- 把 `BuiltLauncherPluginEntrySpec` 改成同样的 union

这一步做完，你们才算第一次从：

`launcher page plugin`

往：

`typed extension entry`

迈出去。
