import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"
import { listNativeExtensionManifests, nativeExtensionManifests } from "../../src/extensions"
import { nativeExtensionMainDefinitions } from "../../src/extensions/main"
import { getNativeExtensionRuntimeCommand } from "../../src/extensions/runtime"
import { nativeExtensionRuntimePackages } from "../../src/extensions/runtime-packages"
import { nativeExtensionRuntimeMetadataPackages } from "../../src/extensions/runtime-metadata-packages"
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
import { githubMain } from "../../installable-extensions/github/main"
import { githubManifest } from "../../installable-extensions/github/manifest"
import { githubRuntime } from "../../installable-extensions/github/runtime"
import { githubRuntimeMetadata } from "../../installable-extensions/github/runtime-metadata"
import { figmaFilesMain } from "../../installable-extensions/figma-files/main"
import { figmaFilesManifest } from "../../installable-extensions/figma-files/manifest"
import { figmaFilesRuntime } from "../../installable-extensions/figma-files/runtime"
import { figmaFilesRuntimeMetadata } from "../../installable-extensions/figma-files/runtime-metadata"
import { notionMain } from "../../installable-extensions/notion/main"
import { notionManifest } from "../../installable-extensions/notion/manifest"
import { notionRuntime } from "../../installable-extensions/notion/runtime"
import { notionRuntimeMetadata } from "../../installable-extensions/notion/runtime-metadata"

async function readExtensionPackageJson(extensionName: string): Promise<{
  dependencies?: Record<string, string>
  name?: string
  openwork?: {
    distribution?: string
    trust?: string
  }
}> {
  return JSON.parse(
    await readFile(
      join(process.cwd(), "installable-extensions", extensionName, "package.json"),
      "utf8"
    )
  ) as {
    dependencies?: Record<string, string>
    name?: string
    openwork?: {
      distribution?: string
      trust?: string
    }
  }
}

const installablePackageManifests = [figmaFilesManifest, githubManifest, notionManifest]
const installablePackageRuntimePackages = [figmaFilesRuntime, githubRuntime, notionRuntime]
const installablePackageRuntimeMetadataPackages = [
  figmaFilesRuntimeMetadata,
  githubRuntimeMetadata,
  notionRuntimeMetadata
]
const installablePackageMainDefinitions = new Map([
  [figmaFilesManifest.name, figmaFilesMain],
  [githubManifest.name, githubMain],
  [notionManifest.name, notionMain]
])

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

test("installed package samples are no longer part of the built-in static registry", () => {
  assert.equal(
    nativeExtensionManifests.some((manifest) => manifest.name === "figma-files"),
    false
  )
  assert.equal(
    nativeExtensionManifests.some((manifest) => manifest.name === "notion"),
    false
  )
  assert.equal(
    nativeExtensionManifests.some((manifest) => manifest.name === "github"),
    false
  )
  assert.equal(
    nativeExtensionManifests.some((manifest) => manifest.name === "notion-generated"),
    false
  )
  assert.equal(nativeExtensionMainDefinitions.has("figma-files"), false)
  assert.equal(nativeExtensionMainDefinitions.has("notion"), false)
  assert.equal(nativeExtensionMainDefinitions.has("github"), false)
  assert.equal(nativeExtensionMainDefinitions.has("notion-generated"), false)
  assert.equal(
    nativeExtensionRuntimePackages.some(
      (runtimePackage) => runtimePackage.extensionName === "figma-files"
    ),
    false
  )
  assert.equal(
    nativeExtensionRuntimePackages.some(
      (runtimePackage) => runtimePackage.extensionName === "notion"
    ),
    false
  )
  assert.equal(
    nativeExtensionRuntimePackages.some(
      (runtimePackage) => runtimePackage.extensionName === "github"
    ),
    false
  )
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

  for (const platform of ["linux", "darwin", "win32"] as const) {
    const extensionNames = listNativeExtensionManifests(platform).map((manifest) => manifest.name)
    assert.equal(extensionNames.includes("figma-files"), false)
    assert.equal(extensionNames.includes("notion"), false)
    assert.equal(extensionNames.includes("github"), false)
    assert.equal(extensionNames.includes("notion-generated"), false)
  }
})

test("Figma Files keeps the package contract", async () => {
  assert.deepEqual(
    figmaFilesManifest.commands.map((command) => command.name),
    ["index", "menu-bar"]
  )
  assert.deepEqual(figmaFilesManifest.connection?.auth, {
    authorizationUrl: "https://jingle.cool/oauth/figma/start",
    clientId: "jingle-desktop",
    redirect: {
      callbackPath: "/oauth/callback",
      method: "app-scheme",
      scheme: "jingle"
    },
    scopes: ["current_user:read", "projects:read", "file_metadata:read", "file_content:read"],
    secretNames: ["accessToken"],
    tokenUrl: "https://jingle.cool/oauth/figma/token",
    type: "oauth"
  })
  assert.deepEqual(figmaFilesManifest.connection?.publicPreferenceNames, ["TEAM_ID", "open_in"])
  assert.deepEqual(figmaFilesManifest.runtimeShell, {
    allowedUrlSchemes: ["figma"]
  })

  const figmaFilesPackage = await readExtensionPackageJson("figma-files")
  assert.equal(figmaFilesPackage.name, "@openwork/extension-figma-files")
  assert.deepEqual(figmaFilesPackage.openwork, {
    distribution: "installable",
    trust: "trusted"
  })
})

