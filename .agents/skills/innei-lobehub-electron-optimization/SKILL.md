---
name: innei-lobehub-electron-optimization
description: Apply Innei's LobeHub Electron optimization patterns for app package size, Vite/Electron bundling, runtime dependency boundaries, route chunk prewarm, and streaming/render performance. Use when auditing or improving Electron desktop app size, startup, route navigation, renderer chunking, or large React streaming UIs.
---

# Innei LobeHub Electron Optimization

Use this skill when an Electron app feels too large, slow to start, slow to navigate, or expensive to render under streaming updates. The workflow is based on recent Innei work in LobeHub, especially packaging boundary fixes, Electron static import codemods, route chunk prewarm, dev-code dead elimination, and streaming render stabilization.

## Evidence Anchors As Playbook

The LobeHub references below are not just commit names. Treat them as reusable implementation patterns. You should still inspect the local app first, but the sections below contain the core idea, copied structure, verification target, and the situations where the pattern is not worth applying.

### Source Map For Reports

When writing an implementation report, architecture review, or migration prompt, cite the pattern name plus the source file shape below. The skill should be enough to work from without cloning LobeHub, but these references explain where the pattern came from.

| Pattern | LobeHub commit | Source files that mattered | What to cite in output |
| --- | --- | --- | --- |
| Package boundary | `07dc919496` / `#11397` | `apps/desktop/electron-builder.mjs`, `apps/desktop/electron.vite.config.ts`, `apps/desktop/native-deps.config.mjs` | Exclude `node_modules`, bundle pure JS, re-include native/runtime externals only |
| Electron Framework locale trimming | `07dc919496` / `#11397` | `apps/desktop/electron-builder.mjs` `afterPack` | Delete unused `Electron Framework.framework/.../Resources/*.lproj` after pack |
| Runtime external split | `36c4be46f0` / `#14776` | `external-runtime-deps.config.mjs`, `native-deps.config.mjs`, `module-deps.config.mjs`, `electron.vite.config.ts` | Separate native deps from non-native runtime externals |
| Desktop static imports | `ad32a61704` / `#11690` | `scripts/electronWorkflow/modifiers/*` | Convert high-frequency desktop route dynamic imports to static imports only after route-cost evidence |
| Route chunk prewarm | `8cd03c8013` / `#15109` | `plugins/vite/routeChunkPreload.ts`, `sharedRendererConfig.ts`, `vite.config.ts` | Build-time route-to-chunk manifest, small initial modulepreloads, idle warmup, heavy chunk exclusion |
| Streaming render stability | `5e1a35f259` / `#14470` | `stabilizeReferences.ts`, conversation data actions/selectors, tool UI components | Stabilize parse output references and move nested tool subtrees to selector ownership |
| Dead-code elimination | `cd3716d5e7` / `#14696` | renderer files using `__DEV__`, `vitest.config.mts` | Use bundler-defined `__DEV__` for SPA/client dev-only branches |

### Decision Map

Use this quick map before touching code:

| Symptom | First measurement | Likely pattern | Expected impact |
| --- | --- | --- | --- |
| `.app` is hundreds of MB larger than `out` | `du -sm dist/*/*.app app.asar app.asar.unpacked` and unpacked `node_modules` listing | `#11397` package boundary | Large, often hundreds of MB if Electron/CLI deps are duplicated |
| `app.asar.unpacked/node_modules` contains many packages | `find app.asar.unpacked/node_modules -maxdepth 1 -mindepth 1 -print0 \| xargs -0 du -sm` | `#11397`, `#14776` | Large if broad dependency copy is happening |
| `.app` is now mostly Electron Framework | `du -sm *.app/Contents/Frameworks/Electron\ Framework.framework/Versions/A/*` | macOS `.lproj` trimming | Medium, often 30-50 MB on macOS |
| Desktop navigation stalls on common routes | Production chunk graph and route timing | `#11690` static imports or `#15109` prewarm | Startup/navigation latency, not installed size |
| First load is okay but next route feels cold | Final HTML modulepreloads and emitted route chunks | `#15109` route prewarm | Navigation latency, not installed size |
| Streaming messages re-render whole trees | React Profiler or render-count stress case | `#14470` reference stabilization/selectors | CPU/render smoothness, not package size |
| Dev tools or diagnostics leak into production bundles | `rg package-name out dist` after production build | `#14696` `__DEV__` | JS bundle size and production cleanliness |

