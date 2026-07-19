import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  ApplicationsLauncherSearchProvider,
  createWindowsApplicationInventoryFingerprint,
  type LauncherApplicationRecord,
  type WindowsApplicationInventoryRecord
} from "../../src/main/services/launcher-search/providers/applications"
import type { WindowsApplicationCatalogCacheSnapshot } from "../../src/main/services/launcher-search/windows-application-catalog-cache"

function createApplicationRecord(
  input: Pick<LauncherApplicationRecord, "displayName" | "path"> &
    Partial<Pick<LauncherApplicationRecord, "appUserModelId" | "keywords" | "localizedNames">>
): LauncherApplicationRecord {
  const bundleName = input.displayName
  const localizedNames = input.localizedNames ?? []

  return {
    ...(input.appUserModelId ? { appUserModelId: input.appUserModelId } : {}),
    bundleName,
    displayName: input.displayName,
    id: input.path,
    keywords: input.keywords ?? [input.displayName.toLowerCase(), ...localizedNames],
    localizedNames,
    path: input.path,
    subtitle: "Application"
  }
}

function createWindowsPackagedApplicationRecord(input: {
  appUserModelId: string
  displayName: string
  iconPath?: string
}) {
  return {
    appUserModelId: input.appUserModelId,
    bundleName: input.displayName,
    displayName: input.displayName,
    ...(input.iconPath ? { iconPath: input.iconPath } : {}),
    id: `windows-packaged:${input.appUserModelId}`,
    keywords: [input.displayName.toLowerCase(), input.appUserModelId.toLowerCase()],
    localizedNames: [],
    subtitle: "Microsoft Store"
  }
}

function createWindowsApplicationInventoryRecord(input: {
  appUserModelId: string
  displayName: string
}): WindowsApplicationInventoryRecord {
  return {
    appUserModelId: input.appUserModelId,
    displayName: input.displayName
  }
}

function createWindowsApplicationCatalogCacheSnapshot(input: {
  applications: ReturnType<typeof createWindowsPackagedApplicationRecord>[]
  enrichedAt?: number
  inventory: WindowsApplicationInventoryRecord[]
}): WindowsApplicationCatalogCacheSnapshot {
  return {
    enrichedAt: input.enrichedAt ?? 0,
    inventoryFingerprint: createWindowsApplicationInventoryFingerprint(input.inventory),
    records: input.applications.map((application) => ({
      appUserModelId: application.appUserModelId,
      displayName: application.displayName,
      ...(application.iconPath ? { iconPath: application.iconPath } : {})
    }))
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

test("Windows warmup on a cache miss does not run inventory or enrichment", async () => {
  let inventoryLoadCount = 0
  let enrichmentLoadCount = 0
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: async () => [],
    loadWindowsApplicationEnrichment: async () => {
      enrichmentLoadCount += 1
      return []
    },
    loadWindowsApplicationInventory: async () => {
      inventoryLoadCount += 1
      return []
    },
    platform: "win32",
    readWindowsApplicationCatalogCache: () => null,
    resolveApplicationIconDataUrl: async () => undefined
  })

  await provider.warmup()

  assert.equal(inventoryLoadCount, 0)
  assert.equal(enrichmentLoadCount, 0)
  assert.deepEqual(
    (await provider.search({ limit: 10, query: "recorder", sources: ["applications"] })).results,
    []
  )
  assert.equal(inventoryLoadCount, 0)
  assert.equal(enrichmentLoadCount, 0)
})

test("Windows cache hit is searchable immediately without inventory or enrichment", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "jingle-packaged-app-icon-"))
  const iconPath = join(temporaryDirectory, "recorder.png")
  await writeFile(iconPath, "icon")
  const appUserModelId = "Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe!App"
  const application = createWindowsPackagedApplicationRecord({
    appUserModelId,
    displayName: "Sound Recorder",
    iconPath
  })
  const inventory = [createWindowsApplicationInventoryRecord(application)]
  const resolvedIconPaths: string[] = []
  let inventoryLoadCount = 0
  let enrichmentLoadCount = 0
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: async () => [],
    loadWindowsApplicationEnrichment: async () => {
      enrichmentLoadCount += 1
      return []
    },
    loadWindowsApplicationInventory: async () => {
      inventoryLoadCount += 1
      return []
    },
    platform: "win32",
    readWindowsApplicationCatalogCache: () =>
      createWindowsApplicationCatalogCacheSnapshot({ applications: [application], inventory }),
    resolveApplicationIconDataUrl: async (applicationPath) => {
      resolvedIconPaths.push(applicationPath)
      return "data:image/png;base64,aWNvbg=="
    }
  })

  try {
    const [result] = (
      await provider.search({ limit: 10, query: "recorder", sources: ["applications"] })
    ).results

    assert.equal(result?.action.type, "launch-windows-packaged-application")
    assert.deepEqual(result?.action.target, { appUserModelId })
    assert.equal(result?.historyKey, `application:windows-packaged:${appUserModelId}`)
    assert.equal(result?.iconDataUrl, "data:image/png;base64,aWNvbg==")
    assert.deepEqual(resolvedIconPaths, [iconPath])
    assert.equal(inventoryLoadCount, 0)
    assert.equal(enrichmentLoadCount, 0)
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
})

