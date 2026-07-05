import assert from "node:assert/strict"
import test from "node:test"
import { nativeExtensionManifests } from "../../src/extensions"
import { setNativeLauncherCatalogProjection } from "../../src/renderer/src/extension-host"
import { appCopy } from "../../src/renderer/src/lib/i18n/messages"
import { buildLauncherHomeSurfaceModel } from "../../src/renderer/src/launcher-shell/home-surface"
import type { ExtensionSourceMention } from "../../src/shared/extension-sources"
import type { LauncherSearchResult } from "../../src/shared/launcher-search"
import { toNativeExtensionLauncherCatalogProjection } from "../../src/shared/native-extensions"

const copy = appCopy["zh-CN"]

setNativeLauncherCatalogProjection(
  nativeExtensionManifests.map((manifest) => toNativeExtensionLauncherCatalogProjection(manifest))
)

function buildSurface(
  query: string,
  options: {
    searchResults?: LauncherSearchResult[]
    sourceMentions?: readonly ExtensionSourceMention[]
    useWithDisabledCommandKeys?: readonly string[]
  } = {}
) {
  return buildLauncherHomeSurfaceModel({
    copy,
    historyItems: [],
    idleItems: [],
    locale: "zh-CN",
    query,
    searchResults: options.searchResults ?? [],
    sourceMentions: options.sourceMentions,
    useWithDisabledCommandKeys: options.useWithDisabledCommandKeys,
    windowMode: "default"
  })
}

const notionSourceMention: ExtensionSourceMention = {
  extensionName: "notion",
  iconName: "notion",
  label: "Notion",
  sourceId: "notion",
  tools: [],
  value: "notion"
}

test("high confidence extension intents become the primary launcher result", () => {
  const surface = buildSurface("translate hello to chinese")

  assert.equal(surface.items[0]?.title, "翻译")
  assert.deepEqual(surface.items[0]?.commandRef, {
    commandName: "translate",
    extensionName: "translate",
    kind: "extension-command"
  })
  const useWithSection = surface.sections.find((section) => section.kind === "use-with")
  assert.ok(useWithSection)
  assert.equal(
    useWithSection.items.some((item) => item.id.startsWith("use-with:translate:")),
    false
  )
})

test("exact extension command matches become the primary launcher result", () => {
  const surface = buildSurface("todo")

  assert.equal(surface.items[0]?.title, "待办列表")
  assert.equal(surface.items[0]?.id, "use-with:todo-list:index:todo")
  assert.deepEqual(surface.items[0]?.commandRef, {
    commandName: "index",
    extensionName: "todo-list",
    kind: "extension-command"
  })
  assert.deepEqual(surface.items[0]?.commandOpenOptions, {
    launchProps: {
      fallbackText: "todo"
    },
    seedQuery: "todo"
  })
  assert.equal(surface.items.filter((item) => item.id.startsWith("use-with:todo-list:")).length, 1)
})

test("generic AI intent stays primary when no extension intent matches", () => {
  const surface = buildSurface("整理本周计划")

  assert.equal(surface.items[0]?.kind, "ai")
})

test("@ query opens AI with an extension source ref", () => {
  const surface = buildSurface("@", {
    sourceMentions: [notionSourceMention]
  })
  const item = surface.items[0]

  assert.equal(item?.title, "问 Notion")
  assert.deepEqual(item?.commandRef, {
    builtInId: "ai",
    commandName: "chat",
    kind: "built-in-command"
  })
  assert.equal(item?.commandOpenOptions?.initialAction, "focus")
  assert.equal(
    item?.commandOpenOptions?.seedQuery,
    "[@notion](jingle-extension-source://notion/notion)"
  )
})

test("@ query pins extension source refs above regular launcher results", () => {
  const surface = buildSurface("@notion summarize roadmap", {
    searchResults: [
      {
        action: {
          executor: "shell",
          target: {
            url: "https://example.com/notion-roadmap"
          },
          type: "open-url"
        },
        id: "quicklink:notion-roadmap",
        kind: "url",
        score: 900,
        source: "quicklinks",
        subtitle: "example.com",
        title: "Notion roadmap"
      }
    ],
    sourceMentions: [
      notionSourceMention,
      {
        extensionName: "apple-reminders",
        iconName: "reminders",
        label: "Apple Reminders",
        sourceId: "apple-reminders",
        tools: [],
        value: "apple-reminders"
      }
    ]
  })

  assert.equal(surface.items[0]?.title, "问 Notion")
  assert.equal(
    surface.items[0]?.commandOpenOptions?.seedQuery,
    "[@notion](jingle-extension-source://notion/notion) summarize roadmap"
  )
  assert.equal(
    surface.items.some((item) => item.id === "quicklink:notion-roadmap"),
    true
  )
})

test("disabled use-with extension commands do not get promoted as primary results", () => {
  const surface = buildSurface("translate hello to chinese", {
    useWithDisabledCommandKeys: ["translate:translate"]
  })

  assert.notDeepEqual(surface.items[0]?.commandRef, {
    commandName: "translate",
    extensionName: "translate",
    kind: "extension-command"
  })
  assert.equal(
    surface.items.some((item) => item.id.startsWith("use-with:translate:")),
    false
  )
})