test("Notion keeps the migrated manifest and package contract", async () => {
  assert.deepEqual(
    notionManifest.commands.map((command) => command.name),
    ["add-text-to-page", "create-database-page", "quick-capture", "search-page"]
  )
  assert.deepEqual(notionManifest.aiCapability?.toolNames, [
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
  assert.deepEqual(notionManifest.connection?.auth, {
    authorizationUrl: "https://jingle.cool/oauth/notion/start",
    clientId: "jingle-desktop",
    redirect: {
      callbackPath: "/oauth/callback",
      method: "app-scheme",
      scheme: "jingle"
    },
    scopes: [],
    secretNames: ["accessToken"],
    tokenUrl: "https://jingle.cool/oauth/notion/token",
    type: "oauth"
  })
  assert.deepEqual(notionManifest.connection?.publicPreferenceNames, ["apiBaseUrl"])
  assert.deepEqual(notionManifest.runtimeShell, {
    allowedUrlSchemes: ["notion"]
  })

  const notionPackage = await readExtensionPackageJson("notion")
  assert.equal(notionPackage.name, "@openwork/extension-notion")
  assert.deepEqual(notionPackage.openwork, {
    distribution: "installable",
    trust: "trusted"
  })
  assert.equal(notionPackage.dependencies?.["@notionhq/client"], "^5.22.0")
  assert.equal(notionPackage.dependencies?.["@tryfabric/martian"], "^1.2.4")
  assert.equal(notionPackage.dependencies?.["notion-to-md"], "^3.1.9")
  assert.equal(notionPackage.dependencies?.["date-fns"], "^4.3.0")
})

test("Notion runtime commands use direct runtime SDK APIs instead of RPC", () => {
  assert.equal(notionManifest.capabilities.includes("rpc"), false)
  assert.equal(notionManifest.runtimeCapabilities?.includes("rpc"), false)
  assert.deepEqual(notionManifest.rpcMethods ?? [], [])
  assert.equal(notionMain.service, undefined)
})

test("Notion keeps manifest runtime and metadata command order aligned", () => {
  const manifestRuntimeCommandNames = notionManifest.commands
    .filter((command) => command.runtime)
    .map((command) => command.name)

  assert.deepEqual(Object.keys(notionRuntime.commands), manifestRuntimeCommandNames)
  assert.deepEqual(
    notionRuntimeMetadata.commands.map((command) => command.name),
    manifestRuntimeCommandNames
  )
})

test("trusted installable source packages are internally consistent", () => {
  const result = validateNativeExtensionRegistry({
    assetRoots: [join(process.cwd(), "installable-extensions")],
    mainDefinitions: installablePackageMainDefinitions,
    manifests: installablePackageManifests,
    runtimeMetadataPackages: installablePackageRuntimeMetadataPackages,
    runtimePackages: installablePackageRuntimePackages
  })

  assert.deepEqual(result.errors, [])
})

test("native extension registry rejects runtime command mode drift", () => {
  const result = validateNativeExtensionRegistry({
    assetRoots: [join(process.cwd(), "installable-extensions")],
    mainDefinitions: installablePackageMainDefinitions,
    manifests: [githubManifest],
    runtimeMetadataPackages: [githubRuntimeMetadata],
    runtimePackages: [
      defineNativeExtensionRuntime({
        ...githubRuntime,
        commands: {
          ...githubRuntime.commands,
          "unread-notifications": {
            Component: () => null,
            mode: "view"
          }
        }
      })
    ]
  })

  assert.match(
    result.errors.join("\n"),
    /github:unread-notifications.*mode "view" does not match manifest mode "menu-bar"/
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

  const unreadNotifications = getNativeExtensionRuntimeCommand({
    commandName: "unread-notifications",
    extensionName: "github"
  })
  assert.equal(unreadNotifications, null)

  const figmaIndex = getNativeExtensionRuntimeCommand({
    commandName: "index",
    extensionName: "figma-files"
  })
  assert.equal(figmaIndex, null)

  const figmaMenuBar = getNativeExtensionRuntimeCommand({
    commandName: "menu-bar",
    extensionName: "figma-files"
  })
  assert.equal(figmaMenuBar, null)

  const notionSearchPage = getNativeExtensionRuntimeCommand({
    commandName: "search-page",
    extensionName: "notion"
  })
  assert.equal(notionSearchPage, null)

  const notionAddTextToPage = getNativeExtensionRuntimeCommand({
    commandName: "add-text-to-page",
    extensionName: "notion"
  })
  assert.equal(notionAddTextToPage, null)

  const notionCreateDatabasePage = getNativeExtensionRuntimeCommand({
    commandName: "create-database-page",
    extensionName: "notion"
  })
  assert.equal(notionCreateDatabasePage, null)

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
    "image-generation": "assets/icon.svg",
    "todo-list": "assets/icon.svg",
    translate: "assets/icon.svg"
  })
  assert.equal(
    nativeExtensionManifests.find((manifest) => manifest.name === "image-generation")?.iconName,
    "image"
  )

  const githubSchema = toInstalledNativeExtensionSettingsSchema(githubManifest)
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

  const notionSchema = toInstalledNativeExtensionSettingsSchema(notionManifest)
  assert.deepEqual(
    notionSchema.commands.find((command) => command.name === "create-database-page")?.keywords,
    ["notion", "create", "database", "data source", "page", "markdown"]
  )

  const imageGenerationSchema = toInstalledNativeExtensionSettingsSchema(
    nativeExtensionManifests.find((manifest) => manifest.name === "image-generation")!
  )
  assert.equal(imageGenerationSchema.icon, "assets/icon.svg")
  assert.equal(imageGenerationSchema.iconName, "image")
  assert.deepEqual(imageGenerationSchema.commands, [])
})

test("launcher command owner lets commands inherit package icons unless they declare a dedicated asset", () => {
  const githubOwner = toLauncherCommandOwnerManifest(githubManifest)

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

  const notionOwner = toLauncherCommandOwnerManifest(notionManifest)
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