test("Windows cached packaged application replaces a path shortcut with the same AUMID", async () => {
  const appUserModelId = "Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe!App"
  const packagedApplication = createWindowsPackagedApplicationRecord({
    appUserModelId,
    displayName: "Sound Recorder"
  })
  const inventory = [createWindowsApplicationInventoryRecord(packagedApplication)]
  const shortcutPath = "C:\\Start Menu\\Legacy Recorder Shortcut.lnk"
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: async () => [
      createApplicationRecord({
        appUserModelId: appUserModelId.toUpperCase(),
        displayName: "Legacy Recorder Shortcut",
        path: shortcutPath
      })
    ],
    platform: "win32",
    readWindowsApplicationCatalogCache: () =>
      createWindowsApplicationCatalogCacheSnapshot({
        applications: [packagedApplication],
        inventory
      }),
    resolveApplicationIconDataUrl: async () => undefined
  })

  assert.equal(
    (
      await provider.search({
        limit: 10,
        query: "legacy recorder shortcut",
        sources: ["applications"]
      })
    ).results.length,
    0
  )

  const [packagedResult] = (
    await provider.search({ limit: 10, query: "sound recorder", sources: ["applications"] })
  ).results
  assert.equal(packagedResult?.action.type, "launch-windows-packaged-application")
  assert.equal(
    await provider.getWindowsPackagedApplicationIdForPath(shortcutPath.toLowerCase()),
    appUserModelId
  )
})

test("Windows cached packaged application does not dedupe a same-title path without AUMID", async () => {
  const displayName = "Sound Recorder"
  const packagedApplication = createWindowsPackagedApplicationRecord({
    appUserModelId: "Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe!App",
    displayName
  })
  const inventory = [createWindowsApplicationInventoryRecord(packagedApplication)]
  const shortcutPath = "C:\\Start Menu\\Sound Recorder.lnk"
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: async () => [
      createApplicationRecord({ displayName, path: shortcutPath })
    ],
    platform: "win32",
    readWindowsApplicationCatalogCache: () =>
      createWindowsApplicationCatalogCacheSnapshot({
        applications: [packagedApplication],
        inventory
      }),
    resolveApplicationIconDataUrl: async () => undefined
  })

  const results = (
    await provider.search({ limit: 10, query: "sound recorder", sources: ["applications"] })
  ).results

  assert.equal(results.length, 2)
  assert.deepEqual(results.map((result) => result.action.type).toSorted(), [
    "launch-windows-packaged-application",
    "open-path"
  ])
  assert.equal(await provider.getWindowsPackagedApplicationIdForPath(shortcutPath), undefined)
})

test("Windows unchanged inventory skips enrichment and cache writes", async () => {
  const application = createWindowsPackagedApplicationRecord({
    appUserModelId: "Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe!App",
    displayName: "Sound Recorder"
  })
  const inventory = [createWindowsApplicationInventoryRecord(application)]
  const snapshot = createWindowsApplicationCatalogCacheSnapshot({
    applications: [application],
    enrichedAt: 1_000,
    inventory
  })
  let enrichmentLoadCount = 0
  let inventoryLoadCount = 0
  let writeCount = 0
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: async () => [],
    loadWindowsApplicationEnrichment: async () => {
      enrichmentLoadCount += 1
      return [application]
    },
    loadWindowsApplicationInventory: async () => {
      inventoryLoadCount += 1
      return inventory
    },
    now: () => 2_000,
    platform: "win32",
    readWindowsApplicationCatalogCache: () => snapshot,
    resolveApplicationIconDataUrl: async () => undefined,
    writeWindowsApplicationCatalogCache: () => {
      writeCount += 1
    }
  })

  await provider.warmup()

  assert.equal(await provider.refreshIfStale(), false)
  assert.equal(inventoryLoadCount, 1)
  assert.equal(enrichmentLoadCount, 0)
  assert.equal(writeCount, 0)
})