### Report Citation Template

When applying this skill, do not write "LobeHub did some optimizations" generically. Cite the reusable pattern and the local evidence together:

```text
Finding:
- Openwork packaged `.app` is X MB. The dominant contributor is Y.

LobeHub pattern used:
- `#11397` package boundary: exclude `node_modules`, bundle pure JS, re-include only native/runtime externals.
- Source shape: `apps/desktop/electron-builder.mjs` + `native-deps.config.mjs`.

Openwork adaptation:
- Keep A because ...
- Remove/forbid B because ...
- Add packaged-runtime audit for C because config alone does not prove final artifact contents.

Verification:
- Before: ...
- After: ...
- Packaged runtime smoke: ...
```

For each recommendation, include:
- **Pattern**: LobeHub PR/commit and the named pattern from this skill.
- **Local evidence**: measured size, chunk graph, profiler result, or package path in the current repo.
- **Adaption boundary**: which files/modules to touch and which to leave alone.
- **Risk**: startup/runtime/package-size/render risk, not vague "could break things".
- **Gate**: exact command or artifact check that proves the change worked.

### `#11397` Packaging Boundary: Exclude `node_modules`, Then Re-Include Runtime Needs

Commit: `07dc919496` / `chore(desktop): exclude node_modules from electron-builder packaging (#11397)`

Problem it solved:
- Electron Builder was packaging too much of `node_modules`.
- Some packages were dependencies only because of tests, build tooling, or frontend-only paths.
- Native modules still needed special handling because bundling or asar packing can break `.node` bindings.

Core move:
- Remove broad dependency packaging from the desktop app.
- Let Vite/Rollup bundle pure JS main/preload dependencies.
- Add `!node_modules` to Electron Builder `files`.
- Re-include only the packages that must remain real files at runtime.
- Use object-form `files` includes when pnpm symlinks are involved.
- Remove unused `asarUnpack` entries rather than keeping old "maybe needed" patterns.

LobeHub configuration shape:

```js
// apps/desktop/electron-builder.mjs
import { getAsarUnpackPatterns, getFilesPatterns } from './native-deps.config.mjs';

const config = {
  asar: true,
  asarUnpack: getAsarUnpackPatterns(),
  files: [
    'dist',
    'resources',
    'dist/renderer/**/*',
    '!resources/locales',
    '!node_modules',
    ...getFilesPatterns(),
  ],
};

export default config;
```

```ts
// apps/desktop/electron.vite.config.ts
import { defineConfig } from 'electron-vite';
import { getExternalDependencies } from './native-deps.config.mjs';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: getExternalDependencies(),
      },
    },
  },
});
```

Native dependency registry shape:

```js
// apps/desktop/native-deps.config.mjs
export const nativeModules = ['node-mac-permissions', '@napi-rs/canvas'];

export function getFilesPatterns() {
  return getDependenciesForModules(nativeModules).map((dep) => `node_modules/${dep}/**/*`);
}

export function getAsarUnpackPatterns() {
  return getFilesPatterns();
}

export function getExternalDependencies() {
  return getDependenciesForModules(nativeModules);
}
```

When adapting to Openwork:
- Keep `electron` external in Vite, but never copy `node_modules/electron`; it is the app runtime itself.
- Keep `@prisma/client` and `.prisma/client/*.node` because Prisma is runtime.
- Keep `just-bash` only if the packaged app needs its runtime files and vendor layout.
- Do not copy `prisma` CLI, `@prisma/engines`, `schema-engine-*`, optional native codecs, or any CLI/codegen package into runtime.
- Add a packaged-runtime audit that fails when forbidden packages appear; config alone is not enough evidence.

