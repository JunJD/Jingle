# Extension 迁移 Transform 架构调研

日期：2026-06-01

## 结论

当前 `packages/extension-migration/src/preview-raycast-ai-migration.mjs` 能支撑 Notion 第一轮迁移，但它还不是一个通用迁移引擎。主要原因不是“正则一定不能用”，而是当前脚本把三类事情混在一起了：

1. 通用 Raycast 到 Openwork 的 import / manifest / package rewrite。
2. TypeScript / TSX 源码结构变换。
3. Notion 专属修补。

后续建议把迁移器重构成 transform pipeline。工具选择上，不建议做 Babel-only 迁移器；更合适的是让 source transform 层可插拔，按任务选择 AST / codemod 工具。更适合 Openwork 当前阶段的方案是：

- **TypeScript Compiler API / ts-morph**：负责 TS 类型分析、`Input` type/interface 读取、schema draft、需要类型语义的 transform。
- **jscodeshift / recast**：负责 source codemod、import rewrite、局部语法结构修改，并尽量保留源文件格式，适合后续批量迁移 extension。
- **Babel parser/traverse/generator**：可以作为 source transform 的实现选项，尤其适合 JS/TS/TSX 语法 visitor 和 Babel 生态插件，但不应成为整个迁移器架构本身。
- **正则**：只保留在低风险文本层，例如 public copy、URL scheme、文档字符串、报告内容。不要继续用正则修改 TypeScript 语义结构。

因此，下一步不是立刻做“完整 Babel 迁移器”，而是先把现有脚本拆层，让 Notion 特例从通用逻辑里分出去，再逐步把高风险正则替换成可测试的 AST / codemod transform。

## 方案对比

| 方案 | 适合做什么 | 不适合做什么 | 对 Openwork 的判断 |
| --- | --- | --- | --- |
| TypeScript Compiler API | TS/TSX AST 读取、类型声明读取、代码生成、结合 TS 类型信息 | 原格式保留一般；API 偏底层 | 适合 analysis 和类型相关 transform。项目已有依赖。 |
| ts-morph | TypeScript Compiler API 的高层封装，操作 source file/import/type 更舒服 | 新增依赖；抽象层会隐藏部分 printer 行为 | 适合降低 TS AST 操作成本，可作为类型/源码 transform 候选。 |
| Babel parser/traverse/generator | JS/TS/JSX/TSX 语法 transform，生态成熟，visitor 模型清晰 | 不做 TypeScript 类型检查；生成代码格式会重排 | 可作为 source transform 生态选项，不建议变成迁移器唯一架构。 |
| recast | AST-to-AST transform 后尽量保留原始格式 | 本身不是完整迁移框架；仍要写 transform | 适合替换“源码重写并保留可读 diff”的部分。 |
| jscodeshift | 批量 codemod、CLI runner、基于 recast 的代码修改 | 对单个复杂迁移报告/产物生成不是天然强项 | 很适合未来把 source rewrite 变成可批量跑、可测试的 codemod 层。 |
| 正则 | 文本替换、URL、公开文案、报告后处理 | import/type/JSX/对象结构/函数体语义修改 | 只保留在低风险文本层。 |

## 推荐架构

迁移器应拆成四层。

第一层是 reader / writer：

```txt
reader
  - local fs
  - git ref
  - package source snapshot

writer
  - preview json
  - report markdown
  - openwork-package artifacts
```

第二层是 analysis：

```txt
analyzers/
  package-json.ts
  imports.ts
  runtime-capabilities.ts
  commands.ts
  tools.ts
  preferences.ts
```

这一层只读源文件，产出结构化 facts，不直接改源码。

第三层是 transforms：

```txt
transforms/
  import-rewrite.ts
  package-json.ts
  manifest.ts
  runtime.ts
  runtime-metadata.ts
  tool-runner.ts
  source-rewrite.ts
  known-extensions/
    notion.ts
```

这一层接收 facts 和 source AST，产出目标 artifacts。Notion 专属逻辑必须放在 `known-extensions/notion.ts`，不能继续散在通用 `rewriteSourceForOpenwork` 里。

第四层是 validation：

```txt
validators/
  generated-package-boundary.ts
  no-raycast-runtime-import.ts
  typecheck-config.ts
  runtime-contract.ts
```

这一层负责说明生成物能不能进入 `extensions/<id>`，不要把校验逻辑埋在 transform 里。

## Transform 输入输出

建议每个 transform 都遵守同一接口：

```ts
interface MigrationTransformContext {
  facts: MigrationFacts
  sourceFiles: MigrationSourceFile[]
  target: MigrationTarget
}

interface MigrationTransformResult {
  artifacts: Record<string, string | Buffer>
  diagnostics: MigrationDiagnostic[]
}

interface MigrationTransform {
  name: string
  run(context: MigrationTransformContext): MigrationTransformResult
}
```

