import assert from "node:assert/strict"
import test from "node:test"
import {
  createExtensionRuntimeNavigation,
  runWithExtensionRuntimeSdk,
  type ExtensionRuntimeHostRequestInput
} from "@openwork/extension-api/host-runtime"
import AppleRemindersQuickAddReminder from "../../extensions/apple-reminders/src/quick-add-reminder"
import type {
  AppleReminder,
  AppleRemindersData
} from "../../extensions/apple-reminders/src/contracts"
import type {
  ExtensionHostResponse,
  ExtensionRuntimeLaunchContext
} from "../../src/shared/extension-runtime-protocol"

test("Apple Reminders runtime quick-add opens create reminder when the seed query is empty", async () => {
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const navigationResponse = createDeferred<ExtensionHostResponse>()
  let quickAddResolved = false
  const navigation = createExtensionRuntimeNavigation({
    requestHost: async (request) => {
      hostRequests.push(request)
      return navigationResponse.promise
    }
  })

  const quickAddPromise = AppleRemindersQuickAddReminder({
    navigation,
    seedQuery: "   "
  }).then(() => {
    quickAddResolved = true
  })
  await flushPromises()

  assert.equal(hostRequests.length, 1)
  assert.deepEqual(hostRequests[0], {
    capability: "navigation",
    method: "open-command",
    payload: {
      commandName: "create-reminder",
      extensionName: "apple-reminders"
    }
  })
  assert.equal(quickAddResolved, false)

  navigationResponse.resolve(createHostResponse(null))
  await quickAddPromise
  assert.equal(quickAddResolved, true)
})

test("Apple Reminders runtime quick-add creates a parsed reminder through runtime RPC", async () => {
  const rpcCalls: Array<{ method: string; payload: unknown }> = []
  const navigation = createExtensionRuntimeNavigation({
    requestHost: async (request) => resolveRuntimeRequest(request, rpcCalls)
  })
  const seedQuery = "Buy milk today #Inbox urgent!"

  await runWithExtensionRuntimeSdk(
    {
      ...createLaunchContext(seedQuery),
      navigation,
      requestHost: async (request) => resolveRuntimeRequest(request, rpcCalls)
    },
    () =>
      AppleRemindersQuickAddReminder({
        navigation,
        seedQuery
      })
  )

  assert.deepEqual(rpcCalls, [
    {
      method: "get-data",
      payload: {}
    },
    {
      method: "create-reminder",
      payload: {
        dueDate: todayDateOnly(),
        listId: "inbox-list",
        priority: "high",
        title: "Buy milk"
      }
    }
  ])
})

function createLaunchContext(seedQuery: string): ExtensionRuntimeLaunchContext {
  return {
    commandName: "quick-add-reminder",
    commandPreferences: {},
    extensionName: "apple-reminders",
    extensionPreferences: {},
    initialAction: "submit",
    locale: "zh-CN",
    mode: "no-view",
    seedQuery
  }
}

async function resolveRuntimeRequest(
  request: ExtensionRuntimeHostRequestInput,
  rpcCalls: Array<{ method: string; payload: unknown }>
): Promise<ExtensionHostResponse> {
  if (request.capability !== "rpc") {
    return createHostResponse(null)
  }

  rpcCalls.push({
    method: request.payload.method,
    payload: request.payload.payload
  })

  if (request.payload.method === "get-data") {
    return createHostResponse(createAppleRemindersData())
  }

  return createHostResponse({
    completionDate: null,
    creationDate: null,
    dueDate: null,
    id: "created-reminder",
    isCompleted: false,
    list: null,
    notes: "",
    openUrl: "x-apple-reminderkit://created-reminder",
    priority: null,
    title: "Buy milk"
  } satisfies AppleReminder)
}

function createAppleRemindersData(): AppleRemindersData {
  return {
    lists: [
      {
        color: "blue",
        id: "inbox-list",
        isDefault: true,
        title: "Inbox"
      }
    ],
    reminders: []
  }
}

function createHostResponse(result: unknown): ExtensionHostResponse {
  return {
    id: "test-host-request",
    ok: true,
    result
  }
}

function todayDateOnly(): string {
  const value = new Date()
  value.setHours(0, 0, 0, 0)
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return {
    promise,
    resolve
  }
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}
