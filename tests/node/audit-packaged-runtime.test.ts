import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { assertMacNativeLinks } from "../../scripts/audit-packaged-runtime.mjs"

function createResourcesFixture(): {
  nativeDirectory: string
  resourcesPath: string
  root: string
} {
  const root = mkdtempSync(join(tmpdir(), "jingle-packaged-runtime-audit-"))
  const resourcesPath = join(root, "resources")
  const nativeDirectory = join(resourcesPath, "app.asar.unpacked", "out", "native")
  mkdirSync(nativeDirectory, { recursive: true })
  return { nativeDirectory, resourcesPath, root }
}

test("macOS packaged runtime audit skips executable non-Mach-O helpers", () => {
  const fixture = createResourcesFixture()
  try {
    const helperPath = join(fixture.nativeDirectory, "jingle-computer-use-linux.py")
    writeFileSync(helperPath, "#!/usr/bin/env python3\nprint('ready')\n")
    chmodSync(helperPath, 0o755)

    let inspectedCount = 0
    assertMacNativeLinks(
      { resourcesPath: fixture.resourcesPath },
      {
        platform: "darwin",
        readLinkedLibraries: () => {
          inspectedCount += 1
          return []
        }
      }
    )

    assert.equal(inspectedCount, 0)
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

test("macOS packaged runtime audit still inspects Mach-O executables", () => {
  const fixture = createResourcesFixture()
  try {
    const helperPath = join(fixture.nativeDirectory, "jingle-computer-use-macos")
    writeFileSync(helperPath, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]))
    chmodSync(helperPath, 0o755)

    const inspectedPaths: string[] = []
    assertMacNativeLinks(
      { resourcesPath: fixture.resourcesPath },
      {
        platform: "darwin",
        readLinkedLibraries: (path: string) => {
          inspectedPaths.push(path)
          return []
        }
      }
    )

    assert.deepEqual(inspectedPaths, [helperPath])
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

test("macOS packaged runtime audit rejects malformed native addons", () => {
  const fixture = createResourcesFixture()
  try {
    const addonPath = join(fixture.nativeDirectory, "binding.node")
    writeFileSync(addonPath, Buffer.from([0x7f, 0x45, 0x4c, 0x46]))

    assert.throws(
      () =>
        assertMacNativeLinks(
          { resourcesPath: fixture.resourcesPath },
          {
            platform: "darwin",
            readLinkedLibraries: () => []
          }
        ),
      /Packaged native addon is not a Mach-O file/
    )
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})