这样做的好处：

- 每个 transform 可以单独测试。
- Notion 特例可以明确声明自己只对 Notion 生效。
- 同一份 facts 可以同时生成 manifest、runtime、tools、report。
- 失败语义清楚：blocking issue、adapter note、migration note 不再混在字符串替换里。

## 哪些地方必须 AST 化

以下内容不应该继续用正则：

- import source 和 named import 改写。
- 删除、增加、重命名 import specifier。
- `getPreferenceValues()` 增加泛型。
- `Form.Values` 类型参数补齐。
- 函数返回值从 `null` 改成 `undefined`。
- Notion property wrapper 这种对象结构变换。
- `oauth.ts` 里 client 初始化逻辑改写。
- JSX 文件补 React runtime import。

这些都属于 TypeScript/TSX 语义结构。正则能让某一个源版本通过，但对下一版 Raycast extension 源码不稳。

## 哪些地方可以继续正则

以下内容可以继续用文本替换：

- `raycast://` 到 `openwork://`。
- public copy 里的 `Raycast` 到 `Openwork`。
- migration report 文案。
- OAuth proxy URL 字符串删除，但最好只在 AST 确认字段名后删除。
- quicklink URL 的 scheme 和 extension id 迁移。

原则是：如果替换目标不依赖 TypeScript 语法树和作用域，可以保留文本替换；如果依赖作用域、节点类型、import 来源或 JSX 结构，应改用 AST。

## 第一阶段落地建议

第一阶段不要追求完整通用化，目标是降低当前 Notion 迁移器继续扩展时的风险。

建议拆分顺序：

1. 保留现有 CLI 和输出文件名不变，避免影响当前验收。
2. 新建 `packages/extension-migration/src/transforms/`。
3. 把 `rewriteKnownNotionSourceForOpenwork` 移到 `transforms/known-extensions/notion.mjs`。
4. 把 import rewrite 独立为 `transforms/import-rewrite.mjs`，先用 TypeScript AST 或至少用 import declaration 级别 parser 实现。
5. 把 `buildManifestPreview`、`buildRuntimePreviewSource`、`buildToolsPreviewSource` 这类 generator 从主脚本拆出。
6. 给每个 transform 加 fixture test：输入 Raycast 源片段，断言输出 Openwork 源片段和 diagnostics。

第一阶段完成后，迁移器仍然可以生成当前 Notion package，但主脚本会变成编排层，而不是 3000 行混合实现。

## 2026-06-02 第一阶段落地记录

本轮已经完成第一阶段的核心拆分，但还没有把所有 generator 都拆出主脚本。当前边界是：

```txt
packages/extension-migration/src/
  preview-raycast-ai-migration.mjs     # CLI、reader、analysis、artifact 编排仍在这里
  transforms/
    import-rewrite.mjs                 # AST 级 Raycast runtime import 改写
    openwork-copy.mjs                  # public copy / scheme 文案替换
    source-rewrite.mjs                 # 通用 source rewrite 编排
    known-extensions/
      index.mjs                        # known extension transform registry
      notion.mjs                       # Notion 专属 source/analyzer/type alias 补丁
```

这次故意没有把 GitHub 或 Apple Reminders 加成 known extension transform。它们这轮只作为验收样本：如果通用 transform 架构成立，迁移器应该能生成 package 预览、工具映射、manifest/runtime/main/tools/assets/report，并把当前不支持的能力留在 compatibility report 里，而不是把它们写成专属补丁。

已经处理的关键边界：

- `source-rewrite.mjs` 和 `import-rewrite.mjs` 不包含 Notion 字符串特例。
- Notion transform 增加 `appliesTo(context)`，不会无条件跑在 GitHub / Apple Reminders 上。
- Notion 的 module-level client blocker、blocker suppression、`notion_token` 兼容 alias 已收口到 `known-extensions/notion.mjs`。
- `@raycast/api` / `@raycast/utils` 的静态 `import`、`export ... from`、静态动态 import 由 TypeScript AST 定位 module specifier 后改写。
- Git reader 显式关闭 `gc.auto`，避免大扩展真实迁移时被 auto-gc 拖慢。
- package dependency 生成会过滤 Node builtin 和协议型 specifier，例如 `fs`、`path`、`node:fs`、`swift:..`，避免生成不可安装依赖。

本轮仍保留在主脚本里的内容：

- dependency decision 表。
- package/manifest/runtime/tools/types 生成器。
- runtime compatibility analyzer。
- source file reader 和 artifact writer。

