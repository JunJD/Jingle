import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
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

test("Windows packaged applications use their manifest icon and dedicated launch action", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "jingle-packaged-app-icon-"))
  const iconPath = join(temporaryDirectory, "recorder.png")
  await writeFile(iconPath, "icon")
  const appUserModelId = "Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe!App"
  const resolvedIconPaths: string[] = []
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: async () => [],
    loadWindowsPackagedApplications: async () => [
      createWindowsPackagedApplicationRecord({
        appUserModelId,
        displayName: "Sound Recorder",
        iconPath
      })
    ],
    platform: "win32",
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
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
})

test("Windows packaged refresh preserves the last catalog on discovery failure and retries", async () => {
  let now = 0
  let packagedLoadCount = 0
  const appUserModelId = "Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe!App"
  const packagedApplication = createWindowsPackagedApplicationRecord({
    appUserModelId,
    displayName: "Sound Recorder"
  })
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: async () => [],
    loadWindowsPackagedApplications: async () => {
      packagedLoadCount += 1
      if (packagedLoadCount === 2) {
        throw new Error("temporary packaged discovery failure")
      }
      return [packagedApplication]
    },
    now: () => now,
    platform: "win32",
    resolveApplicationIconDataUrl: async () => undefined
  })

  assert.equal(
    (await provider.search({ limit: 10, query: "recorder", sources: ["applications"] })).results
      .length,
    1
  )
  now = 31_000

  await assert.rejects(provider.refreshIfStale(), /temporary packaged discovery failure/)
  assert.equal(
    (await provider.search({ limit: 10, query: "recorder", sources: ["applications"] })).results
      .length,
    1
  )
  assert.equal(await provider.refreshIfStale(), false)
  assert.equal(packagedLoadCount, 3)
})

test("Windows packaged refresh cannot overwrite a newer invalidated catalog", async () => {
  let now = 0
  let pathCatalog = [
    createApplicationRecord({ displayName: "Old Path App", path: "C:\\Old\\Old App.lnk" })
  ]
  let packagedLoadCount = 0
  let resolveStaleRefresh:
    | ((records: ReturnType<typeof createWindowsPackagedApplicationRecord>[]) => void)
    | undefined
  const staleRefresh = new Promise<ReturnType<typeof createWindowsPackagedApplicationRecord>[]>(
    (resolve) => {
      resolveStaleRefresh = resolve
    }
  )
  const provider = new ApplicationsLauncherSearchProvider({
    loadApplicationCatalog: async () => pathCatalog,
    loadWindowsPackagedApplications: async () => {
      packagedLoadCount += 1
      if (packagedLoadCount === 2) {
        return staleRefresh
      }
      return [
        createWindowsPackagedApplicationRecord({
          appUserModelId: "Fresh.Package_family!App",
          displayName: packagedLoadCount === 1 ? "Initial Store App" : "Fresh Store App"
        })
      ]
    },
    now: () => now,
    platform: "win32",
    resolveApplicationIconDataUrl: async () => undefined
  })

  await provider.warmup()
  now = 31_000
  const refreshPromise = provider.refreshIfStale()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(packagedLoadCount, 2)

  provider.invalidate()
  pathCatalog = [
    createApplicationRecord({ displayName: "Fresh Path App", path: "C:\\Fresh\\Fresh App.lnk" })
  ]
  assert.equal(
    (await provider.search({ limit: 10, query: "fresh path", sources: ["applications"] })).results
      .length,
    1
  )
  resolveStaleRefresh?.([
    createWindowsPackagedApplicationRecord({
      appUserModelId: "Stale.Package_family!App",
      displayName: "Stale Store App"
    })
  ])

  assert.equal(await refreshPromise, false)
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
