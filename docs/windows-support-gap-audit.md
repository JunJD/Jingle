# Windows Support Gap Audit

This document captures the current Windows support status of Openwork as of 2026-04-15, based on local code inspection and validation on a Windows development machine.

It is intended as an implementation handoff document, not end-user documentation.

## Snapshot

Windows support is partial, not absent.

Already present:

- launcher, main, and settings windows have Windows branches in [`src/main/windows`](../src/main/windows)
- launcher application search has a Windows implementation based on Start Menu `.lnk` discovery in [`src/main/services/launcher-search/providers/applications.ts`](../src/main/services/launcher-search/providers/applications.ts)
- shortcut defaults include `win32` entries in [`src/shared/shortcuts/defaults.ts`](../src/shared/shortcuts/defaults.ts)

Still missing or incomplete:

- launcher file search
- launcher browser history search
- clipboard file/folder context
- native minimal island
- Windows release packaging
- some Windows developer workflows

## Confirmed User-Facing Gaps

### 1. File Search Is Missing On Windows

The current file-search provider is mac-only.

Evidence:

- [`src/main/services/launcher-search/providers/files.ts`](../src/main/services/launcher-search/providers/files.ts) uses `/usr/bin/mdfind`
- the same provider returns an empty result set for non-`darwin` platforms

Impact:

- launcher cannot return local files or directories on Windows
- this is the highest-priority Windows feature gap

### 2. Browser History Search Is Missing On Windows

The current browser-history provider is also mac-only.

Evidence:

- [`src/main/services/launcher-search/providers/browser-history.ts`](../src/main/services/launcher-search/providers/browser-history.ts) scans `~/Library/Application Support/...`
- it shells out to `/usr/bin/sqlite3`
- it returns an empty result set for non-`darwin` platforms

Impact:

- launcher cannot surface Chrome or Edge history on Windows

### 3. Clipboard File/Folder Context Is Missing On Windows

Launcher clipboard context exists, but Windows file payload handling does not.

Evidence:

- [`src/main/services/clipboard.ts`](../src/main/services/clipboard.ts) reads file payloads only for `darwin` and `linux`
- there is no Windows branch for file/folder clipboard formats

Impact:

- copying files or folders in Explorer does not feed launcher clipboard context
- image and text clipboard flows still exist, but file attachment context is incomplete

### 4. Native Minimal Island Is macOS-Only

Evidence:

- [`src/main/services/native-minimal-island.ts`](../src/main/services/native-minimal-island.ts) exits early unless `process.platform === "darwin"`

Impact:

- Windows has no equivalent ambient native island behavior

### 5. Apple Reminders Extension Is macOS-Only

Evidence:

- [`extensions/apple-reminders/manifest.ts`](../extensions/apple-reminders/manifest.ts) declares `supportedPlatforms: ["darwin"]`

Impact:

- expected platform-specific omission, not a Windows bug

## Confirmed Developer Workflow Gaps

### 1. `pnpm run build` Fails On Windows

Local validation:

- `npm run typecheck`: passes
- `npm run build:electron`: passes
- `pnpm run build:electron`: passes
- `pnpm run build`: fails with `spawn EINVAL`

Relevant file:

- [`scripts/build-with-react-compiler-guard.mjs`](../scripts/build-with-react-compiler-guard.mjs)

Notes:

- the wrapper chooses `npm.cmd` on Windows, but the current spawn path still fails in the unified build flow
- this is a Windows dev/CI blocker, but not proof that the Electron app itself cannot build

### 2. Windows BDD Smoke Flow Is Currently Broken

Local validation:

- `npm run test:bdd:smoke`: blocked because it depends on the broken unified build
- `npx cucumber-js --config tests/bdd/cucumber.config.cjs --tags '@smoke'`: fails at Electron startup
- direct manual Playwright Electron launch works

Relevant file:

- [`tests/bdd/support/world.ts`](../tests/bdd/support/world.ts)

Notes:

- current failure is in the BDD harness path, not in the basic ability of the app to launch on Windows
- this matters because it limits confidence when validating later Windows feature work

## Recommended First Feature To Implement

Implement Windows file search first.

Reasons:

- it is the clearest user-visible gap
- the provider boundary is already isolated in [`src/main/services/launcher-search/providers/files.ts`](../src/main/services/launcher-search/providers/files.ts)
- renderer changes should not be required if the result contract stays unchanged

