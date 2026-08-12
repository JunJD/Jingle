import assert from "node:assert/strict"
import test from "node:test"
import { defineNativeExtensionManifest as definePublicNativeExtensionManifest } from "@jingle/extension-api"
import { defineNativeExtensionManifest } from "../../src/shared/native-extensions"

function defineManifestWithToolDisplays(
  toolName: string,
  toolDisplays: Record<string, never>
): void {
  defineNativeExtensionManifest({
    aiCapability: {
      guide: "Use the invalid display fixture.",
      id: "invalid-display",
      title: "Invalid Display",
      toolDisplays,
      toolNames: [toolName]
    },
    capabilities: [],
    commands: [],
    connection: {
      auth: {
        type: "none"
      },
      id: "default",
      provider: "invalid-display",
      title: "Invalid Display"
    },
    name: "invalid-display",
    title: "Invalid Display"
  })
}

test("native extension manifest requires own tool display entries", () => {
  assert.throws(
    () => defineManifestWithToolDisplays("toString", {}),
    /aiCapability\.toolDisplays must define "toString"/
  )
})

test("native extension manifest rejects undefined tool display entries", () => {
  assert.throws(
    () =>
      defineManifestWithToolDisplays("missingDisplay", {
        missingDisplay: undefined as never
      }),
    /aiCapability\.toolDisplays must define "missingDisplay"/
  )
})

test("native extension manifest limits OAuth V1 credentials to one access token", () => {
  assert.throws(
    () =>
      defineNativeExtensionManifest({
        capabilities: [],
        commands: [],
        connection: {
          auth: {
            authorizationUrl: "https://jingle.cool/oauth/example/start",
            clientId: "jingle-desktop",
            redirect: {
              callbackPath: "/oauth/callback",
              method: "app-scheme",
              scheme: "jingle"
            },
            scopes: [],
            secretNames: ["accessToken", "refreshToken"],
            tokenUrl: "https://jingle.cool/oauth/example/token",
            type: "oauth"
          },
          id: "default",
          provider: "example",
          title: "Example"
        },
        name: "example",
        title: "Example"
      }),
    /OAuth auth\.secretNames must be exactly \["accessToken"\]/
  )

  assert.throws(
    () =>
      definePublicNativeExtensionManifest({
        capabilities: [],
        commands: [],
        connection: {
          auth: {
            authorizationUrl: "https://jingle.cool/oauth/example/start",
            clientId: "jingle-desktop",
            redirect: {
              callbackPath: "/oauth/callback",
              method: "app-scheme",
              scheme: "jingle"
            },
            scopes: [],
            secretNames: ["accessToken", "refreshToken"] as unknown as ["accessToken"],
            tokenUrl: "https://jingle.cool/oauth/example/token",
            type: "oauth"
          },
          id: "default",
          provider: "example",
          title: "Example"
        },
        name: "example",
        title: "Example"
      }),
    /OAuth auth\.secretNames must be exactly \["accessToken"\]/
  )
})

test("native extension manifest keeps multi-field API key credentials", () => {
  assert.doesNotThrow(() =>
    definePublicNativeExtensionManifest({
      capabilities: [],
      commands: [],
      connection: {
        auth: {
          secretNames: ["accountId", "apiKey"],
          type: "apiKey"
        },
        id: "default",
        provider: "example",
        title: "Example"
      },
      name: "example",
      title: "Example"
    })
  )
})
