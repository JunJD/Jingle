# Assistant Extension Architecture

## 背景

我们已经把 launcher 的 first-party plugin 机制搭起来了，但产品语义还不完整。

当前真实诉求不是“再加几个 plugin page”，而是把能力体系理顺成：

- `AI` 是唯一主入口，是用户助理，是权限最高的 `assistant-core`
- 其他能力是围绕 `assistant-core` 组织的 `extensions`
- extension 不只服务人类页面，也要服务 assistant
- 有些 extension 可能只有 skill，没有页面
- assistant 侧的能力暴露至少有两条路：
  - `skill`：让 assistant 更会用能力
  - `mcp`：把能力作为协议能力对外暴露/接入

同时要保留一个重要前提：

- extension 不应该绕开现有 plugin 机制另起炉灶
- `assistant-core` 本身也应该先建立在 plugin 之上
- 就像 tiptap 的 extension 建立在 prosemirror plugin 之上

换句话说，`launcher plugin` 只是一个 human-facing surface，`extension` 才是产品能力模型。

## 现状

当前代码里已经有一个较稳定的 launcher plugin runtime primitive：

- 共享 manifest 在 [launcher-plugin.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/shared/launcher-plugin.ts)
- `AI` plugin manifest 在 [manifest.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/plugins/ai/manifest.ts)
- `translate` plugin manifest 在 [manifest.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/plugins/translate/manifest.ts)
- runtime 里 skill middleware 接线在 [runtime.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/agent/runtime.ts)

当前 agent runtime 对 skill 的处理也已经很明确：

- 不是传入一组 skill 对象
- 而是 `createSkillsMiddleware({ backend, sources })`
- `sources` 是若干个 skills 根目录
- middleware 会扫描 `source/<skill-name>/SKILL.md`
- 只把 skill metadata 注入 system prompt
- agent 真正需要完整 skill 时，再按 prompt 里的路径去 `read_file`

这意味着：

- skill 不只是 prompt 文本块
- skill 必须对 agent 的文件系统/backend 可读
- “把 extension 的 skill 直接塞成 JS 对象”不是当前 runtime 的自然路径

## 设计目标

这轮设计只回答 4 件事：

1. `plugin` 和 `extension` 的关系是什么
2. `assistant-core` 为什么和普通 extension 不同
3. `skill` 怎么从 extension 投影到 assistant runtime
4. 后续 `mcp` / `Jingle` 应该挂在哪一层

不做的事：

- 这轮不做 npm marketplace
- 这轮不做外部插件 loader
- 这轮不直接实现 MCP server/client
- 这轮不重写 deepagents runtime

## 核心模型

### 1. extension 是产品能力单元，launcher plugin 只是其中一个 surface

extension 负责表达“这个能力是给谁用、怎么用、能不能被 assistant 编排”。

其中 human-facing 的 launcher page 仍然复用现有 launcher plugin runtime 来承载。

launcher plugin 继续负责这些稳定问题：

- launcher route / entry
- 页面挂载
- host capabilities
- main-side rpc
- manifest 校验

也就是今天 [launcher-plugin.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/shared/launcher-plugin.ts) 这层要继续保留。

### 2. role 只表达主语义，不限制有没有页面或 skill

建议模型：

```ts
type OpenworkExtensionRole = "assistant-core" | "feature" | "tool"

interface OpenworkExtensionManifest {
  id: string
  role: OpenworkExtensionRole
  launcher?: LauncherPluginManifest
  skills?: OpenworkExtensionSkillSource[]
}
```

这里的关键点是：

- `role` 不决定 surface
- `feature` 可以同时有页面和 skill
- `tool` 可以只有 skill，没有页面
- `assistant-core` 也可以同时有页面和 skill

### 3. assistant-core 是 special extension，不是普通 plugin page

`AI` 不应该只是权限最大的 launcher plugin。

它应该是唯一的 `assistant-core`：

- 只能有一个
- 默认入口永远指向它
- `Tab` 主路径永远指向它
- 它拥有最高 host capability 集
- 它负责消费 extension 投影出来的 tool / skill

建议规则：