Validation target:
- `app.asar.unpacked/node_modules` should contain only native/runtime external packages with explicit reasons.
- `node_modules/electron`, `node_modules/prisma`, `node_modules/@prisma/engines`, and `schema-engine-*` should not appear in `app.asar` or `app.asar.unpacked`.
- Smoke test required runtime externals from the packaged app, not from source `node_modules`.

### macOS Electron Framework Trimming: Remove Unused `.lproj` Localizations

Source: same `#11397` packaging work; current LobeHub keeps this in `apps/desktop/electron-builder.mjs`.

Problem it solved:
- After duplicated `node_modules` is gone, Electron Framework itself becomes the largest unavoidable installed-size floor.
- The main Electron binary is not realistically shrinkable by app config, but Electron Framework resources often include many localization folders.

Core move:
- In Electron Builder `afterPack`, locate:
  `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources`
- Remove unused `*.lproj` folders.
- Keep only product-supported languages.

LobeHub shape:

```js
const keepLanguages = new Set(['en', 'en_GB', 'en-US', 'en_US']);

const config = {
  afterPack: async (context) => {
    const isMac = ['darwin', 'mas'].includes(context.electronPlatformName);
    if (!isMac) return;

    const frameworkResourcePath = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Frameworks',
      'Electron Framework.framework',
      'Versions',
      'A',
      'Resources',
    );

    try {
      const entries = await fs.readdir(frameworkResourcePath);
      await Promise.all(
        entries.map(async (file) => {
          if (!file.endsWith('.lproj')) return;

          const lang = file.split('.')[0];
          if (keepLanguages.has(lang)) return;

          await fs.rm(path.join(frameworkResourcePath, file), { force: true, recursive: true });
        }),
      );
    } catch {
      // Non-critical: Electron packaging layout can differ by platform/version.
    }
  },
};
```

Openwork measurement example from the 2026-05 packaging audit:
- `Electron Framework.framework`: about `253 MB`.
- Main `Electron Framework` binary: about `165 MB`.
- `Versions/A/Resources`: about `62 MB`.
- `*.lproj` total: about `44 MB`.
- Keeping English plus Chinese locales can usually save about `40 MB` on macOS arm64 installed app size.

Commands:

```bash
du -sm dist/mac-arm64/*.app/Contents/Frameworks/Electron\ Framework.framework/Versions/A/*
find dist/mac-arm64/*.app/Contents/Frameworks/Electron\ Framework.framework/Versions/A/Resources \
  -maxdepth 1 -name '*.lproj' -print0 | xargs -0 du -sm | sort -n
```

When not to use:
- Do not remove locales blindly if the desktop app promises native Electron menus/dialogs in those languages.
- Keep product-supported locales, not just English, if native OS dialogs or Electron-provided strings are visible in the app.
- Validate after signing/notarization because this edits packaged framework resources post-copy.

### `#14776` External Runtime Modules: Split Native Deps From Non-Native Externals

Commit: `36c4be46f0` / `fix(desktop): split runtime externals from native deps (#14776)`

Problem it solved:
- A single "external dependencies" bucket mixed two different reasons:
  native modules that cannot be bundled, and pure JS runtime modules that are externalized for process-level identity or side effects.
- That made it too easy to unpack pure JS modules or copy native dependency trees for the wrong reason.

Core move:
- Keep three separate lists:
  `electron` runtime external, native dependencies, and non-native runtime externals.
- Generate Electron Builder `files` entries separately for native deps and non-native runtime externals.
- Copy native deps to `app.asar.unpacked`.
- Keep non-native runtime externals packed in `app.asar` unless they truly need filesystem/native layout.

LobeHub split:

```js
// apps/desktop/external-runtime-deps.config.mjs
export const externalRuntimeModules = ['electron-log'];

export function getExternalRuntimeModulesFilesConfig() {
  return getModuleFilesConfig(externalRuntimeModules);
}

export async function copyExternalRuntimeModulesToSource() {
  await copyModulesToSource(externalRuntimeModules, 'runtime external module');
}
```

