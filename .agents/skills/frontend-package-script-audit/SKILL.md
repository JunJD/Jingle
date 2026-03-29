---
name: frontend-package-script-audit
description: Audit frontend components against package.json dependencies, devDependencies, and scripts. Use when the user asks which frontend packages can be removed, whether renderer imports still match package.json, whether package.json scripts still justify installed packages, or to verify component-package relationships after UI refactors.
user_invocable: true
version: "1.0.0"
---

# frontend-package-script-audit

审计前端组件和 `package.json` 的关系，重点看三件事：

1. `src/renderer` 里到底 import 了哪些第三方包
2. 这些包落在 `dependencies` 还是 `devDependencies`
3. `package.json` 的 `scripts` 里还直接引用了哪些工具包

## 适用场景

- 用户说“这些前端包能不能卸载”
- 用户说“这个组件删了之后还有哪些依赖残留”
- 用户说“检查一下 renderer 和 package.json 是否一致”
- 用户说“看看 scripts 还在依赖哪些包”

## 边界

- 默认只审计前端源码根：`src/renderer/src`
- 默认只看 `package.json` 的 `dependencies`、`devDependencies`、`scripts`
- 这个技能不会把“未出现在前端 import 和 scripts 里”的包直接判定为可删除
  这些包可能还被 `src/main`、`src/preload`、Vite 配置、构建链路、生成代码或运行时动态加载使用

## 执行

### 1. 先确认审计范围

默认前端根目录是：

```bash
src/renderer/src
```

如果用户明确提到别的前端目录，再追加 `--frontend` 参数。

### 2. 跑审计脚本

默认命令：

```bash
node .agents/skills/frontend-package-script-audit/scripts/audit_frontend_package_relations.mjs --root . --frontend src/renderer/src
```

如果需要给后续工具消费，输出 JSON：

```bash
node .agents/skills/frontend-package-script-audit/scripts/audit_frontend_package_relations.mjs --root . --frontend src/renderer/src --json
```

### 3. 解读结果

重点看这些字段：

- `missingDeclarations`
  前端 import 了，但 `package.json` 没声明
- `importedFromDevDependencies`
  前端运行时代码直接 import 了一个只放在 `devDependencies` 的包
- `scriptReferencedPackages`
  `package.json` 的 `scripts` 里还直接调用了哪些包的命令
- `declaredButNotSeenByThisAudit`
  没在前端 import 和脚本命令里直接出现的包。只能当候选，不是删除结论

### 4. 真正删除前必须复核

对任何想删的包，再做两步：

1. 全仓搜索

```bash
rg -n "<package-name>" .
```

2. 如果确认删除，再执行并验证

```bash
pnpm remove <package-name>
pnpm typecheck
```

如果脚本、构建、样式链路受影响，再补跑对应命令。

## 判断规则

- 前端 import 以 bare import 为准，例如 `streamdown`、`@radix-ui/react-tooltip`
- 相对路径、`@/` 别名、Node builtins、`node:` 模块不会被算成第三方包
- `scripts` 检测是启发式的，适合缩小范围，不适合盲删

## 结论输出格式

默认按下面顺序给结论：

1. 前端实际用到的第三方包
2. 前端缺失声明的包
3. 前端错误落在 `devDependencies` 的包
4. 被 `scripts` 直接使用的包
5. 可以进一步人工复核的候选包

结论要明确区分：

- “确定问题”
- “候选项，需复核”

不要把候选项直接写成可删除结论。
