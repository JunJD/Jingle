# issue-bug-0621

## 非阻塞：migration preview 类型生成仍接受缺失 connection 的旧形状

- 位置：`packages/extension-migration/src/preview-raycast-ai-migration.mjs`
- 现象：`connectionSecretNamesToTypePreferences(connection)` 仍通过 `connection?.auth` 兼容缺失 connection 的 preview 输入。
- 判断：这是生成器内部的旧输入兼容，不是 native extension runtime 的事实 fallback；当前生成的 manifest 已经会写入 `connection`，不会阻塞 image extension 的 connection/auth 链路。
- 后续收敛：把 migration preview 的内部 `manifestPreview` 结构归一化成必含 `connection`，再删除该可选链。
