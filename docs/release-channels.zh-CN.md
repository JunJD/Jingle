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

- `main` 上的 `package.json` 保持下一个公开基线版本。
- 只能通过公开默认分支上的 `Desktop Release Candidate` workflow 验证发布候选。
  运行时输入未发布的候选 tag 字符串和当前公开 `main` 的完整 SHA；workflow 会
  拒绝过期提交和非默认分支来源。
- 候选 workflow 只做构建：不创建 tag 或 GitHub Release，不上传 workflow
  artifact，也不公开任何打包资产。成功 run 只证明精确的公开 `main` SHA 能在三种
  hosted runner 上完成打包。
- 不要从本地 checkout 推送 release tag。尤其不要推送或复用已废弃的本地试验 tag
  `v0.0.2-nightly.20260718.1`；workflow 会明确拒绝它。必须选择新版本。
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

## 被阻断的发布写入

当前仓库有意不提供创建 release tag 或公开发布资产的 workflow。新增这条写入路径
前，仓库管理员必须先提供以下全部外部控制：

- active tag ruleset 精确覆盖 `refs/tags/v*`，没有 exclusions，并限制 creation、
  updates 和 deletion
- 受保护的 release environment，只允许 `main`，要求审批、禁止自审，并禁止
  administrator bypass
- 专用 release GitHub App actor，其短期 token 只能由该受保护 environment 提供
- ruleset bypass 只授予该专用 actor，禁止放行整个 GitHub Actions integration

这些控制都属于 GitHub 外部状态，不能由仓库代码配置。公开仓库当前既没有 ruleset，
也没有 environment，因此发布写入继续阻断。

管理员必须另行实测：只有经过受保护 environment 审批的默认分支 job 能取得专用
actor token 并创建新 tag；人类或 API 直接创建、更新、删除 tag 都会被拒绝。
YAML 自检和 GitHub Actions integration 的宽泛 bypass 都不能证明独占 owner。

build-only 候选 workflow 仍要求当前公开 `main` 的精确 SHA 已有成功的 CI 和
CodeQL push run。它没有 tag-push trigger，并且只申请 read 权限。

发布还继续受 macOS 签名/公证、Windows Authenticode、provenance/attestation 和
#108 其余 gate 阻断；全新安装和升级 smoke 仍由 #109 跟踪。未来的 checksum 清单
只能证明资产完整性，不能代表发布者身份或 provenance。
