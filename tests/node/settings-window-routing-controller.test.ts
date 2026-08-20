import assert from "node:assert/strict"
import test from "node:test"
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import { SettingsWindowRoutingController } from "../../src/main/settings-window-routing/controller"
import { SettingsWindowNavigationDeliveryOwner } from "../../src/main/settings-window-routing/navigation-delivery"
import { SettingsWindowRoutingService } from "../../src/main/settings-window-routing/service"
import { registerWindowIdentity, type WindowIdentity } from "../../src/main/windows/window-identity"
import {
  createSettingsWindowNavigationAcknowledgement,
  type SettingsWindowNavigationDelivery,
  type SettingsWindowNavigationPayload
} from "../../src/shared/settings-window"

class FakeIpcMain {
  readonly handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()

  handle(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void {
    this.handlers.set(channel, handler)
  }

  async invoke(channel: string, sender: FakeWebContents, ...args: unknown[]): Promise<unknown> {
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

class FakeOwnerWindow {
  hideCount = 0

  hide(): void {
    this.hideCount += 1
  }
}

class FakeWebContents {
  readonly mainFrame = {}

  constructor(readonly ownerWindow = new FakeOwnerWindow()) {}

  getURL(): string {
    throw new Error("Settings window routing must not authorize a sender from its URL.")
  }

  isDestroyed(): boolean {
    return false
  }
}

function registerIdentity(sender: FakeWebContents, identity: WindowIdentity): void {
  registerWindowIdentity(sender as unknown as WebContents, identity)
}

function createHarness(pendingNavigation: SettingsWindowNavigationDelivery | null = null) {
  const opened: Array<SettingsWindowNavigationPayload | undefined> = []
  const acknowledged: Array<
    Pick<SettingsWindowNavigationDelivery, "rendererLoadEpoch" | "revision">
  > = []
  const service = new SettingsWindowRoutingService({
    acknowledgeNavigation: (revision) => acknowledged.push(revision),
    claimPendingNavigation: () => pendingNavigation,
    openSettingsWindow: (payload) => opened.push(payload)
  })
  const controller = new SettingsWindowRoutingController(service, (sender) => {
    return (sender as unknown as FakeWebContents).ownerWindow as unknown as BrowserWindow
  })
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)
  return { acknowledged, ipcMain, opened }
}

test("settings routing admits a registered Launcher main frame without reading its URL", async () => {
  const { ipcMain, opened } = createHarness()
  const sender = new FakeWebContents()
  registerIdentity(sender, { kind: "launcher" })

  await ipcMain.invoke("settings:openWindow", sender)
  await ipcMain.invoke("settings:openTab", sender, { tab: "appearance" })

  assert.deepEqual(opened, [undefined, { tab: "appearance" }])
  assert.equal(sender.ownerWindow.hideCount, 2)
})

test("settings routing admits durable windows without hiding them", async () => {
  const { ipcMain, opened } = createHarness()
  const mainSender = new FakeWebContents()
  registerIdentity(mainSender, {
    kind: "main",
    threadId: null,
    windowId: "primary-main"
  })
  const threadSender = new FakeWebContents()
  registerIdentity(threadSender, {
    kind: "thread-window",
    threadId: "thread-a",
    windowId: "thread-window-a"
  })

  await ipcMain.invoke("settings:openWindow", mainSender)
  await ipcMain.invoke("settings:openTab", threadSender, { tab: "provider" })

  assert.deepEqual(opened, [undefined, { tab: "provider" }])
  assert.equal(mainSender.ownerWindow.hideCount, 0)
  assert.equal(threadSender.ownerWindow.hideCount, 0)
})

test("settings routing rejects unowned identities and subframes before side effects", async () => {
  const { ipcMain, opened } = createHarness()
  for (const identity of [{ kind: "settings" }, { kind: "ipc-network" }] as const) {
    const sender = new FakeWebContents()
    registerIdentity(sender, identity)
    await assert.rejects(
      ipcMain.invoke("settings:openWindow", sender),
      /Settings can only be opened by the Launcher or a durable window/
    )
    assert.equal(sender.ownerWindow.hideCount, 0)
  }

  const unregisteredSender = new FakeWebContents()
  await assert.rejects(
    ipcMain.invoke("settings:openWindow", unregisteredSender),
    /Settings can only be opened by the Launcher or a durable window/
  )

  const launcherSender = new FakeWebContents()
  registerIdentity(launcherSender, { kind: "launcher" })
  await assert.rejects(
    ipcMain.invokeFromFrame("settings:openWindow", launcherSender, {}),
    /Settings can only be opened by the Launcher or a durable window/
  )

  assert.deepEqual(opened, [])
  assert.equal(unregisteredSender.ownerWindow.hideCount, 0)
  assert.equal(launcherSender.ownerWindow.hideCount, 0)
})

test("pending settings navigation is claimable only by a registered Settings main frame", async () => {
  const pendingNavigation = {
    revision: 3,
    rendererLoadEpoch: 5,
    payload: { tab: "shortcuts" }
  } as const
  const { acknowledged, ipcMain } = createHarness(pendingNavigation)
  const settingsSender = new FakeWebContents()
  registerIdentity(settingsSender, { kind: "settings" })
  assert.deepEqual(
    await ipcMain.invoke("settings:getPendingNavigation", settingsSender),
    pendingNavigation
  )

  const launcherSender = new FakeWebContents()
  registerIdentity(launcherSender, { kind: "launcher" })
  await assert.rejects(
    ipcMain.invoke("settings:getPendingNavigation", launcherSender),
    /Pending settings navigation can only be claimed by the Settings window/
  )
  await assert.rejects(
    ipcMain.invokeFromFrame("settings:getPendingNavigation", settingsSender, {}),
    /Pending settings navigation can only be claimed by the Settings window/
  )

  await ipcMain.invoke("settings:acknowledgeNavigation", settingsSender, {
    revision: 3,
    rendererLoadEpoch: 5
  })
  assert.deepEqual(acknowledged, [{ revision: 3, rendererLoadEpoch: 5 }])
  await assert.rejects(
    ipcMain.invoke("settings:acknowledgeNavigation", launcherSender, {
      revision: 3,
      rendererLoadEpoch: 5
    }),
    /Pending settings navigation can only be claimed by the Settings window/
  )
})

test("navigation remains claimable across a renderer reload until the applied revision is acknowledged", () => {
  const owner = new SettingsWindowNavigationDeliveryOwner()

  owner.beginRendererLoad()
  assert.equal(owner.claimPending(), null)
  const directDelivery = owner.publish({ tab: "appearance" })
  assert.deepEqual(directDelivery, {
    revision: 1,
    rendererLoadEpoch: 1,
    payload: { tab: "appearance" }
  })

  // reload() can begin before Electron emits did-start-loading. The direct IPC
  // may therefore target the renderer being replaced, but the durable owner
  // must retain the same delivery for the successor renderer to claim.
  owner.beginRendererLoad()
  const successorDelivery = owner.claimPending()
  assert.deepEqual(successorDelivery, {
    ...directDelivery,
    rendererLoadEpoch: 2
  })

  owner.acknowledge(directDelivery)
  assert.deepEqual(owner.claimPending(), successorDelivery)

  assert.ok(successorDelivery)
  owner.acknowledge(successorDelivery)
  owner.beginRendererLoad()
  assert.equal(owner.claimPending(), null)
})

test("a stale renderer acknowledgement cannot clear a newer settings navigation", () => {
  const owner = new SettingsWindowNavigationDeliveryOwner()
  owner.beginRendererLoad()
  owner.claimPending()

  const first = owner.publish({ tab: "appearance" })
  const second = owner.publish({ tab: "shortcuts" })
  assert.ok(first)
  assert.ok(second)

  owner.acknowledge(first)
  owner.beginRendererLoad()
  assert.deepEqual(owner.claimPending(), {
    ...second,
    rendererLoadEpoch: 2
  })
})

test("a full renderer delivery is reduced to the strict acknowledgement protocol", () => {
  assert.deepEqual(
    createSettingsWindowNavigationAcknowledgement({
      revision: 9,
      rendererLoadEpoch: 4,
      payload: { tab: "appearance" }
    }),
    {
      revision: 9,
      rendererLoadEpoch: 4
    }
  )
})

test("the Settings main-frame acknowledgement clears the exact pending delivery", async () => {
  const owner = new SettingsWindowNavigationDeliveryOwner()
  owner.beginRendererLoad()
  owner.claimPending()
  const delivery = owner.publish({ tab: "appearance" })
  assert.ok(delivery)

  const service = new SettingsWindowRoutingService({
    acknowledgeNavigation: (acknowledgement) => owner.acknowledge(acknowledgement),
    claimPendingNavigation: () => owner.claimPending(),
    openSettingsWindow: () => undefined
  })
  const controller = new SettingsWindowRoutingController(service)
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)
  const settingsSender = new FakeWebContents()
  registerIdentity(settingsSender, { kind: "settings" })

  await ipcMain.invoke(
    "settings:acknowledgeNavigation",
    settingsSender,
    createSettingsWindowNavigationAcknowledgement(delivery)
  )

  owner.beginRendererLoad()
  assert.equal(owner.claimPending(), null)
})