```ts
assistant-core:
  - exactly one
  - can own default launcher route
  - can consume extension skills
  - can orchestrate extension tools

feature:
  - human-first
  - may also expose skills/tools

tool:
  - agent-first
  - no launcher home entry by default
```

### 4. 第一版先只做 skill projection，launcher page 继续可选

第一版先不要把 extension surface 做太满。

先只保留两件事：

- `launcher?`
- `skills?`

这足够覆盖当前最重要的 3 类能力：

- `AI`：有 launcher，也有 skills
- `translate`：有 launcher，也可以有 skills
- 纯 skill extension：只有 skills，没有 launcher

## createSkillsMiddleware 调研结论

基于当前安装的 `deepagents@1.8.4` 和本地 runtime 接线，结论很明确。

### 1. 它吃的是 source 路径，不是 skill 对象

当前 openwork runtime 的调用在 [runtime.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/agent/runtime.ts)：

```ts
createSkillsMiddleware({
  backend,
  sources: skillSources
})
```

`createSkillsMiddleware` 的类型签名也是：

```ts
interface SkillsMiddlewareOptions {
  backend: BackendProtocol | BackendFactory
  sources: string[]
}
```

也就是说，skill 不是“作为对象数组传进去”，而是“作为目录结构被扫描出来”。

### 2. 目录结构是固定的

middleware 会扫描：

```text
<source>/
  <skill-name>/
    SKILL.md
```

`SKILL.md` 需要带 YAML frontmatter，至少要有：

- `name`
- `description`

还支持：

- `allowed-tools`
- `compatibility`
- `metadata`

### 3. middleware 只注入 metadata，不注入完整 skill 内容

它在 prompt 里只列出：

- skill name
- description
- allowed tools
- SKILL.md path

真正的完整说明仍然要靠 agent 自己再去 `read_file(<skill path>)`。

这点非常关键，因为它意味着：

- skill 文件路径必须对 agent 的 backend 可读
- 不能只在 renderer 或 JS 内存里“知道有这个 skill”

### 4. later source wins

同名 skill 冲突时，后面的 source 覆盖前面的 source。

这对我们很有用，因为可以做层级：

- openwork 默认 skill
- extension 生成 skill
- workspace skill
- 用户自定义 skill source

## 关键设计决策

### 决策 A：extension skill 第一版走“path-first”，生成只作为补充

这是第一版最合理的方案。

不要一上来做：

- 自定义 JS 注入 skill metadata
- 单独改造 deepagents middleware
- runtime 内存虚拟 skill registry

第一版优先做：

1. extension manifest 声明它提供哪些 skill source
2. 如果 skill 本来就是文件目录，直接把 source path 加到 `createSkillsMiddleware`
3. 只有在 skill 需要运行时生成时，才物化成 `SKILL.md`

这样有几个直接好处：

- 和 deepagents 的现有模型完全一致
- agent 可以直接 `read_file` 这些 skill
- 不需要改 `createSkillsMiddleware`
- 不需要改 filesystem tool
- reviewer 一眼能看懂链路

### 决策 B：skill source 必须和 filesystem backend 对齐

当前 runtime 里：

- filesystem middleware 用的是 `backend`
- skills middleware 也用的是 `backend`

这其实是一个隐藏但非常重要的约束：

- 如果 skills middleware 能看到 skill 文件
- 但 filesystem tool 看不到同一条路径
- agent 在 prompt 里看到 skill path 后，`read_file` 会失败

因此第一版不要把 extension skill 放到“只有 middleware 看得见”的私有内存里。

### 决策 C：第一版不做 StateBackend/CompositeBackend 虚拟 skill

`deepagents` 确实支持：

- `StateBackend`
- `CompositeBackend`

这意味着理论上我们可以：

- 把 extension skill 动态写进 state backend
- 再用 composite backend 挂到一个虚拟路径前缀

但这轮不该这么做。

原因不是做不到，而是没必要：

- 现在 skill 更适合先做成可见、可审计、可调试的真实文件
- 只有当我们明确需要“完全动态、无落盘”的 extension skill 时，才值得上 composite backend

### 决策 D：skill 默认服务 assistant-core，不要求 extension 一定有页面

skill 的产品语义不是“系统有一个技能库”，而是：

- assistant-core 预加载了这些 extension skill
- assistant 因此更知道何时用哪个 extension

