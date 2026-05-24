import assert from "node:assert/strict"
import test from "node:test"
import { resolveNativeExtensionCapability } from "../../src/shared/native-extension-boundaries"
import type { LauncherCommandOwnerCapability } from "../../src/shared/launcher-command-owner"

function createHost(capabilities: readonly LauncherCommandOwnerCapability[]) {
  return {
    capabilities,
    extensionName: "sample-extension"
  }
}

test("resolveNativeExtensionCapability returns value when manifest declares and host provides", () => {
  const host = createHost(["navigation"])
  const value = { goHome: () => {} }

  assert.equal(resolveNativeExtensionCapability(host, "navigation", value), value)
})

test("resolveNativeExtensionCapability fails when extension uses undeclared capability", () => {
  const host = createHost([])

  assert.throws(
    () => resolveNativeExtensionCapability(host, "navigation", undefined),
    /tried to use the "navigation" capability without declaring it/
  )
})

test("resolveNativeExtensionCapability fails when host leaks undeclared capability", () => {
  const host = createHost([])
  const leakedNavigation = { goHome: () => {} }

  assert.throws(
    () => resolveNativeExtensionCapability(host, "navigation", leakedNavigation),
    /host exposed the "navigation" capability without a manifest declaration/
  )
})

test("resolveNativeExtensionCapability fails when manifest declares but host omits value", () => {
  const host = createHost(["navigation"])

  assert.throws(
    () => resolveNativeExtensionCapability(host, "navigation", undefined),
    /declares the "navigation" capability but the host did not provide it/
  )
})
