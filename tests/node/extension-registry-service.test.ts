import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { promisify } from "node:util"
import * as React from "react"
import * as ReactJsxDevRuntime from "react/jsx-dev-runtime"
import * as ReactJsxRuntime from "react/jsx-runtime"
import {
  createExtensionRuntimeLaunchProps,
  ExtensionRuntimeNavigationProvider,
  installExtensionRuntimeReactBridge
} from "@jingle/extension-api/host-runtime"
import { nativeExtensionManifests } from "../../src/extensions"
import { createExtensionRuntimeRenderer } from "../../src/extension-runtime/reconciler/render"
import { createBuiltInExtensionRegistryService } from "../../src/main/extensions/registry/built-in-registry"
import { InstalledExtensionProvider } from "../../src/main/extensions/registry/installed-provider"
import { createExtensionRegistryService } from "../../src/main/extensions/registry/service"
import { loadExtensionMainDefinition } from "../../src/main/extensions/registry/main-loader"
import { loadNativeExtensionRuntimeCommand } from "../../src/extension-runtime/runtime-package-loader"
import type {
  ExtensionHostResponse,
  ExtensionRuntimeLaunchContext
} from "../../src/shared/extension-runtime-protocol"
import { buildNativeLauncherCommandOwners } from "../../src/renderer/src/extension-host"
import { toNativeExtensionLauncherCatalogProjection } from "../../src/shared/native-extensions"

const execFileAsync = promisify(execFile)

test("built-in extension registry mirrors the current static manifest registry", () => {
  const registry = createBuiltInExtensionRegistryService()

  assert.deepEqual(
    registry.listManifests("darwin").map((manifest) => manifest.name),
    nativeExtensionManifests.map((manifest) => manifest.name)
  )
  assert.equal(registry.getLoadedPackage("apple-reminders"), null)
  assert.equal(registry.getLoadedPackage("figma-files"), null)
  assert.equal(registry.getRuntimePackageRef("apple-reminders"), null)
})

test("built-in extension registry resolves package-owned assets", () => {
  const registry = createBuiltInExtensionRegistryService()

  assert.match(
    registry.resolveAsset("todo-list", "assets/icon.svg"),
    /src\/extensions\/todo-list\/assets\/icon\.svg$/
  )
  assert.throws(
    () => registry.resolveAsset("todo-list", "../manifest.ts"),
    /escapes its assets directory/
  )
  assert.throws(() => registry.resolveAsset("github", "assets/icon.svg"), /Unknown extension/)
  assert.throws(
    () => registry.resolveAsset("figma-files", "assets/command-icon.png"),
    /Unknown extension/
  )
})

