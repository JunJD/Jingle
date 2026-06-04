import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"
import { listNativeExtensionManifests, nativeExtensionManifests } from "../../src/extensions"
import { nativeExtensionMainDefinitions } from "../../src/extensions/main"
import { getNativeExtensionRuntimeCommand } from "../../src/extensions/runtime"
import { nativeExtensionRuntimeMetadata } from "../../src/extensions/runtime-metadata"
import { nativeExtensionRuntimePackages } from "../../src/extensions/runtime-packages"
import { nativeExtensionRuntimeMetadataPackages } from "../../src/extensions/runtime-metadata-packages"
import { listNativeExtensionSettingsSchemas } from "../../src/main/services/native-extensions"
import { validateNativeExtensionRegistry } from "../../src/main/native-extensions/validation"
import {
  createNativeExtensionAssetUrl,
  resolveNativeExtensionAssetPath
} from "../../src/main/native-extensions/assets"
import { defineNativeExtensionRuntime } from "@openwork/extension-api"
import {
  toInstalledNativeExtensionSettingsSchema,
  toLauncherCommandOwnerManifest
} from "../../src/shared/native-extensions"
import { resolveLocalizedText } from "../../src/shared/i18n"

async function readExtensionPackageJson(extensionName: string): Promise<{
  dependencies?: Record<string, string>
  name?: string
}> {
  return JSON.parse(
    await readFile(join(process.cwd(), "extensions", extensionName, "package.json"), "utf8")
  ) as { dependencies?: Record<string, string>; name?: string }
}

test("native extension registry is internally consistent", () => {
  const result = validateNativeExtensionRegistry({
    assetRoots: [join(process.cwd(), "extensions"), join(process.cwd(), "src/extensions")],
    mainDefinitions: nativeExtensionMainDefinitions,
    manifests: nativeExtensionManifests,
    runtimeMetadataPackages: nativeExtensionRuntimeMetadataPackages,
    runtimePackages: nativeExtensionRuntimePackages
  })

  assert.deepEqual(result.errors, [])
})

test("Notion is the only production Notion extension entrypoint", () => {
  assert.equal(
    nativeExtensionManifests.some((manifest) => manifest.name === "notion"),
    true
  )
  assert.equal(
    nativeExtensionManifests.some((manifest) => manifest.name === "notion-generated"),
    false
  )
  assert.equal(nativeExtensionMainDefinitions.has("notion"), true)
  assert.equal(nativeExtensionMainDefinitions.has("notion-generated"), false)
  assert.equal(
    nativeExtensionRuntimePackages.some(
      (runtimePackage) => runtimePackage.extensionName === "notion-generated"
    ),
    false
  )
  assert.equal(
    nativeExtensionRuntimeMetadataPackages.some(
      (metadataPackage) => metadataPackage.extensionName === "notion-generated"
    ),
    false
  )
  assert.equal(nativeExtensionRuntimeMetadata.has("notion-generated"), false)

  for (const platform of ["linux", "darwin", "win32"] as const) {
    const extensionNames = listNativeExtensionManifests(platform).map((manifest) => manifest.name)
    assert.equal(extensionNames.includes("notion"), true)
    assert.equal(extensionNames.includes("notion-generated"), false)
  }

  const settingsSchemaNames = listNativeExtensionSettingsSchemas().map((schema) => schema.extName)
  assert.equal(settingsSchemaNames.includes("notion"), true)
  assert.equal(settingsSchemaNames.includes("notion-generated"), false)
})

