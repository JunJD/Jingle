import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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
const notionGeneratedQuicklinkAliases = [
  {
    fromExtensionName: "notion-generated",
    nameReplacements: [
      {
        from: "generated Notion",
        to: "Notion"
      },
      {
        from: "Notion Generated",
        to: "Notion"
      }
    ],
    toExtensionName: "notion"
  }
] as const

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

test("quicklink launcher search opens legacy generated Notion command quicklinks through formal Notion", async () => {
  configureQuicklinksLauncherSearchProvider({
    aliases: notionGeneratedQuicklinkAliases,
    listQuicklinks: () => [
      {
        createdAt: "2026-05-27T00:00:00.000Z",
        extensionName: "notion-generated",
        id: "quicklink-notion-create-page",
        link: "openwork://extensions/notion-generated/create-database-page?launchContext=%7B%22defaults%22%3A%7B%22title%22%3A%22Spec%22%7D%7D",
        name: "Create generated Notion page",
        updatedAt: "2026-05-27T00:00:00.000Z"
      }
    ]
  })

  const response = await quicklinksLauncherSearchProvider.search({
    limit: 5,
    query: "notion",
    sources: ["quicklinks"]
  })

  assert.equal(response.results.length, 1)
  assert.deepEqual(response.results[0], {
    action: {
      executor: "internal",
      target: {
        commandName: "create-database-page",
        extensionName: "notion",
        launchProps: {
          launchContext: {
            defaults: {
              title: "Spec"
            }
          }
        }
      },
      type: "open-extension-command"
    },
    id: "quicklink-notion-create-page",
    kind: "url",
    score: 650,
    source: "quicklinks",
    subtitle:
      "notion · openwork://extensions/notion/create-database-page?launchContext=%7B%22defaults%22%3A%7B%22title%22%3A%22Spec%22%7D%7D",
    title: "Create Notion page"
  })
})

test("extension quicklink service can rename and remove registered command quicklinks", async () => {
  const originalOpenworkHome = process.env.OPENWORK_HOME
  const openworkHome = await mkdtemp(join(tmpdir(), "openwork-extension-quicklinks-"))

  try {
    process.env.OPENWORK_HOME = openworkHome
    installElectronStoreMock()

    const { ExtensionQuicklinkRepository } = await import(
      "../../src/main/extension-quicklinks/repository"
    )
    const { ExtensionQuicklinkService } = await import(
      "../../src/main/extension-quicklinks/service"
    )

    const service = new ExtensionQuicklinkService(new ExtensionQuicklinkRepository())
    const quicklink = service.registerQuicklink({
      extensionName: "notion",
      link: "openwork://extensions/notion/create-database-page?launchContext=%7B%22defaults%22%3A%7B%22title%22%3A%22Spec%22%7D%7D",
      name: "Create Notion page"
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
    if (originalOpenworkHome === undefined) {
      delete process.env.OPENWORK_HOME
    } else {
      process.env.OPENWORK_HOME = originalOpenworkHome
    }
    await rm(openworkHome, { force: true, recursive: true })
  }
})

test("extension quicklink repository migrates generated Notion command links to formal Notion", async () => {
  const originalOpenworkHome = process.env.OPENWORK_HOME
  const openworkHome = await mkdtemp(join(tmpdir(), "openwork-extension-quicklinks-migrate-"))
  const storePath = join(openworkHome, "extension-quicklinks.json")
  const legacyLink =
    "openwork://extensions/notion-generated/create-database-page?launchContext=%7B%22defaults%22%3A%7B%22title%22%3A%22Spec%22%7D%7D"
  const formalLink =
    "openwork://extensions/notion/create-database-page?launchContext=%7B%22defaults%22%3A%7B%22title%22%3A%22Spec%22%7D%7D"

  try {
    process.env.OPENWORK_HOME = openworkHome
    installElectronStoreMock()
    await mkdir(openworkHome, { recursive: true })
    await writeFile(
      storePath,
      JSON.stringify({
        quicklinks: [
          {
            createdAt: "2026-05-27T00:00:00.000Z",
            extensionName: "notion-generated",
            id: "legacy-generated",
            link: legacyLink,
            name: "Create generated Notion page",
            updatedAt: "2026-05-27T00:00:00.000Z"
          },
          {
            createdAt: "2026-05-28T00:00:00.000Z",
            extensionName: "notion",
            id: "formal-existing",
            link: formalLink,
            name: "Create Notion page",
            updatedAt: "2026-05-28T00:00:00.000Z"
          }
        ]
      }),
      "utf8"
    )

    const { ExtensionQuicklinkRepository } = await import(
      "../../src/main/extension-quicklinks/repository"
    )
    const repository = new ExtensionQuicklinkRepository(notionGeneratedQuicklinkAliases)

    const migratedQuicklinks = repository.list()
    assert.equal(migratedQuicklinks.length, 1)
    assert.equal(migratedQuicklinks[0]?.id, "formal-existing")
    assert.equal(migratedQuicklinks[0]?.extensionName, "notion")
    assert.equal(migratedQuicklinks[0]?.link, formalLink)
    assert.equal(migratedQuicklinks[0]?.name, "Create Notion page")

    const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
      quicklinks: Array<{ extensionName?: string; link: string }>
    }
    assert.deepEqual(persisted.quicklinks, [
      {
        createdAt: "2026-05-28T00:00:00.000Z",
        extensionName: "notion",
        id: "formal-existing",
        link: formalLink,
        name: "Create Notion page",
        updatedAt: "2026-05-28T00:00:00.000Z"
      }
    ])

    const registered = repository.register({
      extensionName: "notion-generated",
      link: legacyLink,
      name: "Create Notion page again"
    })
    assert.equal(registered.id, "formal-existing")
    assert.equal(registered.extensionName, "notion")
    assert.equal(registered.link, formalLink)
    assert.equal(repository.list().length, 1)
  } finally {
    if (originalOpenworkHome === undefined) {
      delete process.env.OPENWORK_HOME
    } else {
      process.env.OPENWORK_HOME = originalOpenworkHome
    }
    await rm(openworkHome, { force: true, recursive: true })
  }
})

test("extension quicklink controller exposes list update and remove IPC handlers", async () => {
  const registeredQuicklink = {
    createdAt: "2026-05-29T00:00:00.000Z",
    extensionName: "notion",
    id: "quicklink-1",
    link: "openwork://extensions/notion/search-page",
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
  const { ExtensionQuicklinkController } = await import(
    "../../src/main/extension-quicklinks/controller"
  )
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
      (await handlers
        .get("extensionQuicklinks:update")
        ?.({} as IpcMainInvokeEvent, "quicklink-1", { name: "Search docs" })) as {
        name: string
      }
    ).name,
    "Search docs"
  )
  await handlers.get("extensionQuicklinks:remove")?.({} as IpcMainInvokeEvent, "quicklink-1")

  assert.deepEqual(calls, ["list", "update:quicklink-1:Search docs", "remove:quicklink-1"])
})