test("extension CLI builds bundled trusted extensions as installed runtime packages", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "jingle-installed-packages-"))
  try {
    await execFileAsync(
      process.execPath,
      ["scripts/build-installed-extension.mjs", "--out-dir", rootDir],
      { cwd: process.cwd() }
    )

    const registry = await createExtensionRegistryService([new InstalledExtensionProvider(rootDir)])
    assert.deepEqual(
      registry.listManifests("darwin").map((manifest) => manifest.name),
      ["apple-reminders", "coffee", "figma-files", "github", "notion"]
    )

    const extensionPackage = registry.getLoadedPackage("apple-reminders")
    const coffeePackage = registry.getLoadedPackage("coffee")
    const figmaFilesPackage = registry.getLoadedPackage("figma-files")
    const githubPackage = registry.getLoadedPackage("github")
    const notionPackage = registry.getLoadedPackage("notion")

    assert.ok(extensionPackage)
    assert.ok(coffeePackage)
    assert.ok(figmaFilesPackage)
    assert.ok(githubPackage)
    assert.ok(notionPackage)
    assert.equal(extensionPackage.source, "installed")
    assert.equal(extensionPackage.trust, "trusted")
    assert.equal(extensionPackage.runtime?.kind, "module")
    assert.equal(extensionPackage.main?.kind, "module")
    assert.equal(extensionPackage.main?.trust, "trusted")
    assert.equal(extensionPackage.runtimeMetadata?.extensionName, "apple-reminders")
    assert.equal(coffeePackage.source, "installed")
    assert.equal(coffeePackage.trust, "trusted")
    assert.equal(coffeePackage.runtime?.kind, "module")
    assert.equal(coffeePackage.main?.kind, "module")
    assert.equal(coffeePackage.main?.trust, "trusted")
    assert.equal(coffeePackage.runtimeMetadata?.extensionName, "coffee")
    assert.equal(figmaFilesPackage.source, "installed")
    assert.equal(figmaFilesPackage.trust, "trusted")
    assert.equal(figmaFilesPackage.runtime?.kind, "module")
    assert.equal(figmaFilesPackage.main?.kind, "module")
    assert.equal(figmaFilesPackage.main?.trust, "trusted")
    assert.equal(figmaFilesPackage.runtimeMetadata?.extensionName, "figma-files")
    assert.equal(githubPackage.source, "installed")
    assert.equal(githubPackage.trust, "trusted")
    assert.equal(githubPackage.runtime?.kind, "module")
    assert.equal(githubPackage.main?.kind, "module")
    assert.equal(githubPackage.main?.trust, "trusted")
    assert.equal(githubPackage.runtimeMetadata?.extensionName, "github")
    assert.equal(notionPackage.source, "installed")
    assert.equal(notionPackage.trust, "trusted")
    assert.equal(notionPackage.runtime?.kind, "module")
    assert.equal(notionPackage.main?.kind, "module")
    assert.equal(notionPackage.main?.trust, "trusted")
    assert.equal(notionPackage.runtimeMetadata?.extensionName, "notion")
    assert.ok(extensionPackage.main)
    const mainBundle = await readFile(extensionPackage.main.modulePath, "utf8")
    assert.doesNotMatch(mainBundle, /__dirname/)
    assert.doesNotMatch(mainBundle, /Jingle extension runtime React bridge is not installed/)
    assert.doesNotMatch(mainBundle, /jingle-runtime-shim:react/)
    assert.match(
      registry.resolveAsset("apple-reminders", "assets/icon.svg"),
      /apple-reminders\/0\.0\.0\/assets\/icon\.svg$/
    )
    assert.match(
      registry.resolveAsset("coffee", "assets/logo.png"),
      /coffee\/0\.0\.0\/assets\/logo\.png$/
    )
    assert.match(
      registry.resolveAsset("figma-files", "assets/command-icon.png"),
      /figma-files\/0\.0\.0\/assets\/command-icon\.png$/
    )
    assert.match(
      registry.resolveAsset("github", "assets/icon.svg"),
      /github\/0\.0\.0\/assets\/icon\.svg$/
    )
    assert.match(
      registry.resolveAsset("notion", "assets/notion-logo.png"),
      /notion\/0\.0\.0\/assets\/notion-logo\.png$/
    )

    const launcherProjection = toNativeExtensionLauncherCatalogProjection(
      extensionPackage.manifest,
      extensionPackage.runtimeMetadata
    )
    const coffeeLauncherProjection = toNativeExtensionLauncherCatalogProjection(
      coffeePackage.manifest,
      coffeePackage.runtimeMetadata
    )
    const figmaFilesLauncherProjection = toNativeExtensionLauncherCatalogProjection(
      figmaFilesPackage.manifest,
      figmaFilesPackage.runtimeMetadata
    )
    const githubLauncherProjection = toNativeExtensionLauncherCatalogProjection(
      githubPackage.manifest,
      githubPackage.runtimeMetadata
    )
    const notionLauncherProjection = toNativeExtensionLauncherCatalogProjection(
      notionPackage.manifest,
      notionPackage.runtimeMetadata
    )
    assert.deepEqual(
      launcherProjection.commands.map((command) => command.name),
      ["my-reminders", "create-reminder", "quick-add-reminder"]
    )
    assert.deepEqual(
      coffeeLauncherProjection.commands.map((command) => command.name),
      [
        "caffeinate",
        "decaffeinate",
        "caffeinateToggle",
        "caffeinateFor",
        "caffeinateUntil",
        "status"
      ]
    )
    assert.deepEqual(
      notionLauncherProjection.commands.find((command) => command.name === "search-page")?.search,
      {
        aliases: ["search page", "search pages", "search"],
        keywords: ["notion", "search", "find", "look up", "搜索", "查找", "查询"]
      }
    )
    const launcherOwners = buildNativeLauncherCommandOwners([
      launcherProjection,
      coffeeLauncherProjection,
      figmaFilesLauncherProjection,
      githubLauncherProjection,
      notionLauncherProjection
    ])
    const launcherOwner = launcherOwners.find((owner) => owner.manifest.id === "apple-reminders")
    assert.ok(launcherOwner)
    assert.equal(launcherOwner.manifest.id, "apple-reminders")
    assert.deepEqual(
      launcherOwner.manifest.commands.map((command) => command.name),
      ["my-reminders", "create-reminder", "quick-add-reminder"]
    )
    for (const command of launcherOwner.commands) {
      assert.equal(command.resolveCommand, undefined)
    }
    assert.ok(
      launcherOwners
        .find((owner) => owner.manifest.id === "coffee")
        ?.manifest.commands.some((command) => command.name === "status")
    )
    assert.ok(
      launcherOwners
        .find((owner) => owner.manifest.id === "figma-files")
        ?.manifest.commands.some((command) => command.name === "index")
    )
    assert.ok(
      launcherOwners
        .find((owner) => owner.manifest.id === "github")
        ?.manifest.commands.some((command) => command.name === "search-repositories")
    )
    assert.ok(
      launcherOwners
        .find((owner) => owner.manifest.id === "notion")
        ?.manifest.commands.some((command) => command.name === "search-page")
    )

    const notionRuntimeMetadataJson = JSON.parse(
      await readFile(join(notionPackage.rootDir, "runtime-metadata.json"), "utf8")
    ) as { commands: Array<{ name: string; search?: unknown }> }
    assert.deepEqual(
      notionRuntimeMetadataJson.commands.map((command) => command.name),
      ["add-text-to-page", "create-database-page", "quick-capture", "search-page"]
    )
    assert.deepEqual(
      notionRuntimeMetadataJson.commands.find((command) => command.name === "search-page")?.search,
      {
        aliases: ["search page", "search pages", "search"],
        keywords: ["notion", "search", "find", "look up", "搜索", "查找", "查询"]
      }
    )

    installRuntimeReactBridge()
    const runtimeRef = extensionPackage.runtime
    assert.ok(runtimeRef)
    assert.equal(runtimeRef.kind, "module")
    const command = await loadNativeExtensionRuntimeCommand(
      {
        extensionName: runtimeRef.extensionName,
        kind: "module",
        modulePath: runtimeRef.modulePath,
        version: runtimeRef.version
      },
      {
        commandName: "quick-add-reminder",
        extensionName: "apple-reminders"
      }
    )

    assert.equal(command.mode, "no-view")
    assert.equal(typeof command.run, "function")

    const coffeeRuntimeRef = coffeePackage.runtime
    assert.ok(coffeeRuntimeRef)
    assert.equal(coffeeRuntimeRef.kind, "module")
    const coffeeCommand = await loadNativeExtensionRuntimeCommand(
      {
        extensionName: coffeeRuntimeRef.extensionName,
        kind: "module",
        modulePath: coffeeRuntimeRef.modulePath,
        version: coffeeRuntimeRef.version
      },
      {
        commandName: "status",
        extensionName: "coffee"
      }
    )
    assert.equal(coffeeCommand.mode, "no-view")
    assert.equal(typeof coffeeCommand.run, "function")

    const githubRuntimeRef = githubPackage.runtime
    assert.ok(githubRuntimeRef)
    assert.equal(githubRuntimeRef.kind, "module")
    const githubCommand = await loadNativeExtensionRuntimeCommand(
      {
        extensionName: githubRuntimeRef.extensionName,
        kind: "module",
        modulePath: githubRuntimeRef.modulePath,
        version: githubRuntimeRef.version
      },
      {
        commandName: "search-repositories",
        extensionName: "github"
      }
    )
    assert.equal(githubCommand.mode, "view")
    assert.equal(typeof githubCommand.Component, "function")

    const figmaFilesRuntimeRef = figmaFilesPackage.runtime
    assert.ok(figmaFilesRuntimeRef)
    assert.equal(figmaFilesRuntimeRef.kind, "module")
    const figmaFilesCommand = await loadNativeExtensionRuntimeCommand(
      {
        extensionName: figmaFilesRuntimeRef.extensionName,
        kind: "module",
        modulePath: figmaFilesRuntimeRef.modulePath,
        version: figmaFilesRuntimeRef.version
      },
      {
        commandName: "index",
        extensionName: "figma-files"
      }
    )
    assert.equal(figmaFilesCommand.mode, "view")
    assert.equal(typeof figmaFilesCommand.Component, "function")

    const notionRuntimeRef = notionPackage.runtime
    assert.ok(notionRuntimeRef)
    assert.equal(notionRuntimeRef.kind, "module")
    const notionCommand = await loadNativeExtensionRuntimeCommand(
      {
        extensionName: notionRuntimeRef.extensionName,
        kind: "module",
        modulePath: notionRuntimeRef.modulePath,
        version: notionRuntimeRef.version
      },
      {
        commandName: "search-page",
        extensionName: "notion"
      }
    )
    assert.equal(notionCommand.mode, "view")
    assert.equal(typeof notionCommand.Component, "function")

    const menuBarCommand = await loadNativeExtensionRuntimeCommand(
      {
        extensionName: runtimeRef.extensionName,
        kind: "module",
        modulePath: runtimeRef.modulePath,
        version: runtimeRef.version
      },
      {
        commandName: "menu-bar-reminders",
        extensionName: "apple-reminders"
      }
    )
    assert.equal(menuBarCommand.mode, "menu-bar")
    assert.ok(menuBarCommand.Component)

    const launchContext: ExtensionRuntimeLaunchContext = {
      commandName: "menu-bar-reminders",
      commandPreferences: {
        countType: "all",
        displayListTitleForMenuBarReminders: false,
        hideMenuBarCountWhenEmpty: false,
        refreshIntervalSeconds: 60,
        sortMenuBarRemindersByDueDate: false,
        titleType: "count",
        view: "all"
      },
      dataIdentity: { kind: "unavailable" },
      extensionName: "apple-reminders",
      extensionPreferences: {},
      initialAction: "open",
      locale: "zh-CN",
      mode: "menu-bar",
      seedQuery: ""
    }
    const renderer = createExtensionRuntimeRenderer({
      commandName: launchContext.commandName,
      extensionName: launchContext.extensionName
    })
    const requestHost = async (request: { capability: string }): Promise<ExtensionHostResponse> => {
      if (request.capability === "rpc") {
        return {
          id: "test-response",
          ok: true,
          result: {
            lists: [],
            reminders: []
          }
        }
      }

      return {
        id: "test-response",
        ok: true,
        result: {}
      }
    }

    renderer.render(
      React.createElement(
        ExtensionRuntimeNavigationProvider,
        {
          value: {
            ...launchContext,
            reportFatalError: () => {},
            requestHost
          }
        },
        React.createElement(
          menuBarCommand.Component,
          createExtensionRuntimeLaunchProps(launchContext)
        )
      )
    )
    await renderer.flushSnapshots()
    assert.equal(renderer.getSnapshot()?.kind, "menu-bar")
    renderer.render(null)
    await renderer.flushSnapshots()
  } finally {
    await rm(rootDir, { force: true, recursive: true })
  }
})