test("Windows changed inventory triggers enrichment, swaps the catalog, and writes cache", async () => {
  const oldApplication = createWindowsPackagedApplicationRecord({
    appUserModelId: "Contoso.Recorder_oldfamily!App",
    displayName: "Old Store Recorder"
  })
  const newApplication = createWindowsPackagedApplicationRecord({
    appUserModelId: "Contoso.Recorder_newfamily!App",
    displayName: "New Store Recorder"
  })
  const oldInventory = [createWindowsApplicationInventoryRecord(oldApplication)]
  const newInventory = [createWindowsApplicationInventoryRecord(newApplication)]
  const writes: WindowsApplicationCatalogCacheSnapshot[] = []
  let enrichmentLoadCount = 0
  let inventoryLoadCount = 0
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: async () => [],
    loadWindowsApplicationEnrichment: async () => {
      enrichmentLoadCount += 1
      return [newApplication]
    },
    loadWindowsApplicationInventory: async () => {
      inventoryLoadCount += 1
      return newInventory
    },
    now: () => 10_000,
    platform: "win32",
    readWindowsApplicationCatalogCache: () =>
      createWindowsApplicationCatalogCacheSnapshot({
        applications: [oldApplication],
        enrichedAt: 9_000,
        inventory: oldInventory
      }),
    resolveApplicationIconDataUrl: async () => undefined,
    writeWindowsApplicationCatalogCache: (snapshot) => {
      writes.push(snapshot)
    }
  })

  await provider.warmup()

  assert.equal(await provider.refreshIfStale(), true)
  assert.equal(inventoryLoadCount, 1)
  assert.equal(enrichmentLoadCount, 1)
  assert.deepEqual(writes, [
    createWindowsApplicationCatalogCacheSnapshot({
      applications: [newApplication],
      enrichedAt: 10_000,
      inventory: newInventory
    })
  ])
  assert.equal(
    (await provider.search({ limit: 10, query: "old store", sources: ["applications"] })).results
      .length,
    0
  )
  assert.equal(
    (await provider.search({ limit: 10, query: "new store", sources: ["applications"] })).results
      .length,
    1
  )
})

test("Windows enrichment fingerprints its own catalog when inventory observations disagree", async () => {
  const inventoryApplication = createWindowsPackagedApplicationRecord({
    appUserModelId: "Contoso.Inventory_family!App",
    displayName: "Inventory Store App"
  })
  const enrichedApplication = createWindowsPackagedApplicationRecord({
    appUserModelId: "Contoso.Enriched_family!App",
    displayName: "Enriched Store App"
  })
  const inventory = [createWindowsApplicationInventoryRecord(inventoryApplication)]
  const enrichedInventory = [createWindowsApplicationInventoryRecord(enrichedApplication)]
  const inventoryFingerprint = createWindowsApplicationInventoryFingerprint(inventory)
  const enrichedFingerprint = createWindowsApplicationInventoryFingerprint(enrichedInventory)
  const writes: WindowsApplicationCatalogCacheSnapshot[] = []
  let now = 10_000
  let inventoryLoadCount = 0
  let enrichmentLoadCount = 0
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: async () => [],
    loadWindowsApplicationEnrichment: async () => {
      enrichmentLoadCount += 1
      return [enrichedApplication]
    },
    loadWindowsApplicationInventory: async () => {
      inventoryLoadCount += 1
      return inventory
    },
    now: () => now,
    platform: "win32",
    readWindowsApplicationCatalogCache: () =>
      createWindowsApplicationCatalogCacheSnapshot({ applications: [], inventory: [] }),
    resolveApplicationIconDataUrl: async () => undefined,
    writeWindowsApplicationCatalogCache: (snapshot) => {
      writes.push(snapshot)
    }
  })

  await provider.warmup()

  assert.equal(await provider.refreshIfStale(), true)
  assert.equal(writes[0]?.inventoryFingerprint, enrichedFingerprint)
  assert.notEqual(writes[0]?.inventoryFingerprint, inventoryFingerprint)

  now += 5 * 60_000
  assert.equal(await provider.refreshIfStale(), false)
  assert.equal(inventoryLoadCount, 2)
  assert.equal(enrichmentLoadCount, 2)
  assert.deepEqual(
    writes.map((snapshot) => snapshot.inventoryFingerprint),
    [enrichedFingerprint, enrichedFingerprint]
  )
})

