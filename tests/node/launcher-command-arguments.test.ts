import assert from "node:assert/strict"
import test from "node:test"
import { coffeeManifest } from "../../installable-extensions/coffee/manifest"
import { notionManifest } from "../../installable-extensions/notion/manifest"
import { commandNeedsLauncherArguments } from "../../src/renderer/src/launcher-shell/command-arguments"
import type { LauncherCommandRoute } from "../../src/renderer/src/launcher-shell/pages/types"
import {
  type LauncherCommandOwnerManifest,
  validateLauncherCommandOwnerManifest
} from "../../src/shared/launcher-command-owner"
import { toNativeExtensionLauncherCatalogProjection } from "../../src/shared/native-extensions"

function createRoute(launchProps?: LauncherCommandRoute["launchProps"]): LauncherCommandRoute {
  return {
    commandName: "command",
    extensionName: "extension",
    initialAction: "focus",
    kind: "extension-command",
    launchProps,
    seedQuery: ""
  }
}

function createOwnerManifest(
  argument: Record<string, unknown>
): LauncherCommandOwnerManifest {
  return {
    capabilities: [],
    commands: [
      {
        arguments: [argument] as unknown as LauncherCommandOwnerManifest["commands"][number]["arguments"],
        mode: "no-view",
        name: "command",
        requiresLauncherArguments: true,
        title: "Command"
      }
    ],
    defaultCommandName: "command",
    displayName: "Extension",
    id: "extension"
  }
}

test("launcher command owner rejects malformed argument contracts at registration", () => {
  const invalidArguments = [
    { name: "", title: "Text", type: "text" },
    { name: "text", title: "", type: "text" },
    { name: "text", title: "Text", type: "checkbox" },
    { data: [], name: "choice", title: "Choice", type: "dropdown" },
    {
      data: [{ title: "Choice", value: "" }],
      name: "choice",
      title: "Choice",
      type: "dropdown"
    }
  ]

  for (const argument of invalidArguments) {
    assert.throws(() => validateLauncherCommandOwnerManifest(createOwnerManifest(argument)))
  }

  const duplicateNameManifest = createOwnerManifest({ name: "text", title: "Text", type: "text" })
  duplicateNameManifest.commands[0].arguments?.push({
    name: "text",
    title: "Other text",
    type: "text"
  })
  assert.throws(
    () => validateLauncherCommandOwnerManifest(duplicateNameManifest),
    /duplicate argument "text"/
  )
})

test("launcher argument page requires an explicit command contract", () => {
  const argumentSchema = [
    {
      name: "text",
      required: false,
      title: "Text",
      type: "text"
    }
  ]

  assert.equal(
    commandNeedsLauncherArguments({
      argumentsSchema: argumentSchema,
      requiresLauncherArguments: false,
      route: createRoute()
    }),
    false
  )
  assert.equal(
    commandNeedsLauncherArguments({
      argumentsSchema: argumentSchema,
      requiresLauncherArguments: true,
      route: createRoute()
    }),
    true
  )
})

test("launcher argument page is skipped when launch props already provide input", () => {
  const argumentSchema = [
    {
      name: "duration",
      required: true,
      title: "Duration",
      type: "text"
    }
  ]

  assert.equal(
    commandNeedsLauncherArguments({
      argumentsSchema: argumentSchema,
      requiresLauncherArguments: true,
      route: createRoute({ arguments: { duration: "30m" } })
    }),
    false
  )
  assert.equal(
    commandNeedsLauncherArguments({
      argumentsSchema: argumentSchema,
      requiresLauncherArguments: true,
      route: createRoute({ fallbackText: "30m" })
    }),
    false
  )
})

test("native extension projection keeps launcher argument contract separate from arguments schema", () => {
  const coffeeProjection = toNativeExtensionLauncherCatalogProjection(coffeeManifest)
  const notionProjection = toNativeExtensionLauncherCatalogProjection(notionManifest)

  assert.equal(
    coffeeProjection.commands.find((command) => command.name === "caffeinateFor")
      ?.requiresLauncherArguments,
    true
  )
  assert.equal(
    coffeeProjection.commands.find((command) => command.name === "caffeinateUntil")
      ?.requiresLauncherArguments,
    true
  )
  assert.equal(
    notionProjection.commands.find((command) => command.name === "add-text-to-page")
      ?.arguments?.length,
    1
  )
  assert.equal(
    notionProjection.commands.find((command) => command.name === "add-text-to-page")
      ?.requiresLauncherArguments,
    undefined
  )
})
