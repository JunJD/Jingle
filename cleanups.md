# Cleanups

这个文件是长期任务的兼容债台账。

当前主要服务对象：

- `docs/tsyringe-migration-roadmap.md`

规则：

- 任何为了迁移临时加入的兼容层、双写、桥接、别名注册、保底分支，都要在同一个变更里登记到这里。
- 只有明确写出“删除条件”的兼容代码才允许进入代码库。
- roadmap 结束前，`Active` 表必须清空。

## Active

| Area | Path | Temporary code | Why it exists | Remove when |
| --- | --- | --- | --- | --- |
| tsyringe-migration | none | none | 还没有引入迁移期兼容代码 | 保持为空直到出现第一条兼容项 |

## Resolved

| Area | Path | Removed code | Removed in |
| --- | --- | --- | --- |
| none | none | none | none |