test("Windows changed inventory restores a suppressed shortcut when a package disappears", async () => {
  const packagedApplication = createWindowsPackagedApplicationRecord({
    appUserModelId: "Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe!App",
    displayName: "Sound Recorder"
  })
  const cachedInventory = [createWindowsApplicationInventoryRecord(packagedApplication)]
  const shortcutPath = "C:\\Start Menu\\Legacy Recorder Shortcut.lnk"
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: async () => [
      createApplicationRecord({
        appUserModelId: packagedApplication.appUserModelId.toUpperCase(),
        displayName: "Legacy Recorder Shortcut",
        path: shortcutPath
      })
    ],
    loadWindowsApplicationEnrichment: async () => [],
    loadWindowsApplicationInventory: async () => [],
    now: () => 10_000,
    platform: "win32",
    readWindowsApplicationCatalogCache: () =>
      createWindowsApplicationCatalogCacheSnapshot({
        applications: [packagedApplication],
        enrichedAt: 9_000,
        inventory: cachedInventory
      }),
    resolveApplicationIconDataUrl: async () => undefined,
    writeWindowsApplicationCatalogCache: () => undefined
  })

  await provider.warmup()
  assert.equal(
    (
      await provider.search({
        limit: 10,
        query: "legacy recorder shortcut",
        sources: ["applications"]
      })
    ).results.length,
    0
  )

  assert.equal(await provider.refreshIfStale(), true)

  const [fallbackResult] = (
    await provider.search({
      limit: 10,
      query: "legacy recorder shortcut",
      sources: ["applications"]
    })
  ).results
  assert.equal(fallbackResult?.action.type, "open-path")
  assert.deepEqual(fallbackResult?.action.target, {
    kind: "application",
    path: shortcutPath
  })
  assert.equal(await provider.getWindowsPackagedApplicationIdForPath(shortcutPath), undefined)
})

test("Windows inventory failure is retried only after inventory backoff", async () => {
  let now = 1_000
  let inventoryLoadCount = 0
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: async () => [],
    loadWindowsApplicationEnrichment: async () => [],
    loadWindowsApplicationInventory: async () => {
      inventoryLoadCount += 1
      throw new Error("inventory unavailable")
    },
    now: () => now,
    platform: "win32",
    readWindowsApplicationCatalogCache: () => null,
    resolveApplicationIconDataUrl: async () => undefined,
    writeWindowsApplicationCatalogCache: () => undefined
  })

  await provider.warmup()
  await assert.rejects(provider.refreshIfStale(), /inventory unavailable/)
  assert.equal(inventoryLoadCount, 1)

  assert.equal(await provider.refreshIfStale(), false)
  assert.equal(inventoryLoadCount, 1)

  now += 5 * 60_000
  await assert.rejects(provider.refreshIfStale(), /inventory unavailable/)
  assert.equal(inventoryLoadCount, 2)
})

test("Windows enrichment failure is retried only after enrichment backoff", async () => {
  let now = 1_000
  let inventoryLoadCount = 0
  let enrichmentLoadCount = 0
  const oldApplication = createWindowsPackagedApplicationRecord({
    appUserModelId: "Contoso.Recorder_oldfamily!App",
    displayName: "Old Store Recorder"
  })
  const newApplication = createWindowsPackagedApplicationRecord({
    appUserModelId: "Contoso.Recorder_newfamily!App",
    displayName: "New Store Recorder"
  })
  const oldInventory = [createWindowsApplicationInventoryRecord(oldApplication)]
  const newInventory = [createWindowsApplicationInventoryRecord(newApplication)]
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: async () => [],
    loadWindowsApplicationEnrichment: async () => {
      enrichmentLoadCount += 1
      if (enrichmentLoadCount === 1) {
        throw new Error("enrichment unavailable")
      }
      return [newApplication]
    },
    loadWindowsApplicationInventory: async () => {
      inventoryLoadCount += 1
      return newInventory
    },
    now: () => now,
    platform: "win32",
    readWindowsApplicationCatalogCache: () =>
      createWindowsApplicationCatalogCacheSnapshot({
        applications: [oldApplication],
        enrichedAt: 500,
        inventory: oldInventory
      }),
    resolveApplicationIconDataUrl: async () => undefined,
    writeWindowsApplicationCatalogCache: () => undefined
  })

  await provider.warmup()
  await assert.rejects(provider.refreshIfStale(), /enrichment unavailable/)
  assert.equal(inventoryLoadCount, 1)
  assert.equal(enrichmentLoadCount, 1)

  now += 30_000
  assert.equal(await provider.refreshIfStale(), false)
  assert.equal(inventoryLoadCount, 1)
  assert.equal(enrichmentLoadCount, 1)

  now = 301_000
  assert.equal(await provider.refreshIfStale(), true)
  assert.equal(inventoryLoadCount, 2)
  assert.equal(enrichmentLoadCount, 2)
})

