# @openwork/extension-migration

Migration tooling for turning external extension source packages into Openwork extension packages.

The first tool in this package analyzes a Raycast extension and emits a structured Openwork migration preview:

- dependency rewrite decisions
- `aiCapability` manifest draft
- AI tool schema drafts
- runtime compatibility report with blocking issues separated from adapter/degradation/migration notes

CLI usage:

```bash
node scripts/preview-raycast-ai-migration.mjs ../raycast-extensions/extensions/notion --out-dir artifacts/notion-migration
```

`--out-dir` writes:

- `manifest.patch.json`
- `manifest.preview.ts`
- `main.preview.ts`
- `package.preview.json`
- `openwork-package/`
- `tools.preview.json`
- `tools.preview.ts`
- `utils-boundary-report.json`
- `openwork-package/tsconfig.check.json`
- `dependency-report.md`
- `runtime-compatibility.json`
- `unsupported-apis.json`
- `migration-preview.json`

`runtime-compatibility.json` is the preferred machine-readable compatibility artifact. It separates `blockingIssues` from non-blocking `compatibilityNotes`. `unsupported-apis.json` is still emitted as a compatibility alias for older migration checks.

The package is intentionally a migration-time tool. Generated Openwork packages should depend on `@openwork/extension-api` and `@openwork/extension-utils`, not on source runtime packages.
`openwork-package/tsconfig.check.json` is a migration verification config. Run TypeScript from the generated package directory to check the migrated package against the current Openwork facade packages.
The generated config maps `@openwork/*`, React, and detected third-party dependencies back to the Openwork workspace so a preview package can be type-checked from its generated directory before it is wired into the monorepo.

Generated packages also follow the extension package boundary contract. If the source extension has no assets, the tool writes `openwork-package/assets/.gitkeep` so `assets/` still exists. Boundary checks should run against the generated package mounted under `extensions/<id>`; symlinked package directories are supported.
