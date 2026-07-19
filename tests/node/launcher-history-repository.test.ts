import assert from "node:assert/strict"
import test from "node:test"
import type { LauncherHistoryItem } from "../../src/shared/launcher-history"
import { createLauncherHistoryKey } from "../../src/shared/launcher-history"
import {
  LauncherHistoryRepository,
  type LauncherHistoryRepositoryOptions,
  type LauncherHistoryStoreAdapter
} from "../../src/main/launcher-history/repository"

const CALCULATOR_AUMID = "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"
const CALCULATOR_SHORTCUT =
  "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Calculator.lnk"

class MemoryStore implements LauncherHistoryStoreAdapter {
  readonly writes: LauncherHistoryItem[][] = []

  constructor(private items: unknown[]) {}

  get(): unknown {
    return this.items
  }

  set(_key: "items", value: LauncherHistoryItem[]): void {
    this.items = value
    this.writes.push(value)
  }
}

function createRepository(
  store: LauncherHistoryStoreAdapter,
  overrides: Omit<LauncherHistoryRepositoryOptions, "store"> = {}
): LauncherHistoryRepository {
  return new LauncherHistoryRepository({
    applicationIconResolver: async () => undefined,
    applicationNameResolver: async () => undefined,
    applicationSubtitleResolver: async () => undefined,
    canonicalApplicationResolver: async () => undefined,
    ...overrides,
    store
  })
}

function createPathHistoryItem(
  id: string,
  path: string,
  overrides: Partial<LauncherHistoryItem> = {}
): LauncherHistoryItem {
  return {
    action: {
      executor: "shell",
      target: { kind: "application", path },
      type: "open-path"
    },
    createdAt: "2026-07-19T08:00:00.000Z",
    historyKey: createLauncherHistoryKey({ path, type: "application" }),
    id,
    kind: "application",
    lastUsedAt: "2026-07-19T09:00:00.000Z",
    pin: false,
    subtitle: "",
    title: "Calculator",
    updatedAt: "2026-07-19T09:00:00.000Z",
    useCount: 1,
    ...overrides
  }
}

function createPackagedHistoryItem(
  id: string,
  appUserModelId: string,
  overrides: Partial<LauncherHistoryItem> = {}
): LauncherHistoryItem {
  return {
    action: {
      executor: "shell",
      target: { appUserModelId },
      type: "launch-windows-packaged-application"
    },
    createdAt: "2026-07-19T07:00:00.000Z",
    historyKey: createLauncherHistoryKey({
      appUserModelId,
      type: "windows-packaged-application"
    }),
    id,
    iconDataUrl: "data:image/png;base64,cGFja2FnZWQ=",
    kind: "application",
    lastUsedAt: "2026-07-19T08:30:00.000Z",
    pin: true,
    subtitle: "System app",
    title: "Old calculator name",
    updatedAt: "2026-07-19T08:30:00.000Z",
    useCount: 2,
    ...overrides
  }
}

test("list migrates an exact shortcut alias and merges duplicate packaged history", async () => {
  const store = new MemoryStore([
    createPackagedHistoryItem("packaged", CALCULATOR_AUMID),
    createPathHistoryItem("shortcut", CALCULATOR_SHORTCUT, {
      createdAt: "2026-07-19T06:00:00.000Z",
      lastUsedAt: "2026-07-19T10:00:00.000Z",
      subtitle: "C:\\Windows\\Start Menu\\Calculator.lnk",
      title: "Latest calculator name",
      updatedAt: "2026-07-19T10:00:00.000Z",
      useCount: 4
    })
  ])
  const repository = createRepository(store, {
    canonicalApplicationResolver: async (path) =>
      path === CALCULATOR_SHORTCUT ? CALCULATOR_AUMID : undefined
  })

  const items = await repository.list()

  assert.equal(items.length, 1)
  assert.deepEqual(items[0], {
    action: {
      executor: "shell",
      target: { appUserModelId: CALCULATOR_AUMID },
      type: "launch-windows-packaged-application"
    },
    createdAt: "2026-07-19T06:00:00.000Z",
    historyKey: createLauncherHistoryKey({
      appUserModelId: CALCULATOR_AUMID,
      type: "windows-packaged-application"
    }),
    iconDataUrl: "data:image/png;base64,cGFja2FnZWQ=",
    id: "shortcut",
    kind: "application",
    lastUsedAt: "2026-07-19T10:00:00.000Z",
    pin: true,
    subtitle: "System app",
    title: "Old calculator name",
    updatedAt: "2026-07-19T10:00:00.000Z",
    useCount: 6
  })
})