也就是说：

- extension 提供 `agent.skills`
- assistant runtime 消费它们
- 不是每个 plugin page 自己去挂一个 skills middleware

## 推荐模型

### 1. Extension Manifest

建议新增一层 shared manifest：

```ts
type OpenworkExtensionRole = "assistant-core" | "feature" | "tool"

type OpenworkExtensionSkillSource =
  | {
      type: "path"
      rootDir: string
    }
  | {
      type: "generated"
      key: string
    }

interface OpenworkExtensionManifest {
  id: string
  role: OpenworkExtensionRole
  launcher?: LauncherPluginManifest
  skills?: OpenworkExtensionSkillSource[]
}
```

这里有三个边界要坚持：

- `launcher` 是可选 surface，不是 extension 的必选项
- 大 skill 不要内联进 TS
- `generated` 只留给确实需要运行时生成的 skill

### 2. Assistant Runtime Input

assistant runtime 不直接收“skill 内容对象”，而是先收“启用的 extension 集合”。

建议中间层：

```ts
interface ResolvedAssistantRuntimeInputs {
  enabledExtensions: OpenworkExtensionManifest[]
  resolvedSkillSources: string[]
  memorySources: string[]
}
```

这样 `createAgentRuntime()` 的职责就清楚了：

- 接收已经解好的 extension 集
- 把 extension skill source 解析成 runtime 可读路径
- 再喂给 `createSkillsMiddleware`

### 3. Skill Materialization

建议新增一个小而明确的步骤：

```ts
resolveEnabledExtensions()
  -> collectExtensionSkillSources()
  -> resolveExtensionSkillSources()
  -> createAgentRuntime()
```

第一版要区分两类 source：

#### path source

如果 extension 自己就带：

```text
skills/
  plan-work/
    SKILL.md
  code-review/
    SKILL.md
```

那就直接把 `skills/` 根目录解析成绝对路径，加到 runtime sources。

#### generated source

只有当 skill 需要运行时生成时，才物化到：

```text
~/.openwork/generated-skills/<extension-id>/<skill-name>/SKILL.md
```

然后把每个 `<extension-id>` 目录作为一个独立 source 传给 runtime。

例如：

```text
~/.openwork/generated-skills/ai-core/
  code-review/
    SKILL.md
  plan-work/
    SKILL.md

~/.openwork/generated-skills/translate/
  translation-policy/
    SKILL.md
```

这样传给 `createSkillsMiddleware` 的就是：

```ts
sources = [
  "~/.openwork/skills",
  "<extension-path>/ai/skills",
  "<extension-path>/translate/skills",
  "~/.openwork/generated-skills/some-generated-extension",
  "<workspace>/.openwork/skills",
  ...agentConfig.skillSources
]
```

这样做的好处：

- 大 skill 不需要复制或内联
- extension 之间边界清楚
- source 优先级清楚
- 只有 generated source 才需要清理生成目录

### 4. Skill Priority

建议优先级从低到高：

1. openwork 默认 skills
2. extension path skills
3. extension generated skills
4. workspace `.openwork/skills`
5. 用户手动配置的 `skillSources`

因为 deepagents 是“后者覆盖前者”，所以 sources 顺序就按上面排。

这样可以保证：

- 产品内建 skill 先可用
- extension 自带 skill 会自动生效
- 项目级 skill 可以覆盖产品默认
- 用户级显式配置拥有最高控制权

## 为什么不用“直接把 skill 传给 createSkillsMiddleware”

因为当前这条链路并不存在。

如果硬要这样做，至少要额外解决两个问题：

1. metadata 注入之后，agent 怎么读完整 skill
2. `read_file` 工具怎么读到同一份 skill 内容

所以真正的问题不是“怎么把 skill 对象传进去”，而是：

`怎么让 assistant runtime 和 file tool 共享同一个 skill 文件视图`

第一版最简单、最稳的答案就是：

`优先直接引用 extension 自带的 SKILL.md 目录；只有动态 skill 才生成真实文件，再把这些目录作为 source 传给 createSkillsMiddleware。`

## extension 作者怎么表达 skill

第一版建议完全 file-first。

例如：

