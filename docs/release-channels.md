# Release Channels

Jingle publishes two release channels: stable and nightly.

## Stable

Stable releases are the default channel for users who want a tested build.

- Tag format: `vX.Y.Z`
- Example: `v0.0.1`
- GitHub Release state: published release
- Pre-release flag: off
- Version written into packaged apps: `X.Y.Z`

Use a stable release when the build has passed CI, packaging, and maintainer
smoke checks.

## Nightly

Nightly releases are preview builds for fast feedback. They may contain
unfinished features, schema changes, or extension contract changes.

- Tag format: `vX.Y.Z-nightly.YYYYMMDD[.N]`
- Example: `v0.0.1-nightly.20260706`
- Retry example: `v0.0.1-nightly.20260706.1`
- GitHub Release state: published pre-release
- Pre-release flag: on
- Version written into packaged apps: `X.Y.Z-nightly.YYYYMMDD[.N]`

Use nightly releases when maintainers need a shareable build before cutting a
stable release.

## Rules

- Keep `package.json` at the next public baseline version on `main`.
- Cut releases from `main`.
- Do not use the old `app-v*` tag family.
- Do not create GitHub Releases by hand for unsupported tag names.
- If a release fails after the tag is pushed, fix forward and push a new tag;
  do not mutate a published stable tag.
- Stable versions should move forward monotonically.
- Nightly versions should include the calendar date of the build.

The desktop release workflow enforces the supported tag formats.
