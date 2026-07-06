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
- 所有发布都从 `main` 切出。
- 不再使用旧的 `app-v*` tag 族。
- 不要为不支持的 tag 名手动创建 GitHub Releases。
- 如果 tag 推送后发布失败，修复后推送新 tag；不要改写已经发布的稳定版 tag。
- 稳定版版本号单调递增。
- Nightly 版版本号必须包含构建日期。

桌面发布 workflow 会校验支持的 tag 格式。