test("list migrates a single shortcut and enriches it with the packaged identity", async () => {
  const store = new MemoryStore([createPathHistoryItem("shortcut", CALCULATOR_SHORTCUT)])
  const iconIdentities: string[] = []
  const nameIdentities: string[] = []
  const subtitleIdentities: string[] = []
  const repository = createRepository(store, {
    applicationIconResolver: async (identity) => {
      iconIdentities.push(identity)
      return "data:image/png;base64,bmV3"
    },
    applicationNameResolver: async (identity) => {
      nameIdentities.push(identity)
      return "Windows Calculator"
    },
    applicationSubtitleResolver: async (identity) => {
      subtitleIdentities.push(identity)
      return "System app"
    },
    canonicalApplicationResolver: async () => CALCULATOR_AUMID
  })

  const [item] = await repository.list()

  assert.equal(item?.historyKey, `application:windows-packaged:${CALCULATOR_AUMID}`)
  assert.deepEqual(item?.action, {
    executor: "shell",
    target: { appUserModelId: CALCULATOR_AUMID },
    type: "launch-windows-packaged-application"
  })
  assert.equal(item?.title, "Windows Calculator")
  assert.equal(item?.subtitle, "System app")
  assert.equal(item?.iconDataUrl, "data:image/png;base64,bmV3")
  assert.deepEqual(iconIdentities, [CALCULATOR_AUMID])
  assert.deepEqual(nameIdentities, [CALCULATOR_AUMID])
  assert.deepEqual(subtitleIdentities, [CALCULATOR_AUMID])
})

test("list does not merge same-name applications without an exact shortcut alias", async () => {
  const firstPath = "C:\\Tools\\First\\Shared name.lnk"
  const secondPath = "C:\\Tools\\Second\\Shared name.lnk"
  const store = new MemoryStore([
    createPathHistoryItem("first", firstPath, { title: "Shared name" }),
    createPathHistoryItem("second", secondPath, { title: "Shared name" })
  ])
  const repository = createRepository(store)

  const items = await repository.list()

  assert.equal(items.length, 2)
  assert.deepEqual(
    new Set(items.map((item) => item.historyKey)),
    new Set([
      createLauncherHistoryKey({ path: firstPath, type: "application" }),
      createLauncherHistoryKey({ path: secondPath, type: "application" })
    ])
  )
  assert.equal(store.writes.length, 0)
})

test("list preserves local-start identity without resolving its application path", async () => {
  const localStartItem = createPathHistoryItem("local-start", CALCULATOR_SHORTCUT, {
    action: {
      executor: "shell",
      localStartItemId: "favorite-calculator",
      target: { kind: "application", path: CALCULATOR_SHORTCUT },
      type: "open-path"
    },
    historyKey: createLauncherHistoryKey({
      itemId: "favorite-calculator",
      type: "local-start"
    })
  })
  const store = new MemoryStore([localStartItem])
  let canonicalResolutionCount = 0
  const repository = createRepository(store, {
    canonicalApplicationResolver: async () => {
      canonicalResolutionCount += 1
      return CALCULATOR_AUMID
    }
  })

  const items = await repository.list()

  assert.deepEqual(items, [localStartItem])
  assert.equal(canonicalResolutionCount, 0)
  assert.equal(store.writes.length, 0)
})

test("listing migrated history twice does not duplicate its accumulated use count", async () => {
  const store = new MemoryStore([
    createPathHistoryItem("shortcut", CALCULATOR_SHORTCUT, { useCount: 3 }),
    createPackagedHistoryItem("packaged", CALCULATOR_AUMID, { useCount: 5 })
  ])
  const repository = createRepository(store, {
    canonicalApplicationResolver: async (path) =>
      path === CALCULATOR_SHORTCUT ? CALCULATOR_AUMID : undefined
  })

  const firstItems = await repository.list()
  const secondItems = await repository.list()

  assert.equal(firstItems[0]?.useCount, 8)
  assert.equal(secondItems[0]?.useCount, 8)
  assert.equal(secondItems.length, 1)
  assert.equal(store.writes.length, 1)
})

test("list persists the final migrated snapshot with one storage write", async () => {
  const store = new MemoryStore([createPathHistoryItem("shortcut", CALCULATOR_SHORTCUT)])
  const repository = createRepository(store, {
    canonicalApplicationResolver: async () => CALCULATOR_AUMID
  })

  const items = await repository.list()

  assert.equal(store.writes.length, 1)
  assert.deepEqual(store.writes[0], items)
  assert.equal(store.writes[0]?.[0]?.historyKey, `application:windows-packaged:${CALCULATOR_AUMID}`)
})
