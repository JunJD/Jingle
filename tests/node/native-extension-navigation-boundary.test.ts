import assert from "node:assert/strict"
import test from "node:test"
import { createNativeExtensionNavigationBridge } from "../../src/shared/native-extension-boundaries"

interface TestCommandAddress {
  commandName: string
  extensionName: string
  kind: "extension-command"
}

function createAddress(): TestCommandAddress {
  return {
    commandName: "index",
    extensionName: "todo-list",
    kind: "extension-command"
  }
}

test("createNativeExtensionNavigationBridge passes launcher navigation actions through", async () => {
  let goHomeCalls = 0
  let hideCalls = 0
  let openCommandAddress: TestCommandAddress | null = null

  const navigation = createNativeExtensionNavigationBridge<TestCommandAddress, (address: TestCommandAddress) => void>({
    commandName: "index",
    extensionName: "todo-list",
    navigation: {
      goHome: () => {
        goHomeCalls += 1
      },
      hideLauncher: async () => {
        hideCalls += 1
      },
      openCommand: (address) => {
        openCommandAddress = address
      }
    },
    stack: null
  })

  navigation.goHome()
  await navigation.hideLauncher()
  navigation.openCommand(createAddress())

  assert.equal(goHomeCalls, 1)
  assert.equal(hideCalls, 1)
  assert.deepEqual(openCommandAddress, createAddress())
  assert.equal(navigation.canPop, false)
})

test("createNativeExtensionNavigationBridge fails fast for stack actions without a view stack", () => {
  const navigation = createNativeExtensionNavigationBridge<string>({
    commandName: "index",
    extensionName: "todo-list",
    navigation: {
      goHome: () => {},
      hideLauncher: async () => {},
      openCommand: () => {}
    },
    stack: null
  })

  assert.throws(
    () => navigation.pop(),
    /cannot use navigation stack actions outside a view command/
  )
  assert.throws(
    () => navigation.push("detail"),
    /cannot use navigation stack actions outside a view command/
  )
})

test("createNativeExtensionNavigationBridge delegates push/pop when a view stack is present", () => {
  let popCalls = 0
  const pushedViews: unknown[] = []

  const navigation = createNativeExtensionNavigationBridge({
    commandName: "index",
    extensionName: "todo-list",
    navigation: {
      goHome: () => {},
      hideLauncher: async () => {},
      openCommand: () => {}
    },
    stack: {
      canPop: true,
      pop: () => {
        popCalls += 1
      },
      push: (view) => {
        pushedViews.push(view)
      }
    }
  })

  navigation.pop()
  navigation.push("detail-view")

  assert.equal(navigation.canPop, true)
  assert.equal(popCalls, 1)
  assert.deepEqual(pushedViews, ["detail-view"])
})