这些不是这轮的失败点，但下一阶段应该继续从主脚本拆出去。当前优先级更高的是让 transform 边界先变清楚，并让真实扩展迁移能稳定暴露 facade 缺口。

## GitHub / Apple Reminders 过程验收

本轮用隔壁 Raycast extensions repo 重新跑了两个真实扩展：

```bash
node scripts/preview-raycast-ai-migration.mjs \
  --git-repo /Users/junjieding/dingjunjie_dev/2026_03/raycast-extensions-notion \
  --extension-path extensions/github \
  --git-ref HEAD \
  --out-dir /tmp/openwork-migration-github \
  --target-extension-id github-generated \
  --target-extension-title "GitHub Generated"

node scripts/preview-raycast-ai-migration.mjs \
  --git-repo /Users/junjieding/dingjunjie_dev/2026_03/raycast-extensions-notion \
  --extension-path extensions/apple-reminders \
  --git-ref HEAD \
  --out-dir /tmp/openwork-migration-apple-reminders \
  --target-extension-id apple-reminders-generated \
  --target-extension-title "Apple Reminders Generated"
```

验收摘要：

| 扩展 | commands | tools | source files | assets | supported platforms | Raycast runtime import |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| GitHub | 20 | 15 | 111 | 33 | `darwin`, `win32` | 0 |
| Apple Reminders | 7 | 8 | 48 | 2 | `darwin` | 0 |

两个生成 package 都产出了：

- `openwork-package/package.json`
- `openwork-package/identity.ts`
- `openwork-package/manifest.ts`
- `openwork-package/main.ts`
- `openwork-package/main/tools.ts`
- `openwork-package/runtime.ts`
- `openwork-package/runtime-metadata.ts`
- `openwork-package/types.d.ts`
- `runtime-compatibility.json`
- `utils-boundary-report.json`
- `dependency-report.md`

真实验收发现并修掉了一个重要问题：迁移器原来会把 `fs`、`path`、`os`、`stream`、`util`、`swift:..` 这类非 npm 依赖写进 generated package 的 dependencies。修复后：

- GitHub generated dependencies 只保留 `@octokit/rest`、`graphql-request`、`graphql-tag`、`node-fetch`、`yauzl`、`date-fns`、`lodash`、`react`、`zod` 和 `@openwork/*`。
- Apple Reminders generated dependencies 只保留 `@date-fns/utc`、`chrono-node`、`date-fns`、`lodash`、`react`、`zod` 和 `@openwork/*`。

需要注意：GitHub / Apple Reminders 当前仍有大量 `runtimeCompatibility.blockingIssues`，这说明 Openwork facade / runtime 还没完整覆盖这些 Raycast API，不是 transform 架构失败。当前验收只要求迁移器能稳定生成 package、结构化报告缺口、清理 Raycast runtime import、保留平台/tool/command/asset 信息。

## 第二阶段落地建议

第二阶段再决定 source transform 层采用哪组生态作为默认实现。

判断标准：

- 如果目标是批量迁移 extension，并希望 transform 文件天然清晰，优先评估 jscodeshift + recast。
- 如果 TypeScript Compiler API printer 造成 diff 太大，优先评估 recast。
- 如果 transform 编写成本太高，优先评估 ts-morph。
- 如果要提供 dry-run / stats / interactive review，优先评估 jscodeshift。
- 如果未来需要复用 Babel 生态插件或支持更复杂 JS proposal，再评估 Babel。

当前不建议做 Babel-only，不是因为 dev 依赖本身有问题，而是因为迁移器的结构清晰应该来自 pipeline 和 transform 边界。Babel 可以进入 source transform 层；类型分析、schema draft、package artifact generation 不应该被迫绑到 Babel 模型上。

## 验收标准

重构后的迁移器至少要满足：

- CLI 行为不变。
- 当前 `raycast-ai-migration-preview` node tests 继续通过。
- Notion 迁移生成物仍不包含 `@raycast/api` / `@raycast/utils` runtime import。
- Notion 专属 transform 可以被单独定位和关闭。
- 通用 transform 不包含 `notion` 字符串特例。
- 高风险 TypeScript 结构改写不再由正则承担。

## 参考资料

- Babel parser 文档：`https://babeljs.io/docs/babel-parser`
- Babel traverse 文档：`https://babeljs.io/docs/babel-traverse`
- Babel generator 文档：`https://babeljs.io/docs/babel-generator`
- TypeScript Compiler API wiki：`https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API`
- ts-morph 文档：`https://ts-morph.com/`
- recast 仓库：`https://github.com/benjamn/recast`
- jscodeshift 仓库：`https://github.com/facebook/jscodeshift`
