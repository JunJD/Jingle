import assert from "node:assert/strict"
import test from "node:test"
import { appCopy } from "../../src/renderer/src/lib/i18n/messages"
import { buildLauncherHomeSurfaceModel } from "../../src/renderer/src/launcher-shell/home-surface"

const copy = appCopy["zh-CN"]

function buildSurface(
  query: string,
  options: {
    useWithDisabledCommandKeys?: readonly string[]
  } = {}
) {
  return buildLauncherHomeSurfaceModel({
    copy,
    historyItems: [],
    idleItems: [],
    locale: "zh-CN",
    query,
    searchResults: [],
    useWithDisabledCommandKeys: options.useWithDisabledCommandKeys,
    windowMode: "default"
  })
}

test("high confidence extension intents become the primary launcher result", () => {
  const surface = buildSurface("translate hello to chinese")

  assert.equal(surface.items[0]?.title, "翻译")
  assert.deepEqual(surface.items[0]?.commandRef, {
    commandName: "translate",
    extensionName: "translate",
    kind: "extension-command"
  })
  assert.equal(
    surface.items.some((item) => item.id.startsWith("use-with:translate:")),
    false
  )
})

test("exact extension command matches become the primary launcher result", () => {
  const surface = buildSurface("todo")

  assert.equal(surface.items[0]?.title, "待办列表")
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
