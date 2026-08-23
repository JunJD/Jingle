# 发布通道

Jingle 使用两个发布通道：稳定版和 nightly 版。

## 稳定版

稳定版面向希望使用经过验证构建的用户。

- Tag 格式：`vX.Y.Z`
- 示例：`v0.0.1`
- GitHub Release 状态：正式 release
- Pre-release 标记：关闭
- 写入桌面安装包的版本：`X.Y.Z`

当构建已经通过 CI、打包和维护者 smoke 检查时，使用稳定版发布。

## Nightly 版

Nightly 版是用于快速反馈的预览构建，可能包含未完成能力、schema 变化或扩展契约变化。

- Tag 格式：`vX.Y.Z-nightly.YYYYMMDD[.N]`
- 示例：`v0.0.1-nightly.20260706`
- 重试示例：`v0.0.1-nightly.20260706.1`
- GitHub Release 状态：pre-release
- Pre-release 标记：开启
- 写入桌面安装包的版本：`X.Y.Z-nightly.YYYYMMDD[.N]`

当维护者需要在稳定版前提供一个可分享构建时，使用 nightly 版发布。

## 规则

- 发布 workflow 会把候选 tag 的版本写入安装包；不要只为发布而修改源码 manifest。
- 只能通过公开默认分支上的 `Desktop Release` workflow 验证发布候选。
  运行时输入未发布的候选 tag 字符串和当前公开 `main` 的完整 SHA；workflow 会
  拒绝过期提交和非默认分支来源。
- 候选 workflow 只做构建：不创建 tag 或 GitHub Release，不上传 workflow
  artifact，也不公开任何打包资产。成功 run 只证明精确的公开 `main` SHA 能在三种
  hosted runner 上完成打包。
- 精确候选通过后，冻结 `main`，在同一 SHA 创建 annotated release tag，并且只推送
  这个 tag。tag run 会重新执行打包、更新元数据、全新安装和升级检查后才发布。
- 不要推送或复用已废弃的本地试验 tag `v0.0.2-nightly.20260718.1`；workflow
  会明确拒绝它。
- 不再使用旧的 `app-v*` tag 族。
- 不要为不支持的 tag 名手动创建 GitHub Releases。
- 候选 tag 字符串不代表版本已被保留。未来受保护的发布路径在创建 tag 或 release
  前必须重新检查二者都不存在。
- 稳定版版本号单调递增。
- Nightly 版版本号必须包含构建日期。

## 迁移升级检查

已安装版本升级时，只会应用数据库里尚未记录的迁移，因此 Prisma 迁移回归只会沿这
条路径影响用户。`pnpm run release:smoke:pending-migrations` 在本地复现这条路径，
在每次 CI 的构建之前运行，不需要任何打包产物，几秒内结束。

- 它在隔离数据库中物化已审阅 `v0.0.1` 的精确迁移源，写入一条 sentinel thread，再
  通过 `scripts/run-prisma-jingle-db.mjs` 应用当前 checkout 的完整迁移后缀；同一个
  PR 新增多条迁移时，不会只演练最后一条。
- 它断言升级后的 ledger 覆盖当前 checkout 的全部迁移且 checksum 一致，没有未完成
  或已回滚的记录，并且 sentinel 行逐字段保持不变。
- 如果 checkout 修改、删除或重排了已经随 `v0.0.1` 基线发布的迁移，它会直接失败：
  用户机器上的数据库已经记录了原始 checksum，一旦漂移就会拒绝启动。

`tests/node/release-pending-migrations.test.ts` 用同一份已审阅 baseline fixture
驱动主进程的迁移执行器。改动迁移后先在本地运行这条检查：

```
pnpm run release:smoke:pending-migrations
```

这条检查不能替代 `scripts/release-smoke/installed.mjs` 的安装态 smoke：后者仍然
需要构建产物和已审阅的 `v0.0.1` release 资产，因此只在发布流程里运行。

## Tag 发布

`Desktop Release` workflow 只接受指向当前公开 `main` SHA 的合法 tag，并要求该 SHA
最新的 CI 与 CodeQL push run 成功。三个 hosted runner 必须完成精确架构打包、更新
元数据校验、全新安装以及从 `v0.0.1` 升级 smoke。只有最终 job 拥有发布权限：它创建
带 source SHA 标记的 draft，上传精确八个资产后再公开。平台 job 失败不会创建
Release；最终 job 失败会保留自己标记的 draft，供 `--clobber` 安全重跑，绝不删除
其他 owner 的 Release。

当前安装包没有正式签名或公证，macOS Gatekeeper 与 Windows SmartScreen 可能提示
风险。受保护 tag owner、provenance、attestation 等缺口仍由 #108 跟踪；安装和升级
证据继续由 #109 跟踪。

Linux AppImage 的桌面集成流程为了兼容 Ubuntu 24.04，会使用 `--no-sandbox`。如果不
通过桌面集成工具，而是直接运行下载文件，请执行：

```bash
chmod +x Jingle-*.AppImage
./Jingle-*.AppImage --no-sandbox
```

这属于明确降低 Chromium sandbox 的支持边界，不能宣称已经验证 sandbox-on 启动。