```js
// apps/desktop/native-deps.config.mjs
export const nativeModules = [
  ...(isDarwin ? ['node-mac-permissions'] : []),
  '@napi-rs/canvas',
  'get-windows',
  'node-screenshots',
];

export function getNativeModulesFilesConfig() {
  return getModuleFilesConfig(nativeModules);
}

export function getAsarUnpackPatterns() {
  return getModuleFilesPatterns(nativeModules);
}

export function getNativeExternalDependencies() {
  return getDependenciesForModules(nativeModules);
}
```

```ts
// apps/desktop/electron.vite.config.ts
const electronRuntimeExternals = ['electron'];
const mainProcessRuntimeExternals = [
  ...electronRuntimeExternals,
  ...externalRuntimeModules,
  'node-mac-permissions',
];

export default defineConfig({
  main: {
    build: {
      rolldownOptions: {
        external: [
          ...mainProcessRuntimeExternals,
          ...getNativeExternalDependencies(),
          'bufferutil',
          'utf-8-validate',
        ],
      },
    },
  },
  preload: {
    build: {
      rolldownOptions: {
        external: electronRuntimeExternals,
      },
    },
  },
});
```

Shared dependency resolver shape:

```js
// apps/desktop/module-deps.config.mjs
function resolveDependencies(moduleName, visited = new Set(), nodeModulesPath = sourceNodeModules) {
  if (visited.has(moduleName)) return visited;
  visited.add(moduleName);

  const packageJsonPath = path.join(nodeModulesPath, moduleName, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return visited;

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  for (const dep of Object.keys(packageJson.dependencies || {})) {
    resolveDependencies(dep, visited, nodeModulesPath);
  }
  for (const dep of Object.keys(packageJson.optionalDependencies || {})) {
    resolveDependencies(dep, visited, nodeModulesPath);
  }
  return visited;
}

export function getModuleFilesConfig(modules) {
  return getDependenciesForModules(modules).map((dep) => ({
    from: `node_modules/${dep}`,
    to: `node_modules/${dep}`,
    filter: ['**/*'],
  }));
}
```

When adapting to Openwork:
- Do not introduce this split while there are only one or two externals unless it clarifies a real bug.
- Introduce it when extension/native runtime growth makes `electron-builder.yml` a long opaque allowlist.
- Preserve a table of package, class, reason, packaged path, and unpacked/packed status.

### `#11690` Desktop Navigation: Convert High-Frequency Dynamic Imports To Static Imports

Commit: `ad32a61704` / `perf(electron): add codemods to convert dynamic imports to static (#11690)`

Problem it solved:
- In a desktop app, local disk and long-lived sessions make some web-style route splitting less valuable.
- Frequent Electron surfaces paid route-time dynamic import stalls even though those chunks were always likely to be needed.

Core move:
- Use codemods/build modifiers to turn selected `dynamic()` or `import()` boundaries into static imports for desktop builds.
- Remove unnecessary Suspense/client-only wrappers introduced only for web route splitting.
- Keep this targeted to common desktop routes and settings surfaces.

What to copy conceptually:
- Audit dynamic import boundaries before changing them.
- Convert only high-frequency desktop surfaces.
- Measure navigation delay and chunk graph before/after.

What not to copy blindly:
- Do not make every dynamic import static.
- Do not static-import heavy long-tail libraries such as Shiki, Mermaid, Cytoscape, PDF/media stacks, or syntax grammars unless the first screen truly needs them.
- Do not apply this to web/mobile builds by default.

Openwork decision rule:
- Prefer static imports for one or two high-frequency desktop-only panels where route-time loading is observable.
- Prefer route chunk prewarm when there are many route chunks and a predictable route graph.

### `#15109` Route Chunk Prewarm: Inject Small Modulepreloads And Idle Warmup

Commit: `8cd03c8013` / `perf: warm route chunks after idle (#15109)`

Problem it solved:
- Route transitions were slowed by predictable dynamic chunks.
- Preloading everything upfront would inflate first load and waste network/cache.
- Heavy renderer libraries should stay deferred.

Core move:
- Add a Vite plugin that reads the final `OutputBundle`.
- Map business route modules to emitted chunk files.
- Inject a small set of initial `<link rel="modulepreload">` tags.
- Add an idle script that warms probable next-route chunks after load.
- Exclude heavy renderer chunks from warmup.

