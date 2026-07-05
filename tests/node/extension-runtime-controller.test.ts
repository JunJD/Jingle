import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import type { IpcMain, IpcMainInvokeEvent } from "electron"
import { ExtensionRuntimeController } from "../../src/main/services/extension-runtime/controller"
import type { ExtensionRuntimeRendererBridge } from "../../src/main/services/extension-runtime/renderer-bridge"
import type { ExtensionRuntimeManager } from "../../src/main/services/extension-runtime/runtime-manager"

class FakeIpcMain {
  readonly handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()

  handle(channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, handler)
  }

  invoke(channel: string, sender: FakeWebContents, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel)
    assert.ok(handler, `Missing IPC handler for ${channel}`)
    return Promise.resolve(handler({ sender } as unknown as IpcMainInvokeEvent, ...args))
  }
}

class FakeWebContents extends EventEmitter {
  destroyed = false

  constructor(readonly id: number) {
    super()
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  send(): void {
    return undefined
  }
}

function createRuntimeManagerStub(): ExtensionRuntimeManager {
  return {
    onError: () => undefined,
    onEventAck: () => undefined,
    onSurface: () => undefined
  } as unknown as ExtensionRuntimeManager
}

test("extension runtime surface subscription does not accumulate destroyed listeners", async () => {
  const controller = new ExtensionRuntimeController(
    createRuntimeManagerStub(),
    {} as ExtensionRuntimeRendererBridge
  )
  const ipcMain = new FakeIpcMain()
  const sender = new FakeWebContents(1)

  controller.register(ipcMain as unknown as IpcMain)

  for (let index = 0; index < 20; index += 1) {
    await ipcMain.invoke("extensionRuntime:subscribeSurfaces", sender)
  }

  assert.equal(sender.listenerCount("destroyed"), 1)

  await ipcMain.invoke("extensionRuntime:unsubscribeSurfaces", sender)
  assert.equal(sender.listenerCount("destroyed"), 0)
})
