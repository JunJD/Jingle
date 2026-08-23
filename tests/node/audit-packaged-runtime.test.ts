import assert from "node:assert/strict"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  COMPUTER_USE_NATIVE_ACTIONS,
  getComputerUseNativeEnvironmentPolicy
} from "../../packages/computer-use-core/native-policy.mjs"

import {
  assertMacNativeLinks,
  assertPackagedComputerUseHelper,
  assertPackagedElectronLocales,
  assertPackagedNativeArchitectures,
  assertWindowsComputerUseHelperProbe,
  readNativeBinaryDescriptor,
  runWindowsComputerUseProbe
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

function createValidWindowsProbe() {
  const environment = "windows-win32" as const
  const policy = getComputerUseNativeEnvironmentPolicy(environment)
  return {
    capabilities: COMPUTER_USE_NATIVE_ACTIONS.map((action) => ({
      action,
      background: policy.capabilities[action].background[0],
      foreground: policy.capabilities[action].foreground[0],
      route: policy.capabilities[action].route
    })),
    environment,
    platform: policy.platform,
    protocolVersion: 1
  }
}

test("runs packaged runtime audit only after electron-builder releases final executables", () => {
  const afterPackSource = readFileSync("scripts/after-pack-audit.cjs", "utf8")
  assert.match(afterPackSource, /pruneMacElectronLocales/)
  assert.doesNotMatch(afterPackSource, /audit-packaged-runtime|spawnSync/)

  const runnerSource = readFileSync("scripts/run-electron-builder.mjs", "utf8")
  const resetRoots = runnerSource.lastIndexOf("resetPackagedAuditRoots(args)")
  const builderSpawn = runnerSource.indexOf("const child = spawn(")
  const builderClose = runnerSource.indexOf('child.on("close"')
  const finalAudit = runnerSource.lastIndexOf("auditPackagedOutputs(args)")
  assert.ok(resetRoots >= 0 && resetRoots < builderSpawn)
  assert.ok(builderSpawn < builderClose && finalAudit > builderClose)
  assert.match(
    runnerSource,
    /function resetPackagedAuditRoots[\s\S]*?rmSync\(candidate, \{ force: true, recursive: true \}\)/
  )
  assert.match(
    runnerSource,
    /const missingGroups = groups\.filter\([\s\S]*?missingGroups\.length > 0[\s\S]*?did not produce requested unpacked roots/
  )
  assert.match(runnerSource, /arch === "x64" \? "win-unpacked" : `win-\$\{arch\}-unpacked`/)
  assert.match(runnerSource, /arch === "x64" \? "linux-unpacked" : `linux-\$\{arch\}-unpacked`/)
  assert.match(runnerSource, /join\(distRoot, `mac-\$\{arch\}`\)/)
  assert.match(runnerSource, /join\(distRoot, "mac-universal"\)/)
  assert.match(runnerSource, /audit-packaged-runtime\.mjs/)
  assert.match(runnerSource, /timeout: 180_000/)
})

test("packages canonical Electron locales for each desktop platform", () => {
  const builderConfig = readFileSync("electron-builder.yml", "utf8")
  assert.doesNotMatch(builderConfig, /^electronLanguages:/m)
  assert.ok(
    builderConfig.includes(
      "mac:\n  electronLanguages:\n    - en\n    - en_GB\n    - zh_CN\n    - zh_TW"
    )
  )
  assert.ok(
    builderConfig.includes(
      "win:\n  electronLanguages:\n    - en-US\n    - en-GB\n    - zh-CN\n    - zh-TW"
    )
  )
  assert.ok(
    builderConfig.includes(
      "linux:\n  electronLanguages:\n    - en-US\n    - en-GB\n    - zh-CN\n    - zh-TW"
    )
  )

  for (const [platform, locales] of [
    ["darwin", ["en.lproj", "en_GB.lproj", "zh_CN.lproj", "zh_TW.lproj"]],
    ["win32", ["en-US.pak", "en-GB.pak", "zh-CN.pak", "zh-TW.pak"]],
    ["linux", ["en-US.pak", "en-GB.pak", "zh-CN.pak", "zh-TW.pak"]]
  ] as const) {
    const root = mkdtempSync(join(tmpdir(), `jingle-electron-locales-${platform}-`))
    const appPath = platform === "darwin" ? join(root, "Jingle.app") : root
    const localeRoot =
      platform === "darwin"
        ? join(
            appPath,
            "Contents",
            "Frameworks",
            "Electron Framework.framework",
            "Versions",
            "A",
            "Resources"
          )
        : join(appPath, "locales")
    try {
      for (const locale of locales) {
        const localePath =
          platform === "darwin" ? join(localeRoot, locale, "locale.pak") : join(localeRoot, locale)
        mkdirSync(join(localePath, ".."), { recursive: true })
        writeFileSync(localePath, "locale")
      }
      assert.doesNotThrow(() => assertPackagedElectronLocales({ appPath }, platform))

      const lastLocale = locales.at(-1)!
      const missingLocale =
        platform === "darwin"
          ? join(localeRoot, lastLocale, "locale.pak")
          : join(localeRoot, lastLocale)
      rmSync(missingLocale, { force: true, recursive: true })
      assert.throws(
        () => assertPackagedElectronLocales({ appPath }, platform),
        /locale is missing or empty/
      )

      writeFileSync(missingLocale, "")
      assert.throws(
        () => assertPackagedElectronLocales({ appPath }, platform),
        /locale is missing or empty/
      )

      const symlinkTarget = join(root, "foreign-locale.pak")
      writeFileSync(symlinkTarget, "foreign")
      rmSync(missingLocale, { force: true })
      symlinkSync(symlinkTarget, missingLocale)
      assert.throws(
        () => assertPackagedElectronLocales({ appPath }, platform),
        /locale is missing or empty/
      )

      if (platform === "darwin") {
        const localeContainer = join(localeRoot, lastLocale)
        const foreignContainer = join(root, "foreign-locale.lproj")
        mkdirSync(foreignContainer, { recursive: true })
        writeFileSync(join(foreignContainer, "locale.pak"), "foreign")
        rmSync(localeContainer, { force: true, recursive: true })
        symlinkSync(foreignContainer, localeContainer, "dir")
        assert.throws(
          () => assertPackagedElectronLocales({ appPath }, platform),
          /locale is missing or empty/
        )
      }

      const foreignLocaleRoot = join(root, "foreign-locales")
      for (const locale of locales) {
        const localePath =
          platform === "darwin"
            ? join(foreignLocaleRoot, locale, "locale.pak")
            : join(foreignLocaleRoot, locale)
        mkdirSync(join(localePath, ".."), { recursive: true })
        writeFileSync(localePath, "foreign")
      }
      rmSync(localeRoot, { force: true, recursive: true })
      symlinkSync(foreignLocaleRoot, localeRoot, "dir")
      assert.throws(
        () => assertPackagedElectronLocales({ appPath }, platform),
        /locale root is missing or invalid/
      )
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  }
})

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
    const probedPaths: string[] = []
    assert.doesNotThrow(() =>
      assertPackagedComputerUseHelper(
        { resourcesPath: fixture.resourcesPath },
        {
          expectedArchitecture: "x64",
          platform: "win32",
          runWindowsProbe: (path: string) => {
            probedPaths.push(path)
            return JSON.stringify(createValidWindowsProbe())
          }
        }
      )
    )
    assert.deepEqual(probedPaths, [windowsHelper])
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

test("packaged runtime constructs the production Windows probe invocation", () => {
  const helperPath =
    "C:\\Jingle\\resources\\app.asar.unpacked\\out\\native\\jingle-computer-use-windows.ps1"
  const calls: unknown[][] = []

  runWindowsComputerUseProbe(helperPath, {
    execute: (...args: unknown[]) => {
      calls.push(args)
      return JSON.stringify(createValidWindowsProbe())
    }
  })

  assert.equal(calls.length, 1)
  const [command, args, options] = calls[0] as [
    string,
    string[],
    { encoding: string; input: string; maxBuffer: number; timeout: number; windowsHide: boolean }
  ]
  assert.equal(command, "powershell.exe")
  assert.deepEqual(args, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    helperPath
  ])
  assert.deepEqual(JSON.parse(options.input), {
    environment: "windows-win32",
    method: "probe",
    protocolVersion: 1,
    requestPermission: false
  })
  assert.deepEqual(
    {
      encoding: options.encoding,
      maxBuffer: options.maxBuffer,
      timeout: options.timeout,
      windowsHide: options.windowsHide
    },
    { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 30_000, windowsHide: true }
  )
})

test("packaged runtime rejects invalid Windows Computer Use probe frames", () => {
  const helperPath =
    "C:\\Jingle\\resources\\app.asar.unpacked\\out\\native\\jingle-computer-use-windows.ps1"
  const validProbe = createValidWindowsProbe()

  for (const [raw, pattern] of [
    ["not-json", /invalid JSON/],
    [JSON.stringify({ ...validProbe, protocolVersion: 2 }), /another environment or protocol/],
    [
      JSON.stringify({
        ...validProbe,
        capabilities: validProbe.capabilities.map((entry, index) =>
          index === 1 ? { ...entry, route: "unavailable" } : entry
        )
      }),
      /untrusted route for press/
    ],
    [`${JSON.stringify(validProbe)}\n${JSON.stringify(validProbe)}`, /invalid response frame/]
  ] as const) {
    assert.throws(
      () => assertWindowsComputerUseHelperProbe(helperPath, { runProbe: () => raw }),
      pattern
    )
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