test("Notion keeps the migrated manifest and package contract", async () => {
  const notion = nativeExtensionManifests.find((manifest) => manifest.name === "notion")
  assert.ok(notion)

  assert.deepEqual(
    notion.commands.map((command) => command.name),
    ["add-text-to-page", "create-database-page", "quick-capture", "search-page"]
  )
  assert.deepEqual(notion.aiCapability?.toolNames, [
    "searchPages",
    "getPage",
    "retrievePage",
    "getPageMarkdown",
    "listBlockChildren",
    "getDatabases",
    "retrieveDataSource",
    "searchDatabase",
    "queryDataSource",
    "addToPage",
    "createPage",
    "createDatabasePage"
  ])
  assert.deepEqual(notion.connection?.auth, {
    secretNames: ["accessToken"],
    type: "apiKey"
  })
  assert.deepEqual(notion.connection?.publicPreferenceNames, ["apiBaseUrl"])
  assert.deepEqual(notion.runtimeShell, {
    allowedUrlSchemes: ["notion"]
  })

  const notionPackage = await readExtensionPackageJson("notion")
  assert.equal(notionPackage.name, "@openwork/extension-notion")
  assert.equal(notionPackage.dependencies?.["@notionhq/client"], "^5.22.0")
  assert.equal(notionPackage.dependencies?.["@tryfabric/martian"], "^1.2.4")
  assert.equal(notionPackage.dependencies?.["notion-to-md"], "^3.1.9")
  assert.equal(notionPackage.dependencies?.["date-fns"], "^4.3.0")
})

test("Notion runtime commands use direct runtime SDK APIs instead of RPC", () => {
  const notion = nativeExtensionManifests.find((manifest) => manifest.name === "notion")
  const notionMain = nativeExtensionMainDefinitions.get("notion")
  assert.ok(notion)
  assert.ok(notionMain)

  assert.equal(notion.capabilities.includes("rpc"), false)
  assert.equal(notion.runtimeCapabilities?.includes("rpc"), false)
  assert.deepEqual(notion.rpcMethods ?? [], [])
  assert.equal(notionMain.service, undefined)
})

test("Notion keeps manifest runtime and metadata command order aligned", () => {
  const notionManifest = nativeExtensionManifests.find((manifest) => manifest.name === "notion")
  const notionRuntime = nativeExtensionRuntimePackages.find(
    (runtimePackage) => runtimePackage.extensionName === "notion"
  )
  const notionRuntimeMetadata = nativeExtensionRuntimeMetadataPackages.find(
    (metadataPackage) => metadataPackage.extensionName === "notion"
  )
  assert.ok(notionManifest)
  assert.ok(notionRuntime)
  assert.ok(notionRuntimeMetadata)

  const manifestRuntimeCommandNames = notionManifest.commands
    .filter((command) => command.runtime)
    .map((command) => command.name)

  assert.deepEqual(Object.keys(notionRuntime.commands), manifestRuntimeCommandNames)
  assert.deepEqual(
    notionRuntimeMetadata.commands.map((command) => command.name),
    manifestRuntimeCommandNames
  )
})

test("native extension registry rejects runtime command mode drift", () => {
  const result = validateNativeExtensionRegistry({
    assetRoots: [join(process.cwd(), "extensions"), join(process.cwd(), "src/extensions")],
    mainDefinitions: nativeExtensionMainDefinitions,
    manifests: nativeExtensionManifests,
    runtimeMetadataPackages: nativeExtensionRuntimeMetadataPackages,
    runtimePackages: nativeExtensionRuntimePackages.map((runtimePackage) =>
      runtimePackage.extensionName === "apple-reminders"
        ? defineNativeExtensionRuntime({
            ...runtimePackage,
            commands: {
              ...runtimePackage.commands,
              "quick-add-reminder": {
                Component: () => null,
                mode: "view"
              }
            }
          })
        : runtimePackage
    )
  })

  assert.match(
    result.errors.join("\n"),
    /apple-reminders:quick-add-reminder.*mode "view" does not match manifest mode "no-view"/
  )
})

