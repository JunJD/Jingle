import assert from "node:assert/strict"
import test from "node:test"
import {
  ApplicationsLauncherSearchProvider,
  type LauncherApplicationRecord
} from "../../src/main/services/launcher-search/providers/applications"

function createApplicationRecord(
  input: Pick<LauncherApplicationRecord, "displayName" | "path"> &
    Partial<Pick<LauncherApplicationRecord, "keywords" | "localizedNames">>
): LauncherApplicationRecord {
  const bundleName = input.displayName
  const localizedNames = input.localizedNames ?? []

  return {
    bundleName,
    displayName: input.displayName,
    id: input.path,
    keywords: input.keywords ?? [input.displayName.toLowerCase(), ...localizedNames],
    localizedNames,
    path: input.path,
    subtitle: "应用程序"
  }
}

test("application search reloads the cached catalog after invalidation", async () => {
  const jingle = createApplicationRecord({
    displayName: "Jingle",
    path: "/Applications/Jingle.app"
  })
  const catalogs: LauncherApplicationRecord[][] = [[], [jingle]]
  let loadCount = 0
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: async () => catalogs[Math.min(loadCount++, catalogs.length - 1)]!,
    resolveApplicationIconDataUrl: async () => undefined
  })

  assert.deepEqual(
    (await provider.search({ limit: 10, query: "jingle", sources: ["applications"] })).results,
    []
  )
  assert.equal(loadCount, 1)

  assert.deepEqual(
    (await provider.search({ limit: 10, query: "jingle", sources: ["applications"] })).results,
    []
  )
  assert.equal(loadCount, 1)

  provider.invalidate()

  const refreshedResults = (
    await provider.search({ limit: 10, query: "jingle", sources: ["applications"] })
  ).results

  assert.equal(loadCount, 2)
  assert.equal(refreshedResults.length, 1)
  assert.equal(refreshedResults[0]?.title, "Jingle")
  assert.equal(refreshedResults[0]?.action.type, "open-path")
  assert.deepEqual(refreshedResults[0]?.action.target, {
    kind: "application",
    path: "/Applications/Jingle.app"
  })
})

test("application search matches localized Chinese names and pinyin", async () => {
  const wechat = createApplicationRecord({
    displayName: "WeChat",
    localizedNames: ["微信"],
    path: "/Applications/WeChat.app"
  })
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: async () => [wechat],
    resolveApplicationIconDataUrl: async () => undefined
  })

  const chineseResults = (
    await provider.search({ limit: 10, query: "微信", sources: ["applications"] })
  ).results
  const pinyinResults = (
    await provider.search({ limit: 10, query: "weixin", sources: ["applications"] })
  ).results
  const englishResults = (
    await provider.search({ limit: 10, query: "wechat", sources: ["applications"] })
  ).results

  assert.equal(chineseResults.length, 1)
  assert.equal(chineseResults[0]?.title, "微信")
  assert.equal(chineseResults[0]?.action.type, "open-path")
  assert.deepEqual(chineseResults[0]?.action.target, {
    kind: "application",
    path: "/Applications/WeChat.app"
  })
  assert.equal(pinyinResults.length, 1)
  assert.equal(pinyinResults[0]?.title, "微信")
  assert.equal(englishResults.length, 1)
  assert.equal(englishResults[0]?.title, "WeChat")
})
