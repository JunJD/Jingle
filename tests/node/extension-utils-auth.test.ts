import assert from "node:assert/strict"
import test from "node:test"
import {
  createExtensionRuntimeNavigation,
  getConnectionSecret,
  runWithExtensionRuntimeSdk,
  type ExtensionRuntimeSdkContextValue
} from "../../src/extension-runtime/sdk"
import { OAuthService, withAccessToken } from "../../packages/extension-utils/src"
import type { ExtensionHostResponse } from "../../src/shared/extension-runtime-protocol"

test("withAccessToken initializes OAuth-style services from Openwork preferences", async () => {
  const authorizedTokens: string[] = []
  const service = new OAuthService({
    onAuthorize: ({ token }) => {
      authorizedTokens.push(token)
    },
    personalAccessToken: "fallback_token"
  })
  const wrapped = withAccessToken(service)((input: { query: string }) => {
    return `search:${input.query}`
  })

  const result = await runWithExtensionRuntimeSdk(
    createLaunchContext({
      accessToken: "secret_token"
    }),
    () => wrapped({ query: "Runtime Notes" })
  )

  assert.equal(result, "search:Runtime Notes")
  assert.deepEqual(authorizedTokens, ["secret_token"])
})

test("withAccessToken uses legacy command-scoped access token fallback", async () => {
  const authorizedTokens: string[] = []
  const service = new OAuthService({
    onAuthorize: ({ token }) => {
      authorizedTokens.push(token)
    }
  })

  await runWithExtensionRuntimeSdk(
    createLaunchContext({}, { accessToken: "legacy_command_token" }),
    () => withAccessToken(service)(() => {})()
  )

  assert.deepEqual(authorizedTokens, ["legacy_command_token"])
})

test("getConnectionSecret prefers extension connection secrets", async () => {
  const token = await runWithExtensionRuntimeSdk(
    createLaunchContext(
      {
        accessToken: "extension_token"
      },
      {
        accessToken: "command_token"
      }
    ),
    () => getConnectionSecret("accessToken")
  )

  assert.equal(token, "extension_token")
})

test("withAccessToken falls back to service personal access token", async () => {
  const authorizedTokens: string[] = []
  const service = new OAuthService({
    onAuthorize: ({ token }) => {
      authorizedTokens.push(token)
    },
    personalAccessToken: "fallback_token"
  })

  await runWithExtensionRuntimeSdk(createLaunchContext({}), () =>
    withAccessToken(service)(() => {})()
  )

  assert.deepEqual(authorizedTokens, ["fallback_token"])
})

test("withAccessToken fails when no Openwork token is configured", async () => {
  await assert.rejects(
    () =>
      runWithExtensionRuntimeSdk(createLaunchContext({}), () => withAccessToken({})(() => {})()),
    /Missing accessToken preference/
  )
})

function createLaunchContext(
  extensionPreferences: Record<string, unknown>,
  commandPreferences: Record<string, unknown> = {}
): ExtensionRuntimeSdkContextValue {
  const requestHost = async (): Promise<ExtensionHostResponse> => ({
    id: "test-host-request",
    ok: true,
    result: null
  })

  return {
    commandName: "search-page",
    commandPreferences,
    extensionName: "notion",
    extensionPreferences,
    initialAction: "open",
    locale: "zh-CN",
    mode: "view",
    navigation: createExtensionRuntimeNavigation({
      requestHost
    }),
    requestHost,
    seedQuery: ""
  }
}