test("Windows cache write failure retries only the pending write after the next demand", async () => {
  const oldApplication = createWindowsPackagedApplicationRecord({
    appUserModelId: "Microsoft.WindowsNotepad_8wekyb3d8bbwe!App",
    displayName: "Notepad"
  })
  const application = createWindowsPackagedApplicationRecord({
    appUserModelId: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
    displayName: "Calculator"
  })
  const oldInventory = [createWindowsApplicationInventoryRecord(oldApplication)]
  const inventory = [createWindowsApplicationInventoryRecord(application)]
  let now = 1_000
  let enrichmentLoadCount = 0
  let inventoryLoadCount = 0
  let writeCount = 0
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: async () => [],
    loadWindowsApplicationEnrichment: async () => {
      enrichmentLoadCount += 1
      return [application]
    },
    loadWindowsApplicationInventory: async () => {
      inventoryLoadCount += 1
      return inventory
    },
    now: () => now,
    platform: "win32",
    readWindowsApplicationCatalogCache: () =>
      createWindowsApplicationCatalogCacheSnapshot({
        applications: [oldApplication],
        enrichedAt: 500,
        inventory: oldInventory
      }),
    resolveApplicationIconDataUrl: async () => undefined,
    writeWindowsApplicationCatalogCache: () => {
      writeCount += 1
      if (writeCount === 1) {
        throw new Error("cache write unavailable")
      }
    }
  })

  await provider.warmup()

  assert.equal(await provider.refreshIfStale(), true)
  assert.equal(writeCount, 1)
  const [result] = (
    await provider.search({ limit: 10, query: "calculator", sources: ["applications"] })
  ).results
  assert.equal(result?.action.type, "launch-windows-packaged-application")
  assert.deepEqual(result?.action.target, {
    appUserModelId: application.appUserModelId
  })

  provider.invalidate()
  assert.equal(
    (await provider.search({ limit: 10, query: "calculator", sources: ["applications"] })).results
      .length,
    1
  )
  assert.equal(
    (await provider.search({ limit: 10, query: "notepad", sources: ["applications"] })).results
      .length,
    0
  )
  assert.equal(inventoryLoadCount, 1)
  assert.equal(enrichmentLoadCount, 1)
  assert.equal(writeCount, 1)

  now += 5 * 60_000
  assert.equal(await provider.refreshIfStale(), false)
  assert.equal(inventoryLoadCount, 2)
  assert.equal(enrichmentLoadCount, 1)
  assert.equal(writeCount, 2)

  now += 5 * 60_000
  assert.equal(await provider.refreshIfStale(), false)
  assert.equal(inventoryLoadCount, 3)
  assert.equal(enrichmentLoadCount, 1)
  assert.equal(writeCount, 2)
})

