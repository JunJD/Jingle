import assert from "node:assert/strict"
import test from "node:test"
import {
  encodeRuntimeStorageKey,
  readRuntimeStorageItemKey
} from "../../src/main/services/extension-runtime/storage-codec"

const commandAddress = {
  commandName: "search-page",
  extensionName: "notion",
  key: "recentPage",
  scope: "command" as const
}

const extensionAddress = {
  commandName: "search-page",
  extensionName: "notion",
  key: "recentPage",
  scope: "extension" as const
}

test("runtime storage codec keeps command and extension scopes isolated", () => {
  const commandKey = encodeRuntimeStorageKey(commandAddress)
  const extensionKey = encodeRuntimeStorageKey(extensionAddress)

  assert.equal(commandKey, JSON.stringify(["notion", "search-page", "recentPage"]))
  assert.equal(extensionKey, JSON.stringify(["notion", "recentPage"]))
  assert.equal(
    readRuntimeStorageItemKey(commandKey, {
      commandName: "search-page",
      extensionName: "notion",
      scope: "command"
    }),
    "recentPage"
  )
  assert.equal(
    readRuntimeStorageItemKey(commandKey, {
      commandName: "search-page",
      extensionName: "notion",
      scope: "extension"
    }),
    null
  )
  assert.equal(
    readRuntimeStorageItemKey(extensionKey, {
      commandName: "search-page",
      extensionName: "notion",
      scope: "extension"
    }),
    "recentPage"
  )
  assert.equal(
    readRuntimeStorageItemKey(extensionKey, {
      commandName: "search-page",
      extensionName: "notion",
      scope: "command"
    }),
    null
  )
})

test("runtime storage codec filters other commands, extensions, and invalid keys", () => {
  const commandKey = encodeRuntimeStorageKey(commandAddress)
  const extensionKey = encodeRuntimeStorageKey(extensionAddress)

  assert.equal(
    readRuntimeStorageItemKey(commandKey, {
      commandName: "add-text-to-page",
      extensionName: "notion",
      scope: "command"
    }),
    null
  )
  assert.equal(
    readRuntimeStorageItemKey(extensionKey, {
      commandName: "search-page",
      extensionName: "github",
      scope: "extension"
    }),
    null
  )
  assert.equal(
    readRuntimeStorageItemKey("not-json", {
      commandName: "search-page",
      extensionName: "notion",
      scope: "extension"
    }),
    null
  )
  assert.equal(
    readRuntimeStorageItemKey(JSON.stringify(["notion", 42]), {
      commandName: "search-page",
      extensionName: "notion",
      scope: "extension"
    }),
    null
  )
})