test("native extension launcher catalog and source mention catalog stay separate", async () => {
  const previousJingleHome = process.env.JINGLE_HOME
  const previousRendererUrl = process.env.ELECTRON_RENDERER_URL
  const jingleHome = await mkdtemp(join(tmpdir(), "jingle-extension-catalog-"))

  try {
    process.env.JINGLE_HOME = jingleHome
    delete process.env.ELECTRON_RENDERER_URL
    const { listNativeExtensionLauncherCatalog, listNativeExtensionSourceMentions } = await import(
      `../../src/main/services/native-extensions?catalog-test=${Date.now()}`
    )

    assert.deepEqual(
      listNativeExtensionLauncherCatalog("darwin").map((extension) => extension.extName),
      ["todo-list", "translate"]
    )
    assert.deepEqual(
      listNativeExtensionSourceMentions("darwin").map((mention) => ({
        extensionName: mention.extensionName,
        sourceId: mention.sourceId,
        value: mention.value
      })),
      []
    )
  } finally {
    if (previousJingleHome === undefined) {
      delete process.env.JINGLE_HOME
    } else {
      process.env.JINGLE_HOME = previousJingleHome
    }
    if (previousRendererUrl === undefined) {
      delete process.env.ELECTRON_RENDERER_URL
    } else {
      process.env.ELECTRON_RENDERER_URL = previousRendererUrl
    }
    await rm(jingleHome, { force: true, recursive: true })
  }
})

