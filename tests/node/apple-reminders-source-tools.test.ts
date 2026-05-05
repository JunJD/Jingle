import assert from "node:assert/strict"
import test, { mock } from "node:test"
import { createExtensionSourceRuntime } from "../../src/main/agent/extension-source-runtime"
import { ExtensionToolExecutor } from "../../src/main/extension-tools/executor"
import { ExtensionToolRegistry } from "../../src/main/extension-tools/registry"
import { createAppleRemindersTools } from "../../src/extensions/apple-reminders/main/tools"
import {
  appleRemindersSourceDefinition,
  createDefaultAppleRemindersSourceBinding,
  createDefaultAppleRemindersSourceProfile
} from "../../src/extensions/apple-reminders/main/source"
import { hydrateNativeExtensionSourceBindings } from "../../src/extensions/sources"

const createdAt = "2026-04-30T00:00:00.000Z"

const fakeReminder = {
  completionDate: null,
  creationDate: "2026-04-30T00:00:00.000Z",
  dueDate: null,
  id: "reminder-1",
  isCompleted: false,
  list: {
    color: "#ff0000",
    id: "list-1",
    isDefault: true,
    title: "Reminders"
  },
  notes: "",
  openUrl: "x-apple-reminderkit://REMCDReminder/reminder-1",
  priority: null,
  title: "Ship source tools"
} as const

function createRegistry(): ExtensionToolRegistry {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["apple-reminders"]
  })
  registry.registerExtensionTools(
    "apple-reminders",
    createAppleRemindersTools({
      createReminder: async (input) => ({
        ...fakeReminder,
        notes: input.notes ?? "",
        priority: input.priority ?? null,
        title: input.title
      }),
      getData: async () => ({
        lists: [fakeReminder.list],
        reminders: [
          fakeReminder,
          {
            ...fakeReminder,
            id: "reminder-2",
            isCompleted: true,
            title: "Completed item"
          }
        ]
      })
    })
  )
  return registry
}

test("default Apple Reminders source profile is enabled only on macOS", () => {
  assert.equal(
    createDefaultAppleRemindersSourceProfile({
      now: createdAt,
      platform: "darwin"
    }).enabled,
    true
  )
  assert.equal(
    createDefaultAppleRemindersSourceProfile({
      now: createdAt,
      platform: "linux"
    }).authStatus,
    "missing"
  )
})

test("stored Apple Reminders source profiles hydrate back into runtime bindings", () => {
  const profile = createDefaultAppleRemindersSourceProfile({
    now: createdAt,
    platform: "darwin"
  })

  const [binding] = hydrateNativeExtensionSourceBindings([profile])
  assert.equal(binding.profile.id, profile.id)
  assert.equal(binding.source.id, appleRemindersSourceDefinition.id)
  assert.equal(binding.source.extensionName, "apple-reminders")
})

test("stored native source profiles skip definitions that are no longer registered", () => {
  const consoleWarn = mock.method(console, "warn", () => {})
  try {
    const profile = {
      ...createDefaultAppleRemindersSourceProfile({
        now: createdAt,
        platform: "darwin"
      }),
      sourceId: "removedSource"
    }

    assert.deepEqual(hydrateNativeExtensionSourceBindings([profile]), [])
  } finally {
    consoleWarn.mock.restore()
  }
})

test("Apple Reminders source exposes read tools and protects write tools with Permission Mode", async () => {
  const runtime = createExtensionSourceRuntime({
    registry: createRegistry(),
    sourceBindings: [
      createDefaultAppleRemindersSourceBinding({
        now: createdAt,
        platform: "darwin"
      })
    ],
    threadId: "thread-1",
    workspacePath: "/workspace"
  })

  assert.deepEqual(
    runtime.sourceToolBindings.map((binding) => binding.agentToolName),
    ["ext__appleReminders__listReminders", "ext__appleReminders__createReminder"]
  )
  assert.equal(
    runtime.approvalPolicyProvider.getPolicy("ext__appleReminders__listReminders")?.decision
      .disposition,
    "allow"
  )
  assert.equal(
    runtime.approvalPolicyProvider.getPolicy("ext__appleReminders__createReminder")?.decision
      .disposition,
    "require_approval"
  )
})

test("Apple Reminders tools validate input and call main-side services", async () => {
  const sourceBinding = createDefaultAppleRemindersSourceBinding({
    now: createdAt,
    platform: "darwin"
  })
  const [listBinding, createBinding] = createRegistry().createSourceToolBindings([sourceBinding])
  const executor = new ExtensionToolExecutor({
    bindings: [listBinding, createBinding]
  })

  const listOutput = await executor.executeAgentTool({
    agentToolName: "ext__appleReminders__listReminders",
    args: {},
    threadId: "thread-1",
    workspacePath: "/workspace"
  })
  assert.match(listOutput, /Ship source tools/)
  assert.doesNotMatch(listOutput, /Completed item/)

  const createOutput = await executor.executeAgentTool({
    agentToolName: "ext__appleReminders__createReminder",
    args: {
      notes: "From agent",
      priority: "high",
      title: "Create through source"
    },
    threadId: "thread-1",
    workspacePath: "/workspace"
  })
  assert.match(createOutput, /Create through source/)
  assert.match(createOutput, /From agent/)

  assert.equal(appleRemindersSourceDefinition.id, "appleReminders")
  await assert.rejects(
    executor.executeAgentTool({
      agentToolName: "ext__appleReminders__createReminder",
      args: {
        title: ""
      },
      threadId: "thread-1",
      workspacePath: "/workspace"
    }),
    /input validation failed/i
  )
})
