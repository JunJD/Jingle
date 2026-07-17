import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createFileExtensionRuntimeCacheBackend } from "../../src/extension-runtime/cache-backend"

const cacheIdentity = {
  commandConfigGeneration: 1,
  connectionConfigGeneration: 2,
  connectionId: "workspace",
  credentialGeneration: 3,
  extensionConfigGeneration: 4,
  kind: "available" as const,
  runtimeArtifactRevision: "1.2.3",
  runtimePackageRevision: "1.2.3"
}

test("file runtime cache backend persists entries by extension and namespace", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "jingle-runtime-cache-"))

  try {
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    backend.saveStore(
      {
        commandName: "search-page",
        extensionName: "notion",
        identity: cacheIdentity,
        namespace: "recent-pages"
      },
      [["page", "page-1"]]
    )
    backend.saveStore(
      {
        commandName: "notifications",
        extensionName: "github",
        identity: cacheIdentity,
        namespace: "recent-pages"
      },
      [["issue", "issue-1"]]
    )

    const reloadedBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    assert.deepEqual(
      reloadedBackend.loadStore({
        commandName: "search-page",
        extensionName: "notion",
        identity: cacheIdentity,
        namespace: "recent-pages"
      }),
      [["page", "page-1"]]
    )
    assert.deepEqual(
      reloadedBackend.loadStore({
        commandName: "notifications",
        extensionName: "github",
        identity: cacheIdentity,
        namespace: "recent-pages"
      }),
      [["issue", "issue-1"]]
    )
  } finally {
    rmSync(cacheDir, { force: true, recursive: true })
  }
})
