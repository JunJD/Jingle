import assert from "node:assert/strict"
import test from "node:test"
import {
  buildLauncherUseWithCommandShellItems,
  buildLauncherUseWithShellItems
} from "../../src/renderer/src/launcher-shell/use-with-items"
import {
  getLauncherCommandAddressKey,
  setLauncherUseWithCommandEnabled,
  splitLauncherUseWithCommands
} from "../../src/renderer/src/launcher-shell/use-with-preferences"
import type { LauncherIndexedCommand } from "../../src/renderer/src/launcher-shell/pages"
import type { LauncherResolvedCommandIntent } from "../../src/renderer/src/launcher-shell/pages/types"

const copy = {
  launcher: {
    openGeneric: "Open",
    resultKindExtension: "Extension"
  }
} as Parameters<typeof buildLauncherUseWithCommandShellItems>[0]

test("use-with command items pass the current query as seed and fallback text", () => {
  const command: LauncherIndexedCommand = {
    address: {
      commandName: "search-files",
      extensionName: "files",
      kind: "extension-command"
    },
    description: "Find a file",
    iconName: "file-text",
    keywords: ["file"],
    ownerTitle: "File Search",
    title: "Search Files"
  }

  const [item] = buildLauncherUseWithCommandShellItems(copy, [command], " wechat ")

  assert.equal(item?.id, "use-with:files:search-files:wechat")
  assert.deepEqual(item?.commandRef, command.address)
  assert.deepEqual(item?.commandOpenOptions, {
    launchProps: {
      fallbackText: "wechat"
    },
    seedQuery: "wechat"
  })
  assert.equal(item?.title, "Search Files")
  assert.equal(item?.subtitle, "File Search · Find a file")
  assert.equal(item?.presentation.categoryLabel, "Extension")
  assert.equal(item?.presentation.primaryActionLabel, "Open")
})

test("use-with command items stay empty for blank queries", () => {
  assert.deepEqual(buildLauncherUseWithCommandShellItems(copy, [], "   "), [])
})

test("use-with shell keeps extension intent items and de-duplicates generic fallbacks", () => {
  const translateCommand: LauncherIndexedCommand = {
    address: {
      commandName: "translate",
      extensionName: "translate",
      kind: "extension-command"
    },
    description: "Translate text",
    iconName: "languages",
    keywords: ["translate"],
    ownerTitle: "Translate",
    title: "Translate"
  }
  const filesCommand: LauncherIndexedCommand = {
    address: {
      commandName: "search-files",
      extensionName: "files",
      kind: "extension-command"
    },
    description: "Find a file",
    iconName: "file-text",
    keywords: ["file"],
    ownerTitle: "File Search",
    title: "Search Files"
  }
  const translateIntent: LauncherResolvedCommandIntent = {
    address: translateCommand.address,
    id: "translate-intent",
    kind: "plugin",
    openOptions: {
      initialAction: "submit",
      seedQuery: "translate hello"
    },
    presentation: {
      categoryLabel: "Translate",
      icon: {
        name: "languages",
        type: "glyph"
      },
      listActionLabel: "Translate",
      primaryActionLabel: "Translate",
      tone: "accent"
    },
    priority: 100,
    subtitle: "hello",
    title: "Translate Intent"
  }

  const items = buildLauncherUseWithShellItems({
    commands: [translateCommand, filesCommand],
    copy,
    intentItems: [translateIntent],
    query: "translate hello"
  })

  assert.deepEqual(
    items.map((item) => item.id),
    ["translate-intent", "use-with:files:search-files:translate hello"]
  )
  assert.deepEqual(items[0]?.commandOpenOptions, {
    initialAction: "submit",
    seedQuery: "translate hello"
  })
  assert.equal(items[0]?.presentation.tone, "accent")
  assert.deepEqual(items[1]?.commandOpenOptions, {
    launchProps: {
      fallbackText: "translate hello"
    },
    seedQuery: "translate hello"
  })
})

test("use-with shell hides disabled extension intent and fallback rows", () => {
  const translateCommand: LauncherIndexedCommand = {
    address: {
      commandName: "translate",
      extensionName: "translate",
      kind: "extension-command"
    },
    description: "Translate text",
    iconName: "languages",
    keywords: ["translate"],
    ownerTitle: "Translate",
    title: "Translate"
  }
  const filesCommand: LauncherIndexedCommand = {
    address: {
      commandName: "search-files",
      extensionName: "files",
      kind: "extension-command"
    },
    description: "Find a file",
    iconName: "file-text",
    keywords: ["file"],
    ownerTitle: "File Search",
    title: "Search Files"
  }
  const translateIntent: LauncherResolvedCommandIntent = {
    address: translateCommand.address,
    id: "translate-intent",
    kind: "plugin",
    openOptions: {
      initialAction: "submit",
      seedQuery: "translate hello"
    },
    presentation: {
      categoryLabel: "Translate",
      icon: {
        name: "languages",
        type: "glyph"
      },
      listActionLabel: "Translate",
      primaryActionLabel: "Translate",
      tone: "accent"
    },
    priority: 100,
    subtitle: "hello",
    title: "Translate Intent"
  }

  const items = buildLauncherUseWithShellItems({
    commands: [translateCommand, filesCommand],
    copy,
    disabledCommandKeys: [getLauncherCommandAddressKey(translateCommand.address)],
    intentItems: [translateIntent],
    query: "translate hello"
  })

  assert.deepEqual(
    items.map((item) => item.id),
    ["use-with:files:search-files:translate hello"]
  )
})

test("use-with command preferences split and toggle disabled commands", () => {
  const enabledCommand: LauncherIndexedCommand = {
    address: {
      commandName: "search-files",
      extensionName: "files",
      kind: "extension-command"
    },
    description: "Find a file",
    iconName: "file-text",
    keywords: ["file"],
    ownerTitle: "File Search",
    title: "Search Files"
  }
  const disabledCommand: LauncherIndexedCommand = {
    address: {
      commandName: "translate",
      extensionName: "translate",
      kind: "extension-command"
    },
    description: "Translate text",
    iconName: "languages",
    keywords: ["translate"],
    ownerTitle: "Translate",
    title: "Translate"
  }
  const disabledKey = getLauncherCommandAddressKey(disabledCommand.address)

  const groups = splitLauncherUseWithCommands([enabledCommand, disabledCommand], [disabledKey])

  assert.deepEqual(
    groups.enabledCommands.map((command) => command.title),
    ["Search Files"]
  )
  assert.deepEqual(
    groups.availableCommands.map((command) => command.title),
    ["Translate"]
  )
  assert.deepEqual(setLauncherUseWithCommandEnabled([disabledKey], disabledKey, true), [])
  assert.deepEqual(setLauncherUseWithCommandEnabled([], disabledKey, false), [disabledKey])
})