test("extension CLI dev fails fast when the initial build fails", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "jingle-bad-extension-source-"))
  const outputRoot = await mkdtemp(join(tmpdir(), "jingle-bad-extension-out-"))

  try {
    await writeFile(
      join(sourceRoot, "package.json"),
      JSON.stringify({
        name: "bad-extension",
        version: "0.0.0"
      })
    )

    await assert.rejects(
      () =>
        execFileAsync(
          process.execPath,
          ["packages/extension-cli/src/cli.mjs", "dev", sourceRoot, "--out-dir", outputRoot],
          { cwd: process.cwd(), timeout: 5000 }
        ),
      (error) => {
        assert.equal((error as { code?: number }).code, 1)
        assert.match(
          `${(error as { stderr?: string }).stderr ?? ""}\n${(error as { stdout?: string }).stdout ?? ""}`,
          /manifest\.ts/
        )
        return true
      }
    )
  } finally {
    await rm(sourceRoot, { force: true, recursive: true })
    await rm(outputRoot, { force: true, recursive: true })
  }
})

test("extension CLI rejects function search adapters in installable runtime metadata", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "jingle-function-metadata-source-"))
  const outputRoot = await mkdtemp(join(tmpdir(), "jingle-function-metadata-out-"))

  try {
    await writeFile(
      join(sourceRoot, "package.json"),
      JSON.stringify({
        name: "function-search-extension",
        version: "0.0.0"
      })
    )
    await writeFile(
      join(sourceRoot, "manifest.ts"),
      [
        'import { defineNativeExtensionManifest } from "@jingle/extension-api"',
        "",
        "export const manifest = defineNativeExtensionManifest({",
        "  capabilities: [],",
        "  commands: [],",
        "  connection: {",
        "    auth: { type: \"none\" },",
        "    id: \"default\",",
        '    provider: "function-search",',
        '    title: "Function Search"',
        "  },",
        '  name: "function-search",',
        '  title: "Function Search"',
        "})",
        ""
      ].join("\n")
    )
    await writeFile(
      join(sourceRoot, "runtime-metadata.ts"),
      [
        'import { defineNativeExtensionRuntimeMetadata } from "@jingle/extension-api"',
        "",
        "export const runtimeMetadata = defineNativeExtensionRuntimeMetadata({",
        "  commands: [",
        "    {",
        '      name: "open",',
        "      search: {",
        "        resolveCommand: () => null",
        "      }",
        "    }",
        "  ],",
        '  extensionName: "function-search"',
        "})",
        ""
      ].join("\n")
    )

    await assert.rejects(
      () =>
        execFileAsync(
          process.execPath,
          ["packages/extension-cli/src/cli.mjs", "build", sourceRoot, "--out-dir", outputRoot],
          { cwd: process.cwd(), timeout: 5000 }
        ),
      (error) => {
        assert.equal((error as { code?: number }).code, 1)
        assert.match(
          `${(error as { stderr?: string }).stderr ?? ""}\n${(error as { stdout?: string }).stdout ?? ""}`,
          /runtime-metadata\.commands\[0\]\.search\.resolveCommand/
        )
        assert.match(
          `${(error as { stderr?: string }).stderr ?? ""}\n${(error as { stdout?: string }).stdout ?? ""}`,
          /Function search adapters cannot be written/
        )
        return true
      }
    )
  } finally {
    await rm(sourceRoot, { force: true, recursive: true })
    await rm(outputRoot, { force: true, recursive: true })
  }
})