test("Windows invalidation keeps an in-flight refresh single and preserves backoff", async () => {
  const oldApplication = createWindowsPackagedApplicationRecord({
    appUserModelId: "Contoso.Old_family!App",
    displayName: "Old Store App"
  })
  const newApplication = createWindowsPackagedApplicationRecord({
    appUserModelId: "Contoso.New_family!App",
    displayName: "New Store App"
  })
  const oldInventory = [createWindowsApplicationInventoryRecord(oldApplication)]
  const newInventory = [createWindowsApplicationInventoryRecord(newApplication)]
  let now = 1_000
  let inventoryLoadCount = 0
  let enrichmentLoadCount = 0
  let resolveFirstEnrichment!: (
    applications: ReturnType<typeof createWindowsPackagedApplicationRecord>[]
  ) => void
  const firstEnrichment = new Promise<ReturnType<typeof createWindowsPackagedApplicationRecord>[]>(
    (resolve) => {
      resolveFirstEnrichment = resolve
    }
  )
  let resolveEnrichmentStarted!: () => void
  const enrichmentStarted = new Promise<void>((resolve) => {
    resolveEnrichmentStarted = resolve
  })
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: async () => [],
    loadWindowsApplicationEnrichment: async () => {
      enrichmentLoadCount += 1
      if (enrichmentLoadCount === 1) {
        resolveEnrichmentStarted()
        return firstEnrichment
      }
      return [newApplication]
    },
    loadWindowsApplicationInventory: async () => {
      inventoryLoadCount += 1
      return newInventory
    },
    now: () => now,
    platform: "win32",
    readWindowsApplicationCatalogCache: () =>
      createWindowsApplicationCatalogCacheSnapshot({
        applications: [oldApplication],
        enrichedAt: 500,
        inventory: oldInventory
      }),
    resolveApplicationIconDataUrl: async () => undefined,
    writeWindowsApplicationCatalogCache: () => undefined
  })

  await provider.warmup()
  const firstRefresh = provider.refreshIfStale()
  await enrichmentStarted

  provider.invalidate()
  const refreshAfterInvalidation = provider.refreshIfStale()
  assert.equal(inventoryLoadCount, 1)
  assert.equal(enrichmentLoadCount, 1)

  resolveFirstEnrichment([newApplication])
  assert.deepEqual(await Promise.all([firstRefresh, refreshAfterInvalidation]), [false, false])

  assert.equal(await provider.refreshIfStale(), false)
  assert.equal(inventoryLoadCount, 1)
  assert.equal(enrichmentLoadCount, 1)

  now += 5 * 60_000
  assert.equal(await provider.refreshIfStale(), true)
  assert.equal(inventoryLoadCount, 2)
  assert.equal(enrichmentLoadCount, 2)
})

test("Windows stale refresh generation cannot overwrite memory or write cache", async () => {
  const initialApplication = createWindowsPackagedApplicationRecord({
    appUserModelId: "Contoso.Initial_family!App",
    displayName: "Initial Store App"
  })
  const freshApplication = createWindowsPackagedApplicationRecord({
    appUserModelId: "Contoso.Fresh_family!App",
    displayName: "Fresh Store App"
  })
  const staleApplication = createWindowsPackagedApplicationRecord({
    appUserModelId: "Contoso.Stale_family!App",
    displayName: "Stale Store App"
  })
  const initialInventory = [createWindowsApplicationInventoryRecord(initialApplication)]
  const freshInventory = [createWindowsApplicationInventoryRecord(freshApplication)]
  const staleInventory = [createWindowsApplicationInventoryRecord(staleApplication)]
  let cacheSnapshot = createWindowsApplicationCatalogCacheSnapshot({
    applications: [initialApplication],
    enrichedAt: 500,
    inventory: initialInventory
  })
  let resolveEnrichmentStarted!: () => void
  let resolveStaleEnrichment!: (
    applications: ReturnType<typeof createWindowsPackagedApplicationRecord>[]
  ) => void
  const enrichmentStarted = new Promise<void>((resolve) => {
    resolveEnrichmentStarted = resolve
  })
  const staleEnrichment = new Promise<ReturnType<typeof createWindowsPackagedApplicationRecord>[]>(
    (resolve) => {
      resolveStaleEnrichment = resolve
    }
  )
  const writes: WindowsApplicationCatalogCacheSnapshot[] = []
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: async () => [],
    loadWindowsApplicationEnrichment: async () => {
      resolveEnrichmentStarted()
      return staleEnrichment
    },
    loadWindowsApplicationInventory: async () => staleInventory,
    now: () => 1_000,
    platform: "win32",
    readWindowsApplicationCatalogCache: () => cacheSnapshot,
    resolveApplicationIconDataUrl: async () => undefined,
    writeWindowsApplicationCatalogCache: (snapshot) => {
      writes.push(snapshot)
    }
  })

  await provider.warmup()
  const refreshPromise = provider.refreshIfStale()
  await enrichmentStarted

  provider.invalidate()
  cacheSnapshot = createWindowsApplicationCatalogCacheSnapshot({
    applications: [freshApplication],
    enrichedAt: 1_000,
    inventory: freshInventory
  })
  assert.equal(
    (await provider.search({ limit: 10, query: "fresh store", sources: ["applications"] })).results
      .length,
    1
  )

  resolveStaleEnrichment([staleApplication])

  assert.equal(await refreshPromise, false)
  assert.deepEqual(writes, [])
  assert.equal(
    (await provider.search({ limit: 10, query: "stale store", sources: ["applications"] })).results
      .length,
    0
  )
  assert.equal(
    (await provider.search({ limit: 10, query: "fresh store", sources: ["applications"] })).results
      .length,
    1
  )
})