test("manifest runtime commands resolve through the package-level runtime registry", () => {
  const missingCommands: string[] = []

  for (const manifest of nativeExtensionManifests) {
    for (const command of manifest.commands) {
      if (!command.runtime) {
        continue
      }

      const runtimeCommand = getNativeExtensionRuntimeCommand({
        commandName: command.name,
        extensionName: manifest.name
      })

      if (!runtimeCommand) {
        missingCommands.push(`${manifest.name}:${command.name}`)
      }
    }
  }

  assert.deepEqual(missingCommands, [])

  const translate = getNativeExtensionRuntimeCommand({
    commandName: "translate",
    extensionName: "translate"
  })
  assert.equal(translate?.mode, "view")
  assert.equal(typeof translate?.Component, "function")

  const quickAddReminder = getNativeExtensionRuntimeCommand({
    commandName: "quick-add-reminder",
    extensionName: "apple-reminders"
  })
  assert.equal(quickAddReminder?.mode, "no-view")
  assert.equal(typeof quickAddReminder?.run, "function")

  const unreadNotifications = getNativeExtensionRuntimeCommand({
    commandName: "unread-notifications",
    extensionName: "github"
  })
  assert.equal(unreadNotifications?.mode, "menu-bar")
  assert.equal(typeof unreadNotifications?.Component, "function")

  const notionSearchPage = getNativeExtensionRuntimeCommand({
    commandName: "search-page",
    extensionName: "notion"
  })
  assert.equal(notionSearchPage?.mode, "view")
  assert.equal(typeof notionSearchPage?.Component, "function")

  const notionAddTextToPage = getNativeExtensionRuntimeCommand({
    commandName: "add-text-to-page",
    extensionName: "notion"
  })
  assert.equal(notionAddTextToPage?.mode, "view")
  assert.equal(typeof notionAddTextToPage?.Component, "function")

  const notionCreateDatabasePage = getNativeExtensionRuntimeCommand({
    commandName: "create-database-page",
    extensionName: "notion"
  })
  assert.equal(notionCreateDatabasePage?.mode, "view")
  assert.equal(typeof notionCreateDatabasePage?.Component, "function")

  const retiredGeneratedSearchPage = getNativeExtensionRuntimeCommand({
    commandName: "search-page",
    extensionName: "notion-generated"
  })
  assert.equal(retiredGeneratedSearchPage, null)

  const retiredGeneratedQuickCapture = getNativeExtensionRuntimeCommand({
    commandName: "quick-capture",
    extensionName: "notion-generated"
  })
  assert.equal(retiredGeneratedQuickCapture, null)
})

test("extension package icons are owned by extension manifests and flow into settings schemas", () => {
  const manifestIcons = Object.fromEntries(
    nativeExtensionManifests.map((manifest) => [manifest.name, manifest.icon])
  )

  assert.deepEqual(manifestIcons, {
    "apple-reminders": "assets/icon.png",
    github: "assets/icon.svg",
    notion: "assets/notion-logo.png",
    "todo-list": "assets/icon.svg",
    translate: "assets/icon.svg"
  })
  assert.equal(
    nativeExtensionManifests.find((manifest) => manifest.name === "notion")?.iconName,
    "notion"
  )
  assert.equal(
    nativeExtensionManifests.find((manifest) => manifest.name === "github")?.iconName,
    "github"
  )

  const appleRemindersSchema = toInstalledNativeExtensionSettingsSchema(
    nativeExtensionManifests.find((manifest) => manifest.name === "apple-reminders")!
  )
  assert.equal(appleRemindersSchema.icon, "assets/icon.png")
  assert.equal(appleRemindersSchema.iconName, "reminders")
  assert.deepEqual(
    appleRemindersSchema.commands.map((command) => [command.icon, command.iconName]),
    [
      ["assets/icon.png", "reminders"],
      ["assets/icon.png", "reminders"],
      ["assets/icon.png", "reminders"],
      ["assets/icon.png", "reminders"]
    ]
  )

  const githubSchema = toInstalledNativeExtensionSettingsSchema(
    nativeExtensionManifests.find((manifest) => manifest.name === "github")!
  )
  assert.equal(githubSchema.iconName, "github")
  assert.equal(
    githubSchema.commands.find((command) => command.name === "my-issues")?.icon,
    "assets/icon.svg"
  )
  assert.equal(
    githubSchema.commands.find((command) => command.name === "my-issues")?.iconName,
    "github"
  )
  assert.equal(
    githubSchema.commands.find((command) => command.name === "notifications")?.icon,
    "assets/notifications.svg"
  )
  assert.equal(
    githubSchema.commands.find((command) => command.name === "notifications")?.iconName,
    "github"
  )

  const notionSchema = toInstalledNativeExtensionSettingsSchema(
    nativeExtensionManifests.find((manifest) => manifest.name === "notion")!
  )
  assert.deepEqual(
    notionSchema.commands.find((command) => command.name === "create-database-page")?.keywords,
    ["notion", "create", "database", "data source", "page", "markdown"]
  )
})