Key rules from LobeHub:

```ts
const syntaxHighlightModulePatterns = [
  '/node_modules/@shikijs/',
  '/node_modules/shiki/',
  '/node_modules/oniguruma-to-es/',
  '/node_modules/vscode-oniguruma/',
  '/node_modules/vscode-textmate/',
];

const deferredRendererModulePatterns = [
  ...syntaxHighlightModulePatterns,
  '/node_modules/@mermaid-js/',
  '/node_modules/cytoscape/',
  '/node_modules/dagre/',
  '/node_modules/graphlib/',
  '/node_modules/mermaid/',
  '/node_modules/roughjs/',
];
```

Runtime warmup behavior:

```ts
// Simplified from LobeHub's injected script
const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))) return;

const idle = (cb) =>
  'requestIdleCallback' in window
    ? requestIdleCallback(cb, { timeout: 3000 })
    : setTimeout(() => cb({ didTimeout: true, timeRemaining: () => 16 }), 1200);

const addModulepreload = (href) => {
  const link = document.createElement('link');
  link.rel = 'modulepreload';
  link.crossOrigin = '';
  link.href = href;
  document.head.append(link);
};
```

When adapting:
- The plugin must read actual emitted chunk names, not hand-written guesses.
- Initial modulepreload should be tiny and route-prioritized.
- Idle warmup should check document visibility and save-data/2g conditions.
- Skip syntax highlighting, Mermaid, Cytoscape, graph layout, and long-tail media/PDF stacks unless the route immediately needs them.

Validation:
- Inspect final HTML for modulepreload count and size.
- Inspect emitted warmup manifest if enabled.
- Compare route navigation timings in packaged or production preview.
- Confirm first load did not pull in deferred renderer chunks.

### `#14470` Streaming Render Stability: Reference Stabilization And Self-Subscribing Tool UI

Commit: `5e1a35f259` / `fix(conversation): reduce streaming re-renders with reference stabilization and self-subscribing components (#14470)`

Problem it solved:
- Conversation parsing rebuilt the whole display tree on every streaming dispatch.
- Fresh references defeated `memo` and selector equality.
- Nested tool/result components received large changing parent props, so unchanged tool subtrees re-rendered on every chunk.

Core move:
- Stabilize parsed display trees by replacing deeply equal new subtrees with old references.
- Move nested tool/result UI from parent prop drilling to store selectors keyed by message/block/tool id.
- Add stress cases and targeted tests around high-frequency tool updates.

Reference stabilization shape:

```ts
import { replaceEqualDeep } from '@tanstack/react-query';

export const stabilizeReferences = <T>(prev: T, next: T): T => replaceEqualDeep(prev, next);
```

Reducer/update shape:

```ts
const { flatList } = parse(newDbMessages);
const stableFlatList = stabilizeReferences(get().displayMessages, flatList);

set({ dbMessages: newDbMessages, displayMessages: stableFlatList }, false, {
  payload,
  type: `dispatchMessage/${payload.type}`,
});
```

Selector ownership shape:

```ts
const findBlockById = (blockId: string, messages: UIChatMessage[]) => {
  for (const message of messages) {
    if (message.role === 'assistant' && message.id === blockId) return toAssistantContentBlock(message);
    const child = message.children?.find((item) => item.id === blockId);
    if (child) return child;
  }
};
```

When adapting:
- Only apply after observing render cascades under streaming/tool updates.
- Keep stabilization at the parse/projection boundary, not scattered through components.
- Move large nested subtrees to selectors keyed by stable ids.
- Do not add deep equality to every state update by default.

Validation:
- Add a render-count or stress fixture for repeated tool updates.
- Verify unchanged message/tool references are preserved.
- Use React Profiler or targeted tests to show the hot subtree stops re-rendering.

### `#14696` Production Dead Code: Use A Build-Time `__DEV__` Boolean

Commit: `cd3716d5e7` / `refactor(spa): use __DEV__ define instead of process.env.NODE_ENV (#14696)`

