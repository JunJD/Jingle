import assert from "node:assert/strict"
import test from "node:test"
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import { OpenTargetsController } from "../../src/main/open-targets/controller"
import type { OpenTargetsService } from "../../src/main/open-targets/service"
import { registerWindowIdentity, type WindowIdentity } from "../../src/main/windows/window-identity"
import type { ListOpenTargetsRequest, OpenTargetRequest } from "../../src/shared/open-targets"

class FakeIpcMain {
  readonly handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()

  handle(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void {
    this.handlers.set(channel, handler)
  }

  invoke(channel: string, sender: FakeWebContents, ...args: unknown[]): Promise<unknown> {
    return this.invokeFromFrame(channel, sender, sender.mainFrame, ...args)
  }

  async invokeFromFrame(
    channel: string,
    sender: FakeWebContents,
    senderFrame: object,
    ...args: unknown[]
  ): Promise<unknown> {
    const handler = this.handlers.get(channel)
    assert.ok(handler, `Missing IPC handler for ${channel}`)
    return handler({ sender, senderFrame } as unknown as IpcMainInvokeEvent, ...args)
  }
}

class FakeWebContents {
  readonly mainFrame = {}

  isDestroyed(): boolean {
    return false
  }
}

function registerIdentity(sender: FakeWebContents, identity: WindowIdentity): void {
  registerWindowIdentity(sender as unknown as WebContents, identity)
}

function createHarness(input?: { invalidListResponse?: boolean }) {
  const listCalls: ListOpenTargetsRequest[] = []
  const openCalls: OpenTargetRequest[] = []
  const service = {
    async listTargets(request: ListOpenTargetsRequest) {
      listCalls.push(request)
      return input?.invalidListResponse
        ? { targets: [{ id: "finder", kind: "unknown", label: "Finder" }] }
        : { targets: [{ id: "finder", kind: "file-manager", label: "Finder" }] }
    },
    async openTarget(request: OpenTargetRequest) {
      openCalls.push(request)
    }
  } as unknown as OpenTargetsService
  const controller = new OpenTargetsController(service)
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)
  return { ipcMain, listCalls, openCalls }
}

test("open-target IPC admits registered Launcher and durable-window main frames", async () => {
  const { ipcMain, listCalls, openCalls } = createHarness()
  const identities: WindowIdentity[] = [
    { kind: "launcher" },
    { kind: "main", threadId: null, windowId: "primary-main" },
    { kind: "thread-window", threadId: "thread-a", windowId: "thread-window-a" }
  ]

  for (const identity of identities) {
    const sender = new FakeWebContents()
    registerIdentity(sender, identity)
    assert.deepEqual(await ipcMain.invoke("openTargets:list", sender, { folderPath: " /work " }), {
      targets: [{ id: "finder", kind: "file-manager", label: "Finder" }]
    })
    await ipcMain.invoke("openTargets:open", sender, {
      filePath: " file.txt ",
      folderPath: " /work ",
      targetId: " finder "
    })
  }

  assert.deepEqual(listCalls, [
    { folderPath: "/work" },
    { folderPath: "/work" },
    { folderPath: "/work" }
  ])
  assert.deepEqual(openCalls, [
    { filePath: "file.txt", folderPath: "/work", targetId: "finder" },
    { filePath: "file.txt", folderPath: "/work", targetId: "finder" },
    { filePath: "file.txt", folderPath: "/work", targetId: "finder" }
  ])
})

test("open-target IPC rejects unowned identities and subframes before service calls", async () => {
  const { ipcMain, listCalls, openCalls } = createHarness()
  for (const identity of [{ kind: "settings" }, { kind: "ipc-network" }] as const) {
    const sender = new FakeWebContents()
    registerIdentity(sender, identity)
    await assert.rejects(
      ipcMain.invoke("openTargets:list", sender, { folderPath: "/work" }),
      /Open targets can only be accessed by the Launcher or a durable window/
    )
    await assert.rejects(
      ipcMain.invoke("openTargets:open", sender, { folderPath: "/work", targetId: "finder" }),
      /Open targets can only be accessed by the Launcher or a durable window/
    )
  }

  const unregisteredSender = new FakeWebContents()
  await assert.rejects(
    ipcMain.invoke("openTargets:list", unregisteredSender, { folderPath: "/work" }),
    /Open targets can only be accessed by the Launcher or a durable window/
  )

  const launcherSender = new FakeWebContents()
  registerIdentity(launcherSender, { kind: "launcher" })
  await assert.rejects(
    ipcMain.invokeFromFrame(
      "openTargets:open",
      launcherSender,
      {},
      {
        folderPath: "/work",
        targetId: "finder"
      }
    ),
    /Open targets can only be accessed by the Launcher or a durable window/
  )

  assert.deepEqual(listCalls, [])
  assert.deepEqual(openCalls, [])
})

test("open-target IPC rejects malformed requests and malformed main projections", async () => {
  const { ipcMain, listCalls, openCalls } = createHarness()
  const sender = new FakeWebContents()
  registerIdentity(sender, { kind: "launcher" })

  await assert.rejects(ipcMain.invoke("openTargets:list", sender, { folderPath: " " }))
  await assert.rejects(
    ipcMain.invoke("openTargets:list", sender, { folderPath: "/work", unexpected: true })
  )
  await assert.rejects(
    ipcMain.invoke("openTargets:open", sender, { folderPath: "/work", targetId: " " })
  )
  await assert.rejects(
    ipcMain.invoke("openTargets:open", sender, {
      filePath: "file.txt",
      folderPath: "/work",
      targetId: "finder",
      unexpected: true
    })
  )
  assert.deepEqual(listCalls, [])
  assert.deepEqual(openCalls, [])

  const invalidResponseHarness = createHarness({ invalidListResponse: true })
  const invalidResponseSender = new FakeWebContents()
  registerIdentity(invalidResponseSender, { kind: "launcher" })
  await assert.rejects(
    invalidResponseHarness.ipcMain.invoke("openTargets:list", invalidResponseSender, {
      folderPath: "/work"
    })
  )
  assert.deepEqual(invalidResponseHarness.listCalls, [{ folderPath: "/work" }])
})