test("installed extension provider loads a valid descriptor package", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "jingle-installed-extension-"))
  try {
    const packageRoot = join(rootDir, "sample", "1.0.0")
    await writeInstalledExtensionFixture(packageRoot)

    const registry = await createExtensionRegistryService([new InstalledExtensionProvider(rootDir)])
    const extensionPackage = registry.getLoadedPackage("sample")

    assert.ok(extensionPackage)
    assert.equal(extensionPackage.source, "installed")
    assert.equal(extensionPackage.trust, "untrusted")
    assert.equal(extensionPackage.runtime?.kind, "module")
    assert.equal(extensionPackage.main?.kind, "module")
    assert.equal(extensionPackage.main?.trust, "untrusted")
    assert.equal(extensionPackage.runtimeMetadata?.extensionName, "sample")
    assert.deepEqual(extensionPackage.errors, [])
    assert.deepEqual(
      registry.listManifests("darwin").map((manifest) => manifest.name),
      ["sample"]
    )
  } finally {
    await rm(rootDir, { force: true, recursive: true })
  }
})

test("installed main modules require trusted descriptors", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "jingle-installed-extension-"))
  try {
    const packageRoot = join(rootDir, "sample", "1.0.0")
    await writeInstalledExtensionFixture(packageRoot)

    const registry = await createExtensionRegistryService([new InstalledExtensionProvider(rootDir)])
    const extensionPackage = registry.getLoadedPackage("sample")
    assert.ok(extensionPackage?.main)
    await assert.rejects(
      () => loadExtensionMainDefinition(extensionPackage.main!),
      /main module is privileged and requires trust "trusted"/
    )
  } finally {
    await rm(rootDir, { force: true, recursive: true })
  }
})

