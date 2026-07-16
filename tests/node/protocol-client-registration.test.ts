import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  findJingleProtocolUrl,
  isJingleOAuthCallbackUrl,
  resolveJingleProtocolRegistrationMode,
  type JingleProtocolRegistrationMode
} from "../../src/main/protocol-client-registration"

function resolveMode(params: {
  bypassSingleInstanceLock?: boolean
  isDev?: boolean
  registerDevProtocolClient?: string
}): JingleProtocolRegistrationMode | null {
  return resolveJingleProtocolRegistrationMode({
    bypassSingleInstanceLock: params.bypassSingleInstanceLock ?? false,
    isDev: params.isDev ?? false,
    registerDevProtocolClient: params.registerDevProtocolClient
  })
}

describe("jingle protocol client registration", () => {
  test("skips protocol registration when the app bypasses the single instance lock", () => {
    assert.equal(resolveMode({ bypassSingleInstanceLock: true, isDev: false }), null)
    assert.equal(resolveMode({ bypassSingleInstanceLock: true, isDev: true }), null)
  })

  test("registers the packaged app as the production jingle protocol handler", () => {
    assert.equal(resolveMode({ isDev: false }), "register-packaged")
  })

  test("does not let development Electron keep the production jingle protocol handler by default", () => {
    assert.equal(resolveMode({ isDev: true }), "unregister-dev")
    assert.equal(resolveMode({ isDev: true, registerDevProtocolClient: "0" }), "unregister-dev")
  })

  test("allows development protocol registration only when explicitly enabled", () => {
    assert.equal(resolveMode({ isDev: true, registerDevProtocolClient: "1" }), "register-dev")
  })
})

describe("jingle OAuth callback URLs", () => {
  test("accepts only the canonical OAuth callback authority or path", () => {
    assert.equal(
      isJingleOAuthCallbackUrl("jingle://oauth/callback?state=state-1&code=code-1"),
      true
    )
    assert.equal(isJingleOAuthCallbackUrl("jingle:/oauth/callback?state=state-1"), true)
    assert.equal(isJingleOAuthCallbackUrl("https://oauth/callback"), false)
    assert.equal(isJingleOAuthCallbackUrl("jingle://other/oauth/callback"), false)
    assert.equal(isJingleOAuthCallbackUrl("jingle://user@oauth/callback"), false)
    assert.equal(isJingleOAuthCallbackUrl("jingle://oauth:443/callback"), false)
    assert.equal(isJingleOAuthCallbackUrl("jingle://["), false)
  })

  test("skips malformed arguments while preserving non-OAuth Jingle deep links", () => {
    assert.equal(
      findJingleProtocolUrl([
        "--flag",
        "jingle://[",
        "jingle://extensions/notion/search-page",
        "jingle://oauth/callback?state=state-1"
      ]),
      "jingle://extensions/notion/search-page"
    )
  })
})
