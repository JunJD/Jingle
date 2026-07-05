import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createFileExtensionRuntimeCacheBackend } from "../../src/extension-runtime/cache-backend"

test("file runtime cache backend persists entries by extension and namespace", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "jingle-runtime-cache-"))

  try {
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    backend.saveStore(
      {
        extensionName: "notion",
        namespace: "recent-pages"
      },
      [["page", "page-1"]]
    )
    backend.saveStore(
      {
        extensionName: "github",
        namespace: "recent-pages"
      },
      [["issue", "issue-1"]]
    )

    const reloadedBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    assert.deepEqual(
      reloadedBackend.loadStore({
        extensionName: "notion",
        namespace: "recent-pages"
      }),
      [["page", "page-1"]]
    )
    assert.deepEqual(
      reloadedBackend.loadStore({
        extensionName: "github",
        namespace: "recent-pages"
      }),
      [["issue", "issue-1"]]
    )
  } finally {
    rmSync(cacheDir, { force: true, recursive: true })
  }
})