test("launcher command owner lets commands inherit package icons unless they declare a dedicated asset", () => {
  const githubOwner = toLauncherCommandOwnerManifest(
    nativeExtensionManifests.find((manifest) => manifest.name === "github")!
  )

  assert.equal(githubOwner.icon, "assets/icon.svg")
  const myIssuesCommand = githubOwner.commands.find((command) => command.name === "my-issues")
  assert.equal(
    resolveLocalizedText(myIssuesCommand?.description, "en-US"),
    "List GitHub issues created by you, assigned to you, or mentioning you."
  )
  assert.equal(resolveLocalizedText(myIssuesCommand?.title, "en-US"), "My Issues")
  assert.equal(resolveLocalizedText(myIssuesCommand?.title, "zh-CN"), "我的 Issues")
  assert.equal(myIssuesCommand?.icon, "assets/icon.svg")
  assert.equal(myIssuesCommand?.iconName, "github")
  assert.deepEqual(myIssuesCommand?.keywords, [
    "github",
    "issue",
    "issues",
    "pull request",
    "pr",
    "代码审查"
  ])
  assert.equal(myIssuesCommand?.mode, "view")
  assert.equal(
    githubOwner.commands.find((command) => command.name === "notifications")?.icon,
    "assets/notifications.svg"
  )
  assert.equal(
    githubOwner.commands.find((command) => command.name === "notifications")?.iconName,
    "github"
  )

  const todoListOwner = toLauncherCommandOwnerManifest(
    nativeExtensionManifests.find((manifest) => manifest.name === "todo-list")!
  )
  assert.equal(todoListOwner.commands[0]?.icon, "assets/icon.svg")
  assert.equal(todoListOwner.commands[0]?.iconName, "todo")

  const notionOwner = toLauncherCommandOwnerManifest(
    nativeExtensionManifests.find((manifest) => manifest.name === "notion")!
  )
  assert.equal(notionOwner.icon, "assets/notion-logo.png")
  assert.deepEqual(
    notionOwner.commands.map((command) => [command.name, command.icon, command.iconName]),
    [
      ["add-text-to-page", "assets/notion-logo.png", "notion"],
      ["create-database-page", "assets/notion-logo.png", "notion"],
      ["quick-capture", "assets/notion-logo.png", "notion"],
      ["search-page", "assets/notion-logo.png", "notion"]
    ]
  )
  assert.deepEqual(
    notionOwner.commands.find((command) => command.name === "quick-capture")?.keywords,
    ["notion", "quick", "capture", "url", "web", "summary"]
  )
})

test("Notion declares desktop URL schemes at the runtime shell boundary", () => {
  const notionManifest = nativeExtensionManifests.find((manifest) => manifest.name === "notion")

  assert.deepEqual(notionManifest?.runtimeShell, {
    allowedUrlSchemes: ["notion"]
  })
})

test("declared extension icon assets exist inside their extension packages", () => {
  const missingIcons: string[] = []
  const previousRendererUrl = process.env.ELECTRON_RENDERER_URL
  Reflect.set(process.env, "ELECTRON_RENDERER_URL", previousRendererUrl ?? "http://localhost")

  try {
    for (const manifest of nativeExtensionManifests) {
      for (const icon of [manifest.icon, ...manifest.commands.map((command) => command.icon)]) {
        if (!icon) {
          continue
        }

        const resolvedPath = resolveNativeExtensionAssetPath({
          extensionName: manifest.name,
          path: icon
        })
        if (!existsSync(resolvedPath)) {
          missingIcons.push(`${manifest.name}:${icon}`)
        }
      }
    }
  } finally {
    if (previousRendererUrl === undefined) {
      Reflect.deleteProperty(process.env, "ELECTRON_RENDERER_URL")
    } else {
      Reflect.set(process.env, "ELECTRON_RENDERER_URL", previousRendererUrl)
    }
  }

  assert.deepEqual(missingIcons, [])
  assert.equal(
    createNativeExtensionAssetUrl({
      extensionName: "github",
      path: "assets/icon.svg"
    }),
    "openwork-extension-asset://github/assets/icon.svg"
  )
  assert.equal(
    createNativeExtensionAssetUrl({
      extensionName: "notion",
      path: "assets/notion-logo.png"
    }),
    "openwork-extension-asset://notion/assets/notion-logo.png"
  )
})
