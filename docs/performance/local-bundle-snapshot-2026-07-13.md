# 本地 Bundle 产物待复现快照（2026-07-13）

## 快照上下文

快照上下文中的仓库 `HEAD` 为 `3e35ae1282d6aecc0a09297df9dd3b66d3bcb7cb`，该提交的
committer time 为 `2026-07-13T21:41:09+08:00`。这里的时间是提交元数据，不是运行
采集命令的 wall-clock time；后者未单独记录。`HEAD` 只作为运行上下文，不是已有
`out/` 产物的来源证明。

工作树存在其他 session 的未提交改动，`out/` 产物没有可验证的 commit metadata，
且 main 与 renderer 文件的修改时间不一致。因此无法证明这些产物对应当前 `HEAD`、
当前 dirty tree 或同一次 build。

## 采集命令

```sh
git rev-parse HEAD
git log -1 --format='%H%n%cI%n%s'

stat -f '%N|%z|%Sm' -t '%Y-%m-%dT%H:%M:%S%z' \
  out/main/index.js \
  out/renderer/assets/index-MrA1qJBU.js \
  out/renderer/assets/LauncherAiPage-DuTdtfiI.js \
  out/renderer/assets/mermaid-GHXKKRXX-BtYf5JXR.js

find out/renderer/assets -type f -name '*.js' -print0 \
  | xargs -0 stat -f '%z' \
  | awk '{sum += $1} END {print sum}'
```

## 产物快照

| 范围 | 文件或口径 | Bytes | MiB | mtime |
| --- | --- | ---: | ---: | --- |
| Main entry | `out/main/index.js` | 10,574,330 | 10.08 | `2026-07-13T21:47:00+0800` |
| Renderer 全部 JS | `out/renderer/assets/*.js` 合计 | 21,449,198 | 20.46 | 混合产物，见单文件时间 |
| Renderer initial | `index-MrA1qJBU.js` | 1,843,155 | 1.76 | `2026-07-11T19:32:00+0800` |
| Launcher AI | `LauncherAiPage-DuTdtfiI.js` | 2,099,862 | 2.00 | `2026-07-11T19:32:00+0800` |
| Mermaid | `mermaid-GHXKKRXX-BtYf5JXR.js` | 2,778,350 | 2.65 | `2026-07-11T19:32:00+0800` |

MiB 按 `bytes / 1,048,576` 计算。

## 阻塞证据

快照采集早期的触发命令：

```sh
/usr/bin/time -l npm run build
```

精确阻塞：

```text
tests/node/launcher-model-filter.test.ts(3,45): error TS2307: Cannot find module '../../src/renderer/src/ai-core/launcher-model-filter' or its corresponding type declarations.
```

Owner 判断：该测试仍引用当前工作树中已删除的 `launcher-model-filter` 模块，属于对应
launcher/test owner 的陈旧测试阻塞；本轮只记录，不修复。

快照采集早期的触发命令：

```sh
make doctor
```

精确阻塞：

```text
make: *** No rule to make target `doctor'.  Stop.
```

该错误是当时的精确输出，但复核时并发工作树已经发生变化：`make doctor` 现已进入
`scripts/guardrails/doctor-run.mjs`，不再复现 target 缺失。因此它只是已失效的瞬时阻塞
证据，不是当前 blocker。相关 Makefile 和 Doctor findings 均属于 Doctor/build tooling
owner；本轮不修改，也不把当前 findings 纳入这份 bundle 快照。

## 结论限制

这是本机旧 `out/` 的待复现产物快照，不是当前源码的性能结论。当前 build 尚未生成可归因于
一致源码状态的新产物；在 owner 清理仍有效的 build 阻塞、共享工作树收敛并完成一次
可追溯 build 之前，不应根据这些数字推断当前源码的 bundle、启动、内存、CPU 或交互性能。
