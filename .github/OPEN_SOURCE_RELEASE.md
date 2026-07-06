# Open Source Release Gate

Use this checklist before making the GitHub repository public.

## Repository State

- The public default branch should be `main`.
- The public default branch must contain the Jingle identity cleanup and public
  docs.
- Publish from a clean public-history branch. Do not make the existing private
  development history public if old commits still contain private agent assets,
  badcase notes, checkpoint refs, or the retired product identity.
- Before making the repository public, remove or replace remote refs that keep
  old history reachable:
  - deprecated branches
  - obsolete release tags
  - checkpoint or tool-specific refs such as `refs/t3/*`
- Remove obsolete GitHub Releases before public launch.
- If release work is staged on another branch, merge or replay it into the clean
  public branch and verify that branch before making the repository public.
- Open issues and pull requests should either be useful to public readers or
  closed before launch.

## Required Checks

```bash
make help
make db-status
make check
make build
npm pack --dry-run
```

Also verify:

- source content and source paths contain no legacy product, storage, build, or
  generated-extension names
- the generated npm pack file list contains no legacy names
- reachable public refs do not expose private cleanup history
- release tags follow `vX.Y.Z` for stable builds or
  `vX.Y.Z-nightly.YYYYMMDD[.N]` for nightly builds
- local markdown links in README, roadmap, support, security, contributing, and
  docs resolve

## GitHub Settings

- Make the repository public only after the default branch is ready.
- Enable Dependabot alerts and security updates before launch.
- Enable private vulnerability reporting after the repository is public if the
  API is unavailable while private.
- Keep Issues enabled.
- Keep Projects and Wiki disabled unless there is a maintainer-owned plan for
  them.
- Enable branch protection for `main` after the initial public launch cut.
