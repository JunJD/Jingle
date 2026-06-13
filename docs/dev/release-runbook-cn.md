# Release Runbook

[English](./release-runbook.md)

这个 runbook 描述当前仓库里的 release paths。修改 release copy 前，先核对 workflow files 和 `package.json`。

## Release Paths

| Path                  | Trigger                      | Workflow or command                     | Output                                                                                   |
| --------------------- | ---------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| npm package           | Push `v*` tag                | `.github/workflows/release.yml`         | 发布 `openwork` 到 npm，并创建面向 npm usage 的 GitHub Release body。                    |
| Desktop app           | Push any tag 或手动运行      | `.github/workflows/desktop-release.yml` | 构建 macOS、Windows 和 Linux desktop artifacts；tag push 时上传到 GitHub Release。       |
| Build artifact smoke  | Push `app-v*` tag 或手动运行 | `.github/workflows/build.yml`           | 构建 macOS、Windows 和 Linux 的 `out` artifacts。这不是 desktop release asset workflow。 |
| Local desktop package | Developer command            | `pnpm run dist:*`                       | 在 `dist` 下写入本地产物。                                                               |

`v1.2.3` 当前会同时触发 npm publishing 和 desktop packaging。`app-v1.2.3` 会触发 desktop packaging，但不发布 npm。

## Local Release Preparation

先运行 [validation-matrix-cn.md](./validation-matrix-cn.md) 中的 release gate，再为你能验证的平台做本地打包：

```bash
pnpm run dist:mac
pnpm run dist:mac:dir
pnpm run dist:win
pnpm run dist:linux
```

macOS local smoke 推荐用 `pnpm run dist:mac:dir`。它会关闭 automatic certificate discovery，生成 unpacked app directory，适合快速 runtime check，而不是生成 signed DMG。

## Desktop Packaging Owners

- `electron-builder.yml` 拥有 app identity、product name、targets、app icons、URL scheme、macOS Reminders permissions、packaged files 和 publish provider。
- `scripts/run-electron-builder.mjs` 包装 `electron-builder`，并在 packaging 前修复损坏的本地 Electron macOS cache entries。
- `scripts/build-installed-extension.mjs` 在 app build 前构建 bundled installable extensions。
- `scripts/build-native-island.mjs` 构建 packaged app flows 使用的 native support。
- `.github/workflows/desktop-release.yml` 拥有 CI packaging 和 release upload。

## npm Release Owners

- `package.json` 拥有 npm package metadata 和 `bin/cli.js` 上的 `openwork` CLI entry。
- `.github/workflows/release.yml` 校验 `v*` tag format、检查 `NPM_TOKEN`、build、publish to npm，并创建 GitHub Release。

## macOS Preview Installs

macOS dev preview builds 可能未签名或未 notarize。使用 internal builds 时，把测试者引导到 [macos-dev-preview-install.md](../macos-dev-preview-install.md)。

## Release Verification Notes

- 验证 artifact 显示的 app version 与 workflow version injection 后的 tag 一致。
- 验证 installer 打开的是 `Jingle` app，因为 `electron-builder.yml` 设置了 `productName: Jingle`。
- 验证 logs 写入 `$OPENWORK_HOME/logs` 或 `~/.openwork/logs`。
- 如果 release 改动 extension source packages，验证 bundled installable extensions 已进入 package。
- 如果 release 改动 URL scheme、OAuth routes 或 `jingle.cool` callback configuration，验证 GitHub/Notion/Figma OAuth callback 行为。