```text
src/extensions/research/
  extension.ts
  skills/
    plan-research/
      SKILL.md
    synthesize-findings/
      SKILL.md
```

然后 `extension.ts` 只需要引用 skill 根目录：

```ts
export const researchExtension = defineOpenworkExtension({
  id: "research",
  role: "tool",
  skills: [
    {
      type: "path",
      rootDir: resolveExtensionPath(import.meta.url, "./skills")
    }
  ]
})
```

这意味着 extension 作者：

- 直接写标准 `SKILL.md`
- 不需要学一套新的 skill DSL
- 不需要把大段 skill 文本塞进 TS 常量

## 怎么把原有 skill 转成 extension

如果已经有现成 skill：

```text
my-skill/
  SKILL.md
```

那转换成本应该非常低：

1. 保留原来的 `SKILL.md` 内容不动
2. 把它放进某个 extension 的 `skills/` 目录下
3. 新增一个很薄的 `extension.ts`
4. 用 `type: "path"` 引用这个 skill 根目录

也就是说：

`把 skill 转成 extension` 不是重写 skill，而是给 skill 加一层 extension manifest。

## 和 MCP / Jingle 的关系

### MCP

MCP 更适合挂在 `interop` surface。

它解决的是：

- 怎么把 extension 的能力对外暴露
- 怎么消费外部能力

它不是 skill 的替代品。

关系应该是：

- `skill` 让 assistant 更会调用能力
- `tool` 让 assistant 真正调用能力
- `mcp` 让能力跨系统接入/暴露

### Jingle

Jingle 兼容也更适合挂在 `interop` surface。

未来接入 Jingle 时：

- 页面型能力映射到 `feature`
- 工具型能力映射到 `tool`
- 如果 Jingle 插件提供自己的 prompt/usage 说明，再考虑是否投影成 `skill`

不要反过来为了 Jingle 改坏 core plugin/extension 模型。

## Phase TODO

### Phase 1: 定义 extension 基础模型

- [ ] 新建 shared `OpenworkExtensionManifest`
- [ ] 增加 `role: assistant-core | feature | tool`
- [ ] 规定 `assistant-core` 只能有一个
- [ ] 把 `AI` 升级成 `assistant-core extension`
- [ ] 把 `translate` 升级成 `feature extension`

### Phase 2: 给 extension 增加 agent surface

- [ ] 先只定义 `skills`
- [ ] 定义 `type: path | generated`
- [ ] path source 直接引用 skill 根目录
- [ ] 校验所有已启用 extension 的 skill name 全局唯一

### Phase 3: skill source resolution

- [ ] 新增 extension skill source resolver
- [ ] path source 直接解析为绝对路径
- [ ] generated source 才写入 `~/.openwork/generated-skills/...`
- [ ] 设计 generated source 的清理策略
- [ ] 在 runtime 创建前生成 `resolvedSkillSources`

### Phase 4: assistant runtime 接线

- [ ] 在 [runtime.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/agent/runtime.ts) 里接入 resolved extension skill sources
- [ ] 保持 `createSkillsMiddleware` 继续吃 `sources: string[]`
- [ ] 调整 source 优先级：默认 -> extension path -> extension generated -> workspace -> user config
- [ ] 补启动日志，打印启用的 extension skill sources

### Phase 5: 再考虑高级 runtime

- [ ] 评估是否需要 `CompositeBackend` 做虚拟 skill mount
- [ ] 评估是否需要把 extension tool 投影成 MCP
- [ ] 评估 Jingle extension 到 `feature/tool` 的 adapter

## 给 coder 的执行建议

这轮实现建议很克制：

1. 先定义 extension manifest，不改 launcher plugin runtime 基座。
2. 先让 `AI` 和 `translate` 拥有 extension manifest。
3. skill 第一版优先走 path source，不内联大文本。
4. generated source 只给确实需要运行时生成的 skill。
5. 不做动态内存 skill。
6. 不做 MCP 实现。
7. 不做 Jingle bridge。

先把这条链跑通：

`enabled extensions -> resolved skill sources -> createSkillsMiddleware(sources) -> assistant-core 能读到 skill`

这条打通以后，再谈 tool projection 和 MCP，边界会清楚很多。
