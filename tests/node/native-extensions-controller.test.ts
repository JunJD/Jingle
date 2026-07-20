import assert from "node:assert/strict"
import test from "node:test"
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import { NativeExtensionsController } from "../../src/main/native-extensions/controller"
import type { NativeExtensionsService } from "../../src/main/native-extensions/service"
import { registerWindowIdentity, type WindowIdentity } from "../../src/main/windows/window-identity"
import type { NativeExtensionInstallDiagnostic } from "../../src/shared/native-extensions"

class FakeIpcMain {
  readonly handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()

  handle(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void {
    this.handlers.set(channel, handler)
  }

  invoke(channel: string, sender: FakeWebContents): Promise<unknown> {
    return this.invokeFromFrame(channel, sender, sender.mainFrame)
  }

  async invokeFromFrame(
    channel: string,
    sender: FakeWebContents,
    senderFrame: object
  ): Promise<unknown> {
    const handler = this.handlers.get(channel)
    assert.ok(handler, `Missing IPC handler for ${channel}`)
    return handler({ sender, senderFrame } as unknown as IpcMainInvokeEvent)
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

const diagnostics: NativeExtensionInstallDiagnostic[] = [
  {
    errors: [{ code: "descriptor_missing", message: "The descriptor is missing." }],
    extensionName: "sample",
    status: "error",
    version: null
  }
]

function createHarness(): FakeIpcMain {
  const service = {
    listInstallDiagnostics: () => diagnostics
  } as unknown as NativeExtensionsService
  const controller = new NativeExtensionsController(service)
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)
  return ipcMain
}

test("install diagnostics are available only to the Settings main frame", async () => {
  const ipcMain = createHarness()
  const settings = new FakeWebContents()
  registerIdentity(settings, { kind: "settings" })

  assert.deepEqual(
    await ipcMain.invoke("nativeExtensions:listInstallDiagnostics", settings),
    diagnostics
  )

  for (const identity of [{ kind: "launcher" }, { kind: "ipc-network" }] as const) {
    const sender = new FakeWebContents()
    registerIdentity(sender, identity)
    await assert.rejects(
      ipcMain.invoke("nativeExtensions:listInstallDiagnostics", sender),
      /available only to the Settings window/
    )
  }

  await assert.rejects(
    ipcMain.invokeFromFrame("nativeExtensions:listInstallDiagnostics", settings, {}),
    /available only to the Settings window/
  )
  await assert.rejects(
    ipcMain.invoke("nativeExtensions:listInstallDiagnostics", new FakeWebContents()),
    /available only to the Settings window/
  )
})
