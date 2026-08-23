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

- The release workflow writes the candidate tag version into packaged apps;
  do not edit source manifests only to cut a release.
- Validate release candidates only through the `Desktop Release`
  workflow on the public default branch. Enter an unpublished candidate tag
  string and the full SHA currently published at `main`; the workflow refuses
  stale or non-default-branch sources.
- The candidate workflow is build-only. It creates no tag or GitHub Release,
  uploads no workflow artifact, and publishes no packaged asset. A successful
  run proves only that the exact public `main` SHA packaged on all three hosted
  runners.
- After the exact candidate succeeds, freeze `main`, create an annotated release
  tag at that same SHA, and push only that tag. The tag run repeats all package,
  metadata, fresh-install, and upgrade checks before publishing.
- Do not push or reuse the retired local trial tag
  `v0.0.2-nightly.20260718.1`; the workflow rejects it explicitly.
- Do not use the old `app-v*` tag family.
- Do not create GitHub Releases by hand for unsupported tag names.
- A candidate tag string does not reserve a version. Recheck tag and release
  absence inside the future protected release path before creating either.
- Stable versions should move forward monotonically.
- Nightly versions should include the calendar date of the build.

## Migration Upgrade Check

An existing install upgrades by applying the migrations its database has not
recorded yet, so a Prisma migration regression only reaches users along that
path. `pnpm run release:smoke:pending-migrations` rehearses it locally, runs on
every CI job before the build, needs no packaged asset, and finishes in seconds.

- It materializes the exact reviewed `v0.0.1` migration source into an isolated
  database, seeds a sentinel thread, then applies the complete current migration
  suffix through `scripts/run-prisma-jingle-db.mjs`. This covers pull requests
  that add more than one migration instead of rehearsing only the newest one.
- It asserts the upgraded ledger holds every migration of this checkout with
  matching checksums, none incomplete or rolled back, and that the sentinel row
  survived byte-for-byte.
- It refuses a checkout that edits, drops, or reorders a migration already
  shipped in the reviewed `v0.0.1` baseline, because databases in the field
  recorded the original checksums and refuse to start once they drift.

`tests/node/release-pending-migrations.test.ts` drives the same reviewed baseline
fixture through the main-process migration runner. Run the check locally before
pushing a migration change:

```
pnpm run release:smoke:pending-migrations
```

This check is not a substitute for the packaged smoke in
`scripts/release-smoke/installed.mjs`, which still needs built artifacts and the
reviewed `v0.0.1` release asset and therefore stays release-only.

## Tag Publication

The `Desktop Release` workflow publishes only when a supported tag points to the
current public `main` SHA and that SHA's latest CI and CodeQL push runs succeeded.
The three hosted runners must package one exact architecture, validate updater
metadata, and pass fresh-install and `v0.0.1` upgrade smoke. Only the final job can
create a marked draft, upload the exact eight release assets, and publish it.
Failed package jobs create no release; a failed final job leaves its marked draft
for a safe `--clobber` rerun and never deletes another owner's release.

Current packages are unsigned and not notarized. macOS Gatekeeper and Windows
SmartScreen may warn. These gaps, protected tag ownership, provenance, and
attestation remain tracked by #108; installed and upgrade evidence remains
tracked by #109.

The Linux AppImage desktop integration uses `--no-sandbox` for Ubuntu 24.04
compatibility. When launching the downloaded file directly instead of through a
desktop integration tool, run:

```bash
chmod +x Jingle-*.AppImage
./Jingle-*.AppImage --no-sandbox
```

This is an explicit Chromium sandbox reduction, not a sandbox-on verification.
