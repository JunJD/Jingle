import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { nativeExtensionManifests } from "../../src/extensions"
import { nativeExtensionMainDefinitions } from "../../src/extensions/main"
import { getNativeExtensionRuntimeCommand } from "../../src/extensions/runtime"
import { nativeExtensionRuntimePackages } from "../../src/extensions/runtime-packages"
import { nativeExtensionRuntimeMetadataPackages } from "../../src/extensions/runtime-metadata-packages"
import { validateNativeExtensionRegistry } from "../../src/main/native-extensions/validation"
import {
  createNativeExtensionAssetUrl,
  resolveNativeExtensionAssetPath
} from "../../src/main/native-extensions/assets"
import { defineNativeExtensionRuntime } from "../../src/extensions/runtime-contract"
import { toInstalledNativeExtensionSettingsSchema } from "../../src/shared/native-extensions"

test("native extension registry is internally consistent", () => {
  const result = validateNativeExtensionRegistry({
    assetRoot: join(process.cwd(), "src/extensions"),
    mainDefinitions: nativeExtensionMainDefinitions,
    manifests: nativeExtensionManifests,
    runtimeMetadataPackages: nativeExtensionRuntimeMetadataPackages,
    runtimePackages: nativeExtensionRuntimePackages
  })

  assert.deepEqual(result.errors, [])
})

test("native extension registry rejects runtime command mode drift", () => {
  const result = validateNativeExtensionRegistry({
    assetRoot: join(process.cwd(), "src/extensions"),
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
})

test("extension package icons are owned by extension manifests and flow into settings schemas", () => {
  const manifestIcons = Object.fromEntries(
    nativeExtensionManifests.map((manifest) => [manifest.name, manifest.icon])
  )

  assert.deepEqual(manifestIcons, {
    "apple-reminders": "assets/icon.png",
    github: "assets/icon.svg",
    notion: undefined,
    "todo-list": "assets/icon.svg",
    translate: "assets/icon.svg"
  })
  assert.equal(
    nativeExtensionManifests.find((manifest) => manifest.name === "notion")?.iconName,
    "notion"
  )

  const appleRemindersSchema = toInstalledNativeExtensionSettingsSchema(
    nativeExtensionManifests.find((manifest) => manifest.name === "apple-reminders")!
  )
  assert.equal(appleRemindersSchema.icon, "assets/icon.png")
  assert.equal(appleRemindersSchema.iconName, undefined)
  assert.deepEqual(
    appleRemindersSchema.commands.map((command) => command.icon),
    ["assets/icon.png", "assets/icon.png", "assets/icon.png", "assets/icon.png"]
  )

  const githubSchema = toInstalledNativeExtensionSettingsSchema(
    nativeExtensionManifests.find((manifest) => manifest.name === "github")!
  )
  assert.equal(
    githubSchema.commands.find((command) => command.name === "notifications")?.icon,
    "assets/notifications.svg"
  )
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
})
