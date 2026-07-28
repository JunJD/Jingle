import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  assertMacNativeLinks,
  assertPackagedComputerUseHelper,
  assertPackagedNativeArchitectures,
  readNativeBinaryDescriptor
} from "../../scripts/audit-packaged-runtime.mjs"

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

test("packaged runtime requires the platform Computer Use helper", () => {
  const fixture = createResourcesFixture()
  try {
    assert.throws(
      () =>
        assertPackagedComputerUseHelper(
          { resourcesPath: fixture.resourcesPath },
          { expectedArchitecture: "arm64", platform: "darwin" }
        ),
      /Computer Use helper is missing/
    )

    const macHelper = join(fixture.nativeDirectory, "jingle-computer-use-macos")
    writeMachO(macHelper, "arm64")
    chmodSync(macHelper, 0o755)
    assert.doesNotThrow(() =>
      assertPackagedComputerUseHelper(
        { resourcesPath: fixture.resourcesPath },
        { expectedArchitecture: "arm64", platform: "darwin" }
      )
    )

    const linuxHelper = join(fixture.nativeDirectory, "jingle-computer-use-linux.py")
    writeFileSync(linuxHelper, "#!/usr/bin/env python3\nprint('ready')\n")
    chmodSync(linuxHelper, 0o755)
    assert.doesNotThrow(() =>
      assertPackagedComputerUseHelper(
        { resourcesPath: fixture.resourcesPath },
        { expectedArchitecture: "x64", platform: "linux" }
      )
    )

    const windowsHelper = join(fixture.nativeDirectory, "jingle-computer-use-windows.ps1")
    writeFileSync(windowsHelper, "Write-Output 'ready'\n")
    assert.doesNotThrow(() =>
      assertPackagedComputerUseHelper(
        { resourcesPath: fixture.resourcesPath },
        { expectedArchitecture: "x64", platform: "win32" }
      )
    )
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

test("packaged runtime rejects malformed platform Computer Use helpers", () => {
  const fixture = createResourcesFixture()
  try {
    const macHelper = join(fixture.nativeDirectory, "jingle-computer-use-macos")
    writeMachO(macHelper, "x64")
    chmodSync(macHelper, 0o755)
    assert.throws(
      () =>
        assertPackagedComputerUseHelper(
          { resourcesPath: fixture.resourcesPath },
          { expectedArchitecture: "arm64", platform: "darwin" }
        ),
      /single-architecture arm64 Mach-O/
    )

    const linuxHelper = join(fixture.nativeDirectory, "jingle-computer-use-linux.py")
    writeFileSync(linuxHelper, "#!/bin/sh\n")
    chmodSync(linuxHelper, 0o755)
    assert.throws(
      () =>
        assertPackagedComputerUseHelper(
          { resourcesPath: fixture.resourcesPath },
          { expectedArchitecture: "x64", platform: "linux" }
        ),
      /invalid Python shebang/
    )

    const windowsHelper = join(fixture.nativeDirectory, "jingle-computer-use-windows.ps1")
    writeFileSync(windowsHelper, "")
    assert.throws(
      () =>
        assertPackagedComputerUseHelper(
          { resourcesPath: fixture.resourcesPath },
          { expectedArchitecture: "x64", platform: "win32" }
        ),
      /Computer Use helper is empty/
    )
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

function writeMachO(path: string, architecture: "arm64" | "x64"): void {
  const header = Buffer.alloc(8)
  header.writeUInt32LE(0xfeedfacf, 0)
  header.writeUInt32LE(architecture === "arm64" ? 0x0100000c : 0x01000007, 4)
  writeFileSync(path, header)
}

function writeElf(path: string, architecture: "arm64" | "x64"): void {
  const header = Buffer.alloc(20)
  header.set([0x7f, 0x45, 0x4c, 0x46], 0)
  header[5] = 1
  header.writeUInt16LE(architecture === "arm64" ? 0xb7 : 0x3e, 18)
  writeFileSync(path, header)
}

function writePe(path: string, architecture: "arm64" | "x64"): void {
  const header = Buffer.alloc(80)
  header.write("MZ", 0, "ascii")
  header.writeUInt32LE(64, 0x3c)
  header.set([0x50, 0x45, 0, 0], 64)
  header.writeUInt16LE(architecture === "arm64" ? 0xaa64 : 0x8664, 68)
  writeFileSync(path, header)
}

test("native binary descriptor reads declared macOS, Linux, and Windows architectures", () => {
  const root = mkdtempSync(join(tmpdir(), "jingle-native-architecture-descriptor-"))
  try {
    const machO = join(root, "mac")
    const elf = join(root, "linux")
    const pe = join(root, "windows.exe")
    writeMachO(machO, "arm64")
    writeElf(elf, "x64")
    writePe(pe, "x64")

    assert.deepEqual(readNativeBinaryDescriptor(machO), {
      architectures: ["arm64"],
      format: "mach-o"
    })
    assert.deepEqual(readNativeBinaryDescriptor(elf), {
      architectures: ["x64"],
      format: "elf"
    })
    assert.deepEqual(readNativeBinaryDescriptor(pe), {
      architectures: ["x64"],
      format: "pe"
    })
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test("packaged architecture audit verifies the application, native addons, and helpers", () => {
  const fixture = createResourcesFixture()
  try {
    const executablePath = join(fixture.root, "Jingle")
    const addonPath = join(fixture.nativeDirectory, "binding.node")
    const helperPath = join(fixture.nativeDirectory, "jingle-computer-use-macos")
    const scriptPath = join(fixture.nativeDirectory, "jingle-computer-use-linux.py")
    for (const path of [executablePath, addonPath, helperPath]) writeMachO(path, "arm64")
    writeFileSync(scriptPath, "#!/usr/bin/env python3\n")
    for (const path of [executablePath, helperPath, scriptPath]) chmodSync(path, 0o755)

    assert.doesNotThrow(() =>
      assertPackagedNativeArchitectures(
        { executablePath, resourcesPath: fixture.resourcesPath },
        { expectedArchitecture: "arm64", platform: "darwin" }
      )
    )

    writeMachO(addonPath, "x64")
    assert.throws(
      () =>
        assertPackagedNativeArchitectures(
          { executablePath, resourcesPath: fixture.resourcesPath },
          { expectedArchitecture: "arm64", platform: "darwin" }
        ),
      /native addon.*expected only arm64/
    )
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

test("packaged architecture audit rejects cross-platform and ambiguous application binaries", () => {
  const fixture = createResourcesFixture()
  try {
    const executablePath = join(fixture.root, "Jingle")
    writePe(executablePath, "x64")

    assert.throws(
      () =>
        assertPackagedNativeArchitectures(
          { executablePath, resourcesPath: fixture.resourcesPath },
          { expectedArchitecture: "x64", platform: "linux" }
        ),
      /application executable has pe format, expected elf/
    )

    assert.throws(
      () =>
        assertPackagedNativeArchitectures(
          { executablePath, resourcesPath: fixture.resourcesPath },
          {
            expectedArchitecture: "x64",
            platform: "win32",
            readDescriptor: () => ({ architectures: ["x64", "arm64"], format: "pe" })
          }
        ),
      /expected only x64/
    )
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

test("packaged architecture audit rejects a Windows helper without POSIX execute bits", () => {
  const fixture = createResourcesFixture()
  try {
    const executablePath = join(fixture.root, "Jingle.exe")
    const helperPath = join(fixture.nativeDirectory, "wrong-architecture-helper.exe")
    writePe(executablePath, "x64")
    writePe(helperPath, "arm64")
    chmodSync(helperPath, 0o644)

    assert.throws(
      () =>
        assertPackagedNativeArchitectures(
          { executablePath, resourcesPath: fixture.resourcesPath },
          { expectedArchitecture: "x64", platform: "win32" }
        ),
      /native helper.*arm64.*expected only x64/
    )
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

test("packaged architecture audit rejects malformed files with native extensions", () => {
  const fixture = createResourcesFixture()
  try {
    const executablePath = join(fixture.root, "Jingle.exe")
    const helperPath = join(fixture.nativeDirectory, "malformed-helper.exe")
    writePe(executablePath, "x64")
    writeFileSync(helperPath, "#!/bin/not-a-pe\n")
    chmodSync(helperPath, 0o644)

    assert.throws(
      () =>
        assertPackagedNativeArchitectures(
          { executablePath, resourcesPath: fixture.resourcesPath },
          { expectedArchitecture: "x64", platform: "win32" }
        ),
      /native helper is not a recognized native binary/
    )
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

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
