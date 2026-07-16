import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createRequire } from "node:module"
import type { IpcMain, IpcMainInvokeEvent } from "electron"
import {
  configureQuicklinksLauncherSearchProvider,
  quicklinksLauncherSearchProvider
} from "../../src/main/services/launcher-search/providers/quicklinks"

const requireFromTest = createRequire(import.meta.url)

function installElectronStoreMock(): void {
  const electronModuleId = requireFromTest.resolve("electron")
  requireFromTest("electron")
  const electronModule = requireFromTest.cache[electronModuleId]
  assert.ok(electronModule, "Expected electron module to be loaded before mocking electron-store.")

  electronModule.exports = {
    app: {
      getPath: () => tmpdir()
    }
  }
}

function createIpcMainMock(): {
  handlers: Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>
  ipcMain: Pick<IpcMain, "handle">
} {
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
  >()
  return {
    handlers,
    ipcMain: {
      handle: (channel, handler) => {
        handlers.set(channel, handler)
      }
    }
  }
}

test("extension quicklink service persists Linux shortcuts and can rename and remove quicklinks", async () => {
  const originalJingleHome = process.env.JINGLE_HOME
  const jingleHome = await mkdtemp(join(tmpdir(), "jingle-extension-quicklinks-"))

  try {
    process.env.JINGLE_HOME = jingleHome
    installElectronStoreMock()

    const { ExtensionQuicklinkRepository } =
      await import("../../src/main/extension-quicklinks/repository")
    const { ExtensionQuicklinkService } =
      await import("../../src/main/extension-quicklinks/service")

    const service = new ExtensionQuicklinkService(new ExtensionQuicklinkRepository())
    const quicklink = service.registerQuicklink({
      extensionName: "notion",
      link: "jingle://extensions/notion/create-database-page?launchContext=%7B%22defaults%22%3A%7B%22title%22%3A%22Spec%22%7D%7D",
      name: "Create Notion page",
      shortcut: {
        key: "l",
        modifiers: ["ctrl"],
        platform: "Linux"
      }
    })
    assert.equal(
      quicklink.link,
      "jingle://extensions/notion/create-database-page?launchContext=%7B%22defaults%22%3A%7B%22title%22%3A%22Spec%22%7D%7D"
    )
    assert.deepEqual(new ExtensionQuicklinkRepository().list()[0]?.shortcut, {
      key: "l",
      modifiers: ["ctrl"],
      platform: "Linux"
    })

    configureQuicklinksLauncherSearchProvider({
      listQuicklinks: () => service.listQuicklinks()
    })

    const renamedQuicklink = service.updateQuicklink(quicklink.id, {
      name: "Create spec page"
    })
    assert.equal(renamedQuicklink.id, quicklink.id)
    assert.equal(renamedQuicklink.name, "Create spec page")

    const renamedSearch = await quicklinksLauncherSearchProvider.search({
      limit: 5,
      query: "spec",
      sources: ["quicklinks"]
    })
    assert.equal(renamedSearch.results.length, 1)
    assert.equal(renamedSearch.results[0]?.title, "Create spec page")

    service.removeQuicklink(quicklink.id)

    const removedSearch = await quicklinksLauncherSearchProvider.search({
      limit: 5,
      query: "spec",
      sources: ["quicklinks"]
    })
    assert.deepEqual(removedSearch.results, [])
  } finally {
    if (originalJingleHome === undefined) {
      delete process.env.JINGLE_HOME
    } else {
      process.env.JINGLE_HOME = originalJingleHome
    }
    await rm(jingleHome, { force: true, recursive: true })
  }
})

test("extension quicklink controller exposes list update and remove IPC handlers", async () => {
  const registeredQuicklink = {
    createdAt: "2026-05-29T00:00:00.000Z",
    extensionName: "notion",
    id: "quicklink-1",
    link: "jingle://extensions/notion/search-page",
    name: "Search Notion",
    updatedAt: "2026-05-29T00:00:00.000Z"
  }
  const calls: string[] = []
  const service = {
    listQuicklinks: () => {
      calls.push("list")
      return [registeredQuicklink]
    },
    removeQuicklink: (quicklinkId: string) => {
      calls.push(`remove:${quicklinkId}`)
    },
    updateQuicklink: (quicklinkId: string, input: { name: string }) => {
      calls.push(`update:${quicklinkId}:${input.name}`)
      return {
        ...registeredQuicklink,
        name: input.name
      }
    }
  }
  const { ExtensionQuicklinkController } =
    await import("../../src/main/extension-quicklinks/controller")
  const { handlers, ipcMain } = createIpcMainMock()
  const controller = new ExtensionQuicklinkController(
    service as unknown as ConstructorParameters<typeof ExtensionQuicklinkController>[0]
  )

  controller.register(ipcMain as IpcMain)

  assert.deepEqual(await handlers.get("extensionQuicklinks:list")?.({} as IpcMainInvokeEvent), [
    registeredQuicklink
  ])
  assert.equal(
    (
      (await handlers.get("extensionQuicklinks:update")?.({} as IpcMainInvokeEvent, "quicklink-1", {
        name: "Search docs"
      })) as {
        name: string
      }
    ).name,
    "Search docs"
  )
  await handlers.get("extensionQuicklinks:remove")?.({} as IpcMainInvokeEvent, "quicklink-1")

  assert.deepEqual(calls, ["list", "update:quicklink-1:Search docs", "remove:quicklink-1"])
})
