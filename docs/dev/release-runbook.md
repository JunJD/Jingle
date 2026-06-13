# Release Runbook

[中文](./release-runbook-cn.md)

This runbook describes the current release paths in this repository. Verify
workflow files and `package.json` before changing release copy.

## Release Paths

| Path                  | Trigger                           | Workflow or command                     | Output                                                                                                |
| --------------------- | --------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| npm package           | Push a `v*` tag                   | `.github/workflows/release.yml`         | Publishes `openwork` to npm and creates a GitHub Release body for npm usage.                          |
| Desktop app           | Push any tag or run manually      | `.github/workflows/desktop-release.yml` | Builds macOS, Windows, and Linux desktop artifacts; on tag pushes uploads them to a GitHub Release.   |
| Build artifact smoke  | Push `app-v*` tag or run manually | `.github/workflows/build.yml`           | Builds `out` artifacts for macOS, Windows, and Linux. This is not the desktop release asset workflow. |
| Local desktop package | Developer command                 | `pnpm run dist:*`                       | Writes local artifacts under `dist`.                                                                  |

`v1.2.3` currently triggers both npm publishing and desktop packaging.
`app-v1.2.3` triggers desktop packaging without npm publishing.

## Local Release Preparation

Run the release gate from [validation-matrix.md](./validation-matrix.md), then
package locally for the platform you can verify:

```bash
pnpm run dist:mac
pnpm run dist:mac:dir
pnpm run dist:win
pnpm run dist:linux
```

For macOS local smoke, `pnpm run dist:mac:dir` disables automatic certificate
discovery and produces an unpacked app directory. Use this when you need a quick
runtime check without producing a signed DMG.

## Desktop Packaging Owners

- `electron-builder.yml` owns app identity, product name, targets, app icons,
  URL scheme, macOS Reminders permissions, packaged files, and publish provider.
- `scripts/run-electron-builder.mjs` wraps `electron-builder` and repairs
  corrupt local Electron macOS cache entries before packaging.
- `scripts/build-installed-extension.mjs` builds bundled installable extensions
  before app build.
- `scripts/build-native-island.mjs` builds native support used by packaged app
  flows.
- `.github/workflows/desktop-release.yml` owns CI packaging and release upload.

## npm Release Owners

- `package.json` owns npm package metadata and the `openwork` CLI entry at
  `bin/cli.js`.
- `.github/workflows/release.yml` validates `v*` tag format, checks
  `NPM_TOKEN`, builds, publishes to npm, and creates a GitHub Release.

## macOS Preview Installs

macOS dev preview builds may be unsigned or not notarized. Send testers to
[macos-dev-preview-install.md](../macos-dev-preview-install.md) when using
internal builds.

## Release Verification Notes

- Verify the app version shown by the artifact matches the tag after workflow
  version injection.
- Verify the installer opens the `Jingle` app, because `electron-builder.yml`
  sets `productName: Jingle`.
- Verify logs are written under `$OPENWORK_HOME/logs` or `~/.openwork/logs`.
- Verify bundled installable extensions are present in the package if the
  release changed extension source packages.
- Verify GitHub/Notion/Figma OAuth callback behavior if the release changed
  URL scheme, OAuth routes, or `jingle.cool` callback configuration.
