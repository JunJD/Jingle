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
- Validate release candidates only through the `Desktop Release Candidate`
  workflow on the public default branch. Enter an unpublished candidate tag
  string and the full SHA currently published at `main`; the workflow refuses
  stale or non-default-branch sources.
- The candidate workflow is build-only. It creates no tag or GitHub Release,
  uploads no workflow artifact, and publishes no packaged asset. A successful
  run proves only that the exact public `main` SHA packaged on all three hosted
  runners.
- Do not push release tags from a local checkout. In particular, do not push or
  reuse the retired local trial tag `v0.0.2-nightly.20260718.1`; the workflow
  rejects it explicitly. Choose a new version.
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

## Blocked Release Mutation

This repository intentionally has no workflow that creates release tags or
publishes release assets. Before adding that mutation path, repository
administrators must provide all of these external controls:

- an active tag ruleset targeting `refs/tags/v*`, with no exclusions, that
  restricts creation, updates, and deletion
- a protected release environment restricted to `main`, with required approval,
  self-review disabled, and administrator bypass disabled
- a dedicated release GitHub App actor whose short-lived token is available only
  through that protected environment
- a ruleset bypass granted only to that dedicated actor, never to the broad
  GitHub Actions integration

These controls are external GitHub state and are not configured by this
repository. The public repository currently has no rulesets and no environments,
so release mutation remains blocked.

An administrator must separately verify that only a default-branch job approved
through the protected environment can obtain the dedicated actor token and
create a new tag. Direct human/API creation, tag updates, and tag deletion must
be rejected. YAML self-checks and a broad GitHub Actions bypass are not proof of
exclusive ownership.

The build-only candidate workflow requires successful CI and CodeQL push runs
for the exact public `main` SHA. It has no tag-push trigger and requests only
read permissions.

Release publication also remains blocked on macOS signing/notarization, Windows
Authenticode, provenance/attestation, and the remaining #108 gates. Fresh-install
and upgrade smoke tests remain tracked by #109. A future checksum manifest would
prove asset integrity only, not publisher identity or provenance.