Problem it solved:
- Browser bundles kept dev-only branches or diagnostics because `process.env.NODE_ENV` was not consistently folded in SPA/client code.
- Static `process.env` checks can be less reliable across Vite/Rolldown, Electron renderer, and shared code.

Core move:
- Define a boolean global such as `__DEV__` in Vite config.
- Replace renderer/dev-only checks with `if (__DEV__)`.
- Keep dev-only tools behind dynamic imports.

Config shape:

```ts
// vite config
define: {
  __DEV__: JSON.stringify(mode !== 'production'),
}
```

Usage shape:

```ts
if (__DEV__) {
  void import('react-scan').then(({ scan }) => scan());
}
```

When adapting:
- Use for renderer/SPAs whose bundler owns the define.
- Do not replace server, main-process, preload, or shared package code unless that build also defines `__DEV__`.
- Verify production chunks no longer contain dev-only package names.

Validation:

```bash
npm run build
rg "react-scan|debug-only-package|__DEV__" out dist
```

## Boundary First

Before changing code, define five boundaries:

1. **Packaged artifacts**: downloaded installer size, installed `.app`/app directory size, `app.asar`, `app.asar.unpacked`, framework/runtime, and copied resources.
2. **Main/preload runtime**: what is bundled by Vite, what remains a runtime external, and why.
3. **Native/runtime externals**: native `.node` dependencies and non-native modules that must stay external because of process-level side effects.
4. **Renderer route/chunk graph**: first-screen chunks, high-frequency route chunks, long-tail feature chunks, and heavy renderer libraries.
5. **Render update ownership**: which store owns streaming data, which components subscribe to it, and which references are expected to stay stable.

Do not start with broad defensive exclusions or generic lazy-loading rules. Every retained package, external, preload, or warmup edge needs an explicit runtime reason.

## Evidence Pass

Run a measurement pass before proposing changes:

```bash
du -sm out dist dist/* 2>/dev/null
find dist -maxdepth 6 \( -name '*.app' -o -name '*.asar' -o -name '*.dmg' -o -name '*.exe' \) -print
find dist -type f -print0 2>/dev/null | xargs -0 du -h | sort -h | tail -40
```

If an `app.asar` exists:

```bash
npx asar list path/to/app.asar | sed -n '1,120p'
npx asar list path/to/app.asar | rg '^/node_modules/' | sed 's#^/node_modules/##; s#/.*##' | sort | uniq -c | sort -nr | sed -n '1,80p'
```

For `app.asar.unpacked`:

```bash
find path/to/app.asar.unpacked/node_modules -maxdepth 1 -mindepth 1 -print0 2>/dev/null | xargs -0 du -sm | sort -n | tail -30
find path/to/app.asar.unpacked/node_modules -type f -name '*.node' -print
```

For renderer chunks:

```bash
find out/renderer/assets -maxdepth 1 -type f -name '*.js' -print0 | xargs -0 du -k | sort -n | tail -40
rg "React.lazy|lazy\\(|import\\(" src/renderer src -g '*.ts' -g '*.tsx'
```

## Packaging Pattern

Innei's LobeHub packaging rule is:

- Let Vite bundle pure JS main/preload dependencies.
- Exclude `node_modules` from Electron Builder by default.
- Re-include only runtime externals that cannot be bundled.
- Keep native deps and non-native runtime externals in separate config files.
- Verify the packaged app, not just the build output.

Model the dependency classes explicitly:

```text
bundled pure JS deps
  -> imported by main/preload, safe for Vite/Rollup bundle, not copied as node_modules

native deps
  -> externalized from Vite, copied into node_modules, asarUnpack, include transitive deps

non-native runtime externals
  -> externalized because module identity/side effects matter, copied into node_modules, usually packed in asar unless it needs filesystem access

dev/build/test deps
  -> never packaged
```

Implementation shape:

```text
electron-builder config:
  files:
    - out/**
    - package.json
    - resources/**
    - "!node_modules"
    - object-form includes for native deps
    - object-form includes for runtime externals
  asarUnpack:
    - native dependency file patterns only

electron-vite config:
  main.rollupOptions.external:
    - electron
    - native deps
    - deliberate runtime externals
```