test("installed extension provider reports package-relative path escapes", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "jingle-installed-extension-"))
  try {
    const packageRoot = join(rootDir, "sample", "1.0.0")
    await writeInstalledExtensionFixture(packageRoot, {
      descriptorOverrides: {
        manifest: "../manifest.json"
      }
    })

    const registry = await createExtensionRegistryService([new InstalledExtensionProvider(rootDir)])
    const extensionPackage = registry.getPackage("sample")

    assert.equal(extensionPackage?.status, "error")
    assert.match(
      extensionPackage?.errors.map((error) => error.message).join("\n") ?? "",
      /manifest path escapes package root/
    )
  } finally {
    await rm(rootDir, { force: true, recursive: true })
  }
})

async function writeInstalledExtensionFixture(
  packageRoot: string,
  options: {
    descriptorOverrides?: Record<string, unknown>
  } = {}
): Promise<void> {
  await mkdir(join(packageRoot, "assets"), { recursive: true })
  await mkdir(join(packageRoot, "dist"), { recursive: true })
  await writeFile(join(packageRoot, "assets", "icon.svg"), "<svg />")
  await writeFile(
    join(packageRoot, "dist", "runtime.mjs"),
    "export default { commands: {}, extensionName: 'sample' }"
  )
  await writeFile(join(packageRoot, "dist", "main.mjs"), "export default {}")
  await writeFile(
    join(packageRoot, "manifest.json"),
    JSON.stringify({
      capabilities: [],
      commands: [],
      connection: {
        auth: {
          type: "none"
        },
        id: "default",
        provider: "sample",
        title: "Sample"
      },
      icon: "assets/icon.svg",
      name: "sample",
      title: "Sample"
    })
  )
  await writeFile(
    join(packageRoot, "runtime-metadata.json"),
    JSON.stringify({
      commands: [],
      extensionName: "sample"
    })
  )
  await writeFile(
    join(packageRoot, "jingle.extension.json"),
    JSON.stringify({
      assets: "./assets",
      id: "sample",
      main: "./dist/main.mjs",
      manifest: "./manifest.json",
      runtime: "./dist/runtime.mjs",
      runtimeMetadata: "./runtime-metadata.json",
      schemaVersion: 1,
      version: "1.0.0",
      ...options.descriptorOverrides
    })
  )
}

function installRuntimeReactBridge(): void {
  installExtensionRuntimeReactBridge({
    React,
    jsxDevRuntime: ReactJsxDevRuntime,
    jsxRuntime: ReactJsxRuntime
  })
}
