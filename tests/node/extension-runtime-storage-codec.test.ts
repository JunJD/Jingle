import assert from "node:assert/strict"
import test from "node:test"
import {
  discardQuarantinedLegacyRuntimeStorageValue,
  encodeRuntimeStorageKey,
  migrateLegacyRuntimeStorageValues,
  readRuntimeStorageItemKey
} from "../../src/main/services/extension-runtime/storage-codec"

const identity = {
  connectionId: "workspace",
  credentialGeneration: 3
}

const commandAddress = {
  commandName: "search-page",
  extensionName: "notion",
  identity,
  key: "recentPage",
  scope: "command" as const
}

const extensionAddress = {
  commandName: "search-page",
  extensionName: "notion",
  identity,
  key: "recentPage",
  scope: "extension" as const
}

test("runtime storage codec keeps command and extension scopes isolated", () => {
  const commandKey = encodeRuntimeStorageKey(commandAddress)
  const extensionKey = encodeRuntimeStorageKey(extensionAddress)

  assert.equal(commandKey, JSON.stringify(["notion", "workspace", 3, "search-page", "recentPage"]))
  assert.equal(extensionKey, JSON.stringify(["notion", "workspace", 3, "recentPage"]))
  assert.equal(
    readRuntimeStorageItemKey(commandKey, {
      commandName: "search-page",
      extensionName: "notion",
      identity,
      scope: "command"
    }),
    "recentPage"
  )
  assert.equal(
    readRuntimeStorageItemKey(commandKey, {
      commandName: "search-page",
      extensionName: "notion",
      identity,
      scope: "extension"
    }),
    null
  )
  assert.equal(
    readRuntimeStorageItemKey(extensionKey, {
      commandName: "search-page",
      extensionName: "notion",
      identity,
      scope: "extension"
    }),
    "recentPage"
  )
  assert.equal(
    readRuntimeStorageItemKey(extensionKey, {
      commandName: "search-page",
      extensionName: "notion",
      identity,
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
      identity,
      scope: "command"
    }),
    null
  )
  assert.equal(
    readRuntimeStorageItemKey(extensionKey, {
      commandName: "search-page",
      extensionName: "github",
      identity,
      scope: "extension"
    }),
    null
  )
  assert.equal(
    readRuntimeStorageItemKey("not-json", {
      commandName: "search-page",
      extensionName: "notion",
      identity,
      scope: "extension"
    }),
    null
  )
  assert.equal(
    readRuntimeStorageItemKey(JSON.stringify(["notion", 42]), {
      commandName: "search-page",
      extensionName: "notion",
      identity,
      scope: "extension"
    }),
    null
  )
})

test("runtime storage codec isolates connection and credential generations", () => {
  const key = encodeRuntimeStorageKey(extensionAddress)

  assert.equal(
    readRuntimeStorageItemKey(key, {
      commandName: "search-page",
      extensionName: "notion",
      identity: { ...identity, credentialGeneration: 4 },
      scope: "extension"
    }),
    null
  )
  assert.equal(
    readRuntimeStorageItemKey(key, {
      commandName: "search-page",
      extensionName: "notion",
      identity: { ...identity, connectionId: "personal" },
      scope: "extension"
    }),
    null
  )
})

test("runtime storage quarantines legacy entries without assigning a connection", () => {
  const legacyKey = JSON.stringify(["notion", "recentPage"])
  const unrelatedKey = JSON.stringify(["github", "recentPage"])
  const migrated = migrateLegacyRuntimeStorageValues(
    {
      [legacyKey]: "page-1",
      [unrelatedKey]: "issue-1"
    },
    {
      commandName: "search-page",
      extensionName: "notion",
      identity: { connectionId: "workspace", credentialGeneration: 0 },
      scope: "extension"
    }
  )

  assert.equal(migrated.changed, true)
  assert.deepEqual(migrated.quarantinedKeys, ["recentPage"])
  assert.deepEqual(migrated.values, {
    [JSON.stringify(["jingle:legacy-unowned:v1", "notion", "extension", "recentPage"])]: "page-1",
    [unrelatedKey]: "issue-1"
  })
})

test("runtime storage keeps quarantine blocked until explicit discard", () => {
  const values = {
    [JSON.stringify(["notion", "recentPage"])]: "legacy-page"
  }
  const address = {
    commandName: "search-page",
    extensionName: "notion",
    identity: { connectionId: "workspace", credentialGeneration: 2 },
    scope: "extension" as const
  }

  const quarantined = migrateLegacyRuntimeStorageValues(values, address)
  assert.deepEqual(values, {
    [JSON.stringify(["notion", "recentPage"])]: "legacy-page"
  })
  assert.deepEqual(quarantined.quarantinedKeys, ["recentPage"])
  assert.deepEqual(migrateLegacyRuntimeStorageValues(quarantined.values, address), {
    changed: false,
    quarantinedKeys: ["recentPage"],
    values: quarantined.values
  })
  assert.deepEqual(
    migrateLegacyRuntimeStorageValues(quarantined.values, address, {
      discardBlockedLegacy: true
    }),
    { changed: true, quarantinedKeys: [], values: {} }
  )
})

test("runtime storage quarantine preserves an existing current-scope value", () => {
  const currentKey = encodeRuntimeStorageKey({
    commandName: "search-page",
    extensionName: "notion",
    identity: { connectionId: "workspace", credentialGeneration: 0 },
    key: "recentPage",
    scope: "extension"
  })
  const migrated = migrateLegacyRuntimeStorageValues(
    {
      [currentKey]: "current-page",
      [JSON.stringify(["notion", "recentPage"])]: "legacy-page"
    },
    {
      commandName: "search-page",
      extensionName: "notion",
      identity: { connectionId: "workspace", credentialGeneration: 0 },
      scope: "extension"
    }
  )

  assert.deepEqual(migrated.quarantinedKeys, ["recentPage"])
  assert.deepEqual(migrated.values, {
    [currentKey]: "current-page",
    [JSON.stringify(["jingle:legacy-unowned:v1", "notion", "extension", "recentPage"])]:
      "legacy-page"
  })
})

test("runtime storage discards only one quarantined logical key", () => {
  const address = {
    commandName: "search-page",
    extensionName: "notion",
    identity: { connectionId: "workspace", credentialGeneration: 0 },
    scope: "extension" as const
  }
  const migrated = migrateLegacyRuntimeStorageValues(
    {
      [JSON.stringify(["notion", "filter"])]: "legacy-filter",
      [JSON.stringify(["notion", "recentPage"])]: "legacy-page"
    },
    address
  )

  assert.deepEqual(
    discardQuarantinedLegacyRuntimeStorageValue(migrated.values, address, "recentPage"),
    {
      [JSON.stringify(["jingle:legacy-unowned:v1", "notion", "extension", "filter"])]:
        "legacy-filter"
    }
  )
})
