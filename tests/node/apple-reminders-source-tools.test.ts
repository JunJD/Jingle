import assert from "node:assert/strict"
import test, { mock } from "node:test"
import { createExtensionSourceRuntime } from "../../src/main/agent/extension-source-runtime"
import { ExtensionToolExecutor } from "../../src/main/extension-tools/executor"
import { ExtensionToolRegistry } from "../../src/main/extension-tools/registry"
import {
  AppleRemindersRequestError,
  normalizeAppleRemindersError
} from "../../src/extensions/apple-reminders/main/service"
import { createAppleRemindersTools } from "../../src/extensions/apple-reminders/main/tools"
import {
  appleRemindersSourceDefinition,
  createDefaultAppleRemindersSourceBinding,
  createDefaultAppleRemindersSourceProfile
} from "../../src/extensions/apple-reminders/main/source"
import {
  createNativeExtensionSourceBindingsForRefs,
  hydrateNativeExtensionSourceBindings
} from "../../src/extensions/sources"
import {
  listNativeExtensionSourceMentions,
  nativeExtensionSourceMentions
} from "../../src/extensions/source-mentions"

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

test("Apple Reminders source binding is loaded only from an explicit extension source ref", () => {
  assert.deepEqual(createNativeExtensionSourceBindingsForRefs([]), [])
  assert.deepEqual(nativeExtensionSourceMentions, [
    {
      extensionName: "apple-reminders",
      iconName: "reminders",
      label: "Apple Reminders",
      sourceId: "appleReminders",
      supportedPlatforms: ["darwin"],
      value: "apple-reminders"
    }
  ])
  assert.deepEqual(
    listNativeExtensionSourceMentions("darwin").map((mention) => mention.sourceId),
    ["appleReminders"]
  )
  assert.deepEqual(listNativeExtensionSourceMentions("linux"), [])

  const bindings = createNativeExtensionSourceBindingsForRefs(
    [
      {
        extensionName: "apple-reminders",
        name: "Apple Reminders",
        sourceId: "appleReminders",
        type: "extension-source"
      }
    ],
    {
      now: createdAt,
      platform: "darwin"
    }
  )

  assert.equal(bindings.length, 1)
  assert.equal(bindings[0]?.source.id, appleRemindersSourceDefinition.id)
  assert.equal(bindings[0]?.source.guide, appleRemindersSourceDefinition.guide)
})

test("unknown extension source refs are ignored", () => {
  const consoleWarn = mock.method(console, "warn", () => {})
  try {
    assert.deepEqual(
      createNativeExtensionSourceBindingsForRefs([
        {
          extensionName: "unknown",
          name: "Unknown",
          sourceId: "unknown",
          type: "extension-source"
        }
      ]),
      []
    )
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

test("Apple Reminders tools return external Reminders failures as tool output", async () => {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: ["apple-reminders"]
  })
  registry.registerExtensionTools(
    "apple-reminders",
    createAppleRemindersTools({
      createReminder: async () => {
        throw new AppleRemindersRequestError(
          "Openwork needs permission to access Reminders.",
          "PERMISSION_DENIED"
        )
      },
      getData: async () => {
        throw new AppleRemindersRequestError(
          "Openwork needs permission to access Reminders.",
          "PERMISSION_DENIED"
        )
      }
    })
  )
  const sourceBinding = createDefaultAppleRemindersSourceBinding({
    now: createdAt,
    platform: "darwin"
  })
  const [listBinding, createBinding] = registry.createSourceToolBindings([sourceBinding])
  const executor = new ExtensionToolExecutor({
    bindings: [listBinding, createBinding]
  })

  const listOutput = await executor.executeAgentTool({
    agentToolName: "ext__appleReminders__listReminders",
    args: {},
    threadId: "thread-1",
    workspacePath: "/workspace"
  })
  assert.match(listOutput, /Apple Reminders list reminders failed/)
  assert.match(listOutput, /permission to access Reminders/)

  const createOutput = await executor.executeAgentTool({
    agentToolName: "ext__appleReminders__createReminder",
    args: {
      title: "Create through source"
    },
    threadId: "thread-1",
    workspacePath: "/workspace"
  })
  assert.match(createOutput, /Apple Reminders create reminder failed/)
  assert.match(createOutput, /permission to access Reminders/)
})

test("Apple Reminders helper access denial maps to permission errors", () => {
  const normalized = normalizeAppleRemindersError({
    stderr: "OpenworkRemindersAccessDenied",
    stdout: ""
  })

  assert.equal(
    normalized.message,
    "Openwork needs permission to access Reminders. Grant Reminders access in System Settings and try again."
  )
  assert.equal(normalized.code, "PERMISSION_DENIED")
})

test("Apple Reminders helper timeout asks for Reminders access", () => {
  const normalized = normalizeAppleRemindersError({
    code: "ETIMEDOUT",
    killed: true,
    stderr: "",
    stdout: ""
  })

  assert.equal(
    normalized.message,
    "Timed out while talking to Reminders. Grant Reminders access if macOS is showing a permission prompt, then try again."
  )
})

test("Apple Reminders unknown helper methods stay user-facing", () => {
  const normalized = normalizeAppleRemindersError({
    stderr: "OpenworkUnsupportedMethod: get-data",
    stdout: ""
  })

  assert.equal(
    normalized.message,
    "Openwork could not complete the Reminders request. Restart Openwork and try again."
  )
})