Use object-form `files` entries when pnpm symlinks are involved. Glob includes often miss symlinked package contents or accidentally include the wrong tree.

## Native And Runtime External Rules

For every external dependency, write down the reason:

- Native binding exists (`*.node`) or a binary engine is loaded by path.
- Runtime module identity matters, such as a logger registering a singleton IPC handler.
- The module needs filesystem layout that bundling breaks.

If none of those is true, try bundling it. If bundling fails, capture the exact failure and keep the external list narrow.

When a package is only needed for build, tests, codegen, or CLI migration scripts, move it out of runtime packaging or isolate the production runtime artifact. Do not let a CLI package pull its whole toolchain into the app.

## Electron Renderer Strategy

LobeHub used two related but opposite tactics, depending on surface:

- **Electron static imports** for common desktop routes/components: remove route-time dynamic import stalls when local disk and long-lived app sessions make bundle size less important than smooth navigation.
- **Route chunk prewarm** for complex SPA routes: keep initial HTML conservative, then idle-warm high-probability route chunks using real emitted Vite chunk URLs.

Choose the smallest tactic:

1. If there are only one or two lazy boundaries and they are high-frequency desktop surfaces, prefer static import.
2. If there is a file-router or many route chunks, build a Vite plugin that reads `OutputBundle`, maps business route modules to emitted chunk files, injects a small `modulepreload` set, then idles through warmup batches.
3. Keep heavyweight renderer libraries out of first-load warmup unless the route immediately needs them: Shiki, Mermaid, Cytoscape, Graphlib, Oniguruma, large syntax grammars, and media/PDF stacks.
4. Remove hover-time dynamic import prefetch if build-time idle warmup covers the same route; duplicated prefetch paths hide real ownership.

Warmup constraints:

- Initial `modulepreload` must be tiny and business-prioritized.
- Idle warmup must check `document.visibilityState`, `navigator.connection.saveData`, and remaining idle time.
- Use low concurrency for broad all-JS cache warmup.
- Test against final HTML and emitted manifests, not snapshots of config constants.

## Renderer Render Performance

For streaming or frequently updated trees:

- Stabilize references after parse/projection when unchanged subtrees are deep-equal. LobeHub eventually used `replaceEqualDeep` for this.
- Let expensive child subtrees self-subscribe to store selectors instead of receiving large changing props through parent render paths.
- Add selectors by entity id, block id, tool id, or message id.
- Memoize callback arrays and accordion/expanded-state values passed to context-heavy components.
- Verify with React DevTools Profiler or targeted render-count tests.

Use this only where there is an observed cascade. Do not add reference stabilization to every state update by default.

## Dead Code And Diagnostics

Use boolean Vite defines such as `__DEV__` for SPA-only dev branches so production builds can eliminate them. Do not replace server/SSR/shared code unless that build pipeline defines the same constant.

For diagnostics:

- Avoid top-level static imports of dev-only tools.
- Gate them behind `if (__DEV__) void import("tool").then(...)`.
- Verify the production chunk graph no longer contains the diagnostic dependency chain.

## Validation

A good optimization report includes:

- Before/after sizes for installer, installed app, `app.asar`, `app.asar.unpacked`, and top offenders.
- The external dependency table: package, class, reason, packaged path, unpacked or not.
- The renderer chunk table: largest chunks, first-load chunks, warmed chunks, skipped heavy chunks.
- Runtime smoke evidence from the packaged app, not only dev server.
- Targeted tests for build graph transforms and state/reference behavior.

Preferred verification commands:

```bash
npm run typecheck
npm run build
npm run dist:mac
npx electron-builder --dir --publish never
```

Adjust package-manager commands to the repo. If full packaging is blocked by signing, use unsigned directory packaging and state that limitation.

## Output Shape

When advising or implementing, lead with:

1. Current measured size/performance facts.
2. Boundary diagnosis.
3. Ordered interventions with expected impact and risk.
4. Exact verification plan.

Avoid generic "lazy load more" or "tree shake better" advice unless you tie it to an observed bundle edge.
