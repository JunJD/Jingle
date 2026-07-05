import assert from "node:assert/strict"
import test from "node:test"
import { getConnectionSecret } from "@jingle/extension-api"
import {
  createExtensionRuntimeNavigation,
  runWithExtensionRuntimeSdk,
  type ExtensionRuntimeSdkContextValue
} from "@jingle/extension-api/host-runtime"
import { OAuthService, getAccessToken, withAccessToken } from "../../packages/extension-utils/src"
import type { ExtensionHostResponse } from "../../src/shared/extension-runtime-protocol"

test("withAccessToken initializes OAuth-style services from Jingle preferences", async () => {
  const authorizedTokens: string[] = []
  const service = new OAuthService({
    onAuthorize: ({ token }) => {
      authorizedTokens.push(token)
    },
    personalAccessToken: "service_token"
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

test("withAccessToken ignores command-scoped access token values", async () => {
  const authorizedTokens: string[] = []
  const service = new OAuthService({
    onAuthorize: ({ token }) => {
      authorizedTokens.push(token)
    }
  })

  await assert.rejects(
    () =>
      runWithExtensionRuntimeSdk(createLaunchContext({}, { accessToken: "command_token" }), () =>
        withAccessToken(service)(() => {})()
      ),
    /Missing accessToken preference/
  )

  assert.deepEqual(authorizedTokens, [])
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

test("getConnectionSecret ignores command-scoped secret values", async () => {
  const token = await runWithExtensionRuntimeSdk(
    createLaunchContext(
      {},
      {
        accessToken: "command_token"
      }
    ),
    () => getConnectionSecret("accessToken")
  )

  assert.equal(token, "")
})

test("withAccessToken uses service personal access token when no connection secret exists", async () => {
  const authorizedTokens: string[] = []
  const service = new OAuthService({
    onAuthorize: ({ token }) => {
      authorizedTokens.push(token)
    },
    personalAccessToken: "service_token"
  })

  await runWithExtensionRuntimeSdk(createLaunchContext({}), () =>
    withAccessToken(service)(() => {})()
  )

  assert.deepEqual(authorizedTokens, ["service_token"])
})

test("withAccessToken fails when no Jingle token is configured", async () => {
  await assert.rejects(
    () =>
      runWithExtensionRuntimeSdk(createLaunchContext({}), () => withAccessToken({})(() => {})()),
    /Missing accessToken preference/
  )
})

test("OAuthService exposes authorize and getAccessToken methods", async () => {
  const authorizedTokens: string[] = []
  const service = new OAuthService({
    onAuthorize: ({ token }) => {
      authorizedTokens.push(token)
    },
    personalAccessToken: "service_token"
  })

  const [accessToken, authorizedToken] = await runWithExtensionRuntimeSdk(
    createLaunchContext({
      accessToken: "secret_token"
    }),
    async () => Promise.all([service.getAccessToken(), service.authorize()])
  )

  assert.equal(accessToken, "secret_token")
  assert.equal(authorizedToken, "secret_token")
  assert.deepEqual(authorizedTokens, ["secret_token", "secret_token"])
})

test("getAccessToken utility resolves generic withAccessToken services", async () => {
  const authorizedTokens: string[] = []
  const token = await runWithExtensionRuntimeSdk(createLaunchContext({}), () =>
    getAccessToken({
      onAuthorize: ({ token }) => {
        authorizedTokens.push(token)
      },
      personalAccessToken: "service_token"
    })
  )

  assert.equal(token, "service_token")
  assert.deepEqual(authorizedTokens, ["service_token"])
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