## Recommended Windows File Search Strategy

### Recommendation

Use Everything CLI as the first Windows implementation path.

Primary candidate:

- `voidtools/ES`: <https://github.com/voidtools/es>

Secondary references:

- `sgrottel/EverythingSearchClient`: <https://github.com/sgrottel/EverythingSearchClient>
- `Pixel-Master/File-Find`: <https://github.com/Pixel-Master/File-Find>

Why `voidtools/ES` is the best fit for this repo:

- lightweight
- fast enough for launcher search
- simple Electron main-process integration through `spawn(...)`
- avoids introducing a native Node addon
- much better latency than recursively scanning the filesystem on every query

## Suggested Scope For v1

On `win32`, the file-search provider should:

1. detect whether `es.exe` is available
2. query Everything through the CLI
3. map returned paths into the existing `LauncherSearchResult` shape
4. reuse the current title/subtitle/history-key conventions
5. keep filtering and scoring local so Windows behavior stays close to the mac implementation

The first version should not try to:

- build a custom Windows filesystem index
- recursively scan whole drives on demand
- match full Spotlight parity
- solve every Windows-specific launcher feature in one pass

## Implementation Notes For File Search

### Keep The Existing Result Contract

The current launcher search pipeline already knows how to render file results and open paths.

Relevant files:

- [`src/main/services/launcher-search/types.ts`](../src/main/services/launcher-search/types.ts)
- [`src/main/services/launcher-search/index.ts`](../src/main/services/launcher-search/index.ts)

That means the Windows work should stay inside the provider unless result semantics need to change.

### Reuse Existing Match Logic Where Possible

The current mac provider already contains useful logic for:

- normalizing search strings
- literal match scoring
- pinyin matching
- subtitle generation
- result sorting

It is worth extracting the platform-agnostic parts from [`src/main/services/launcher-search/providers/files.ts`](../src/main/services/launcher-search/providers/files.ts) so macOS and Windows share the same ranking behavior.

### Do Not Start With PowerShell Recursive Scans

Avoid a first pass based on `Get-ChildItem -Recurse` or equivalent full-tree scans.

That approach is easy to prototype but poor for launcher UX because:

- latency grows too fast on large drives
- cancellation and timeouts get messy
- result quality depends too much on path traversal order

### Plan For Soft Failure

If Everything is not installed or `es.exe` is unavailable:

- fail soft
- log a warning
- return empty results for now

That keeps the first implementation small and safe.

A fallback scanner can be added later if product requirements demand zero external dependency.

## Proposed Order Of Work

### Phase 1: Unblock The Biggest User Gap

1. implement Windows file search in [`src/main/services/launcher-search/providers/files.ts`](../src/main/services/launcher-search/providers/files.ts)
2. add focused Node-level tests for result mapping and scoring behavior
3. verify launcher behavior manually on Windows

### Phase 2: Close The Next Obvious Search Gap

1. implement Windows browser-history roots for Chrome and Edge
2. replace the mac-only `sqlite3` shelling with a cross-platform strategy
3. preserve the current ranking and dedupe rules

### Phase 3: Restore Context Features

1. add Windows clipboard file/folder parsing in [`src/main/services/clipboard.ts`](../src/main/services/clipboard.ts)
2. verify launcher clipboard chips and command-context flows

### Phase 4: Fix Windows Dev Confidence

1. fix the unified build wrapper in [`scripts/build-with-react-compiler-guard.mjs`](../scripts/build-with-react-compiler-guard.mjs)
2. fix the Windows BDD launch path in [`tests/bdd/support/world.ts`](../tests/bdd/support/world.ts)

## Validation Checklist

After implementing Windows file search, at minimum verify:

- `npm run typecheck`
- `npm run build:electron`
- manual launcher search for file names
- manual launcher search for directory names
- manual launcher search for Chinese names and pinyin input
- open-file action works
- open-directory action works
- result ordering is stable across repeated queries

After fixing Windows build and test flows, also verify:

- `pnpm run build`
- `npm run test:bdd:smoke`

## Bottom Line

Windows support is already far enough along that this should be treated as a targeted completion effort, not a fresh port.

The first implementation to do is Windows file search, and the most pragmatic first path is `voidtools/ES`.
