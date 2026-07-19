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

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
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

test("application catalog caller cancellation does not cancel another waiter", async () => {
  const catalog = createDeferred<LauncherApplicationRecord[]>()
  const catalogSignals: AbortSignal[] = []
  const jingle = createApplicationRecord({
    displayName: "Jingle",
    path: "/Applications/Jingle.app"
  })
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: (signal) => {
      catalogSignals.push(signal)
      return catalog.promise
    },
    resolveApplicationIconDataUrl: async () => undefined
  })
  const firstController = new AbortController()
  const secondController = new AbortController()
  const firstSearch = provider.search(
    { limit: 10, query: "jin", sources: ["applications"] },
    { signal: firstController.signal }
  )
  const secondSearch = provider.search(
    { limit: 10, query: "jingle", sources: ["applications"] },
    { signal: secondController.signal }
  )

  firstController.abort(new Error("first search cancelled"))
  await assert.rejects(firstSearch, /first search cancelled/)
  assert.equal(catalogSignals.length, 1)
  assert.equal(catalogSignals[0]?.aborted, false)

  catalog.resolve([jingle])
  assert.equal((await secondSearch).results[0]?.title, "Jingle")
})

test("application catalog warmup cancellation does not poison an active search", async () => {
  const catalog = createDeferred<LauncherApplicationRecord[]>()
  const catalogSignals: AbortSignal[] = []
  const jingle = createApplicationRecord({
    displayName: "Jingle",
    path: "/Applications/Jingle.app"
  })
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: (signal) => {
      catalogSignals.push(signal)
      return catalog.promise
    },
    resolveApplicationIconDataUrl: async () => undefined
  })
  const warmupController = new AbortController()
  const searchController = new AbortController()
  const warmup = provider.warmup({ signal: warmupController.signal })
  const search = provider.search(
    { limit: 10, query: "jingle", sources: ["applications"] },
    { signal: searchController.signal }
  )

  warmupController.abort(new Error("warmup cancelled"))
  await assert.rejects(warmup, /warmup cancelled/)
  assert.equal(catalogSignals.length, 1)
  assert.equal(catalogSignals[0]?.aborted, false)

  catalog.resolve([jingle])
  assert.equal((await search).results[0]?.title, "Jingle")
})

test("application catalog continues across caller timeouts and becomes reusable", async () => {
  const catalog = createDeferred<LauncherApplicationRecord[]>()
  const catalogSignals: AbortSignal[] = []
  let loadCount = 0
  const jingle = createApplicationRecord({
    displayName: "Jingle",
    path: "/Applications/Jingle.app"
  })
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: (signal) => {
      catalogSignals.push(signal)
      loadCount += 1
      return catalog.promise
    },
    resolveApplicationIconDataUrl: async () => undefined
  })
  const firstController = new AbortController()
  const firstSearch = provider.search(
    { limit: 10, query: "jin", sources: ["applications"] },
    { signal: firstController.signal }
  )

  firstController.abort(new Error("first query timed out"))
  await assert.rejects(firstSearch, /first query timed out/)
  assert.equal(catalogSignals[0]?.aborted, false)

  const secondController = new AbortController()
  const secondSearch = provider.search(
    { limit: 10, query: "jingle", sources: ["applications"] },
    { signal: secondController.signal }
  )
  secondController.abort(new Error("second query timed out"))
  await assert.rejects(secondSearch, /second query timed out/)
  assert.equal(catalogSignals[0]?.aborted, false)
  assert.equal(loadCount, 1)

  catalog.resolve([jingle])
  await Promise.resolve()
  const cachedSearch = await provider.search(
    { limit: 10, query: "jingle", sources: ["applications"] },
    { signal: new AbortController().signal }
  )
  assert.equal(cachedSearch.results[0]?.title, "Jingle")
  assert.equal(loadCount, 1)
})

test("application catalog build deadline aborts a stuck loader and permits replacement", async () => {
  const stuckCatalog = createDeferred<LauncherApplicationRecord[]>()
  const catalogSignals: AbortSignal[] = []
  let loadCount = 0
  const jingle = createApplicationRecord({
    displayName: "Jingle",
    path: "/Applications/Jingle.app"
  })
  const provider = new ApplicationsLauncherSearchProvider({
    catalogBuildDeadlineMs: 10,
    loadApplicationCatalog: (signal) => {
      catalogSignals.push(signal)
      loadCount += 1
      return loadCount === 1 ? stuckCatalog.promise : Promise.resolve([jingle])
    },
    resolveApplicationIconDataUrl: async () => undefined
  })

  await assert.rejects(
    provider.search(
      { limit: 10, query: "jingle", sources: ["applications"] },
      { signal: new AbortController().signal }
    ),
    /build deadline/
  )
  assert.equal(catalogSignals[0]?.aborted, true)

  const replacementSearch = await provider.search(
    { limit: 10, query: "jingle", sources: ["applications"] },
    { signal: new AbortController().signal }
  )
  assert.equal(replacementSearch.results[0]?.title, "Jingle")
  assert.equal(loadCount, 2)
})
