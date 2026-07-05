import { randomBytes, createHash } from "crypto"
import { shell } from "electron"
import type {
  NativeExtensionConnectionManifest,
  NativeExtensionOAuthCallbackResult,
  NativeExtensionOAuthStartRequest,
  NativeExtensionOAuthStartResponse,
  NativeExtensionPackageManifest
} from "@shared/native-extensions"
import { getDefaultExtensionRegistryService } from "../extensions/registry/default-registry"
import { setNativeExtensionConnectionSecretRecord } from "../preferences"
import { resolveNativeExtensionConnection } from "./connection-resolver"

interface PendingOAuthConnection {
  codeVerifier: string
  connection: NativeExtensionConnectionManifest & {
    auth: Extract<NativeExtensionConnectionManifest["auth"], { type: "oauth" }>
  }
  extensionName: string
  provider: string
  state: string
}

const pendingOAuthConnections = new Map<string, PendingOAuthConnection>()

function base64Url(input: Buffer): string {
  return input.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

function createOAuthState(): string {
  return base64Url(randomBytes(24))
}

function createCodeVerifier(): string {
  return base64Url(randomBytes(48))
}

function createCodeChallenge(codeVerifier: string): string {
  return base64Url(createHash("sha256").update(codeVerifier).digest())
}

function getNativeExtensionManifest(extensionName: string): NativeExtensionPackageManifest {
  const manifest = getDefaultExtensionRegistryService().listManifests(process.platform).find(
    (candidate) => candidate.name === extensionName
  )
  if (!manifest) {
    throw new Error(`Unknown native extension "${extensionName}"`)
  }

  return manifest
}

function resolveOAuthConnection(params: {
  connectionId?: string
  extensionName: string
}): PendingOAuthConnection["connection"] {
  const manifest = getNativeExtensionManifest(params.extensionName)
  const connection = manifest.connection
  if (!connection) {
    throw new Error(`Native extension "${params.extensionName}" does not declare a connection`)
  }
  if (params.connectionId && connection.id !== params.connectionId) {
    throw new Error(
      `Native extension "${params.extensionName}" does not declare connection "${params.connectionId}"`
    )
  }
  if (connection.auth.type !== "oauth") {
    throw new Error(
      `Native extension "${params.extensionName}" connection "${connection.id}" is not OAuth-backed`
    )
  }

  return connection as PendingOAuthConnection["connection"]
}

function getRedirectUrl(connection: PendingOAuthConnection["connection"]): string {
  if (connection.auth.redirect.method === "web") {
    return connection.auth.redirect.redirectUrl
  }
  if (connection.auth.redirect.method === "app-scheme") {
    return `${connection.auth.redirect.scheme}://${connection.auth.redirect.callbackPath.replace(/^\//, "")}`
  }

  return `${connection.auth.redirect.uriScheme}:${connection.auth.redirect.callbackPath}`
}

function buildAuthorizationUrl(params: {
  codeChallenge: string
  connection: PendingOAuthConnection["connection"]
  extensionName: string
  state: string
}): string {
  const authorizationUrl = new URL(params.connection.auth.authorizationUrl)
  authorizationUrl.searchParams.set("client_id", params.connection.auth.clientId)
  authorizationUrl.searchParams.set("redirect_uri", getRedirectUrl(params.connection))
  authorizationUrl.searchParams.set("response_type", "code")
  authorizationUrl.searchParams.set("state", params.state)
  authorizationUrl.searchParams.set("code_challenge", params.codeChallenge)
  authorizationUrl.searchParams.set("code_challenge_method", "S256")
  authorizationUrl.searchParams.set("provider", params.connection.provider)
  authorizationUrl.searchParams.set("extension_name", params.extensionName)
  authorizationUrl.searchParams.set("connection_id", params.connection.id)
  if (params.connection.auth.scopes.length > 0) {
    authorizationUrl.searchParams.set("scope", params.connection.auth.scopes.join(" "))
  }

  return authorizationUrl.toString()
}

function parseOAuthCallbackUrl(rawUrl: string): URL {
  const callbackUrl = new URL(rawUrl)
  const state = callbackUrl.searchParams.get("state")
  if (!state) {
    throw new Error("OAuth callback is missing state")
  }
  if (!pendingOAuthConnections.has(state)) {
    throw new Error("OAuth callback state is not pending")
  }

  return callbackUrl
}

function getCallbackHandoffCode(callbackUrl: URL): string {
  const error = callbackUrl.searchParams.get("error")
  if (error) {
    const description = callbackUrl.searchParams.get("error_description")
    throw new Error(description ? `${error}: ${description}` : error)
  }

  const code = callbackUrl.searchParams.get("code") ?? callbackUrl.searchParams.get("handoff_token")
  if (!code) {
    throw new Error("OAuth callback did not include a handoff code")
  }

  return code
}

function isTokenResponseRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

async function exchangeOAuthToken(params: {
  code: string
  codeVerifier: string
  connection: PendingOAuthConnection["connection"]
  extensionName: string
  redirectUrl: string
  state: string
}): Promise<string> {
  const response = await fetch(params.connection.auth.tokenUrl, {
    body: JSON.stringify({
      client_id: params.connection.auth.clientId,
      code: params.code,
      code_verifier: params.codeVerifier,
      connection_id: params.connection.id,
      extension_name: params.extensionName,
      provider: params.connection.provider,
      redirect_uri: params.redirectUrl,
      state: params.state
    }),
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  })

  if (!response.ok) {
    throw new Error(`OAuth token exchange failed with status ${response.status}`)
  }

  const payload: unknown = await response.json()
  if (!isTokenResponseRecord(payload) || typeof payload.access_token !== "string") {
    throw new Error("OAuth token exchange did not return access_token")
  }

  return payload.access_token
}

export class NativeExtensionOAuthService {
  async startConnection(
    request: NativeExtensionOAuthStartRequest
  ): Promise<NativeExtensionOAuthStartResponse> {
    const connection = resolveOAuthConnection(request)
    const state = createOAuthState()
    const codeVerifier = createCodeVerifier()
    const authorizationUrl = buildAuthorizationUrl({
      codeChallenge: createCodeChallenge(codeVerifier),
      connection,
      extensionName: request.extensionName,
      state
    })

    const pendingConnection: PendingOAuthConnection = {
      codeVerifier,
      connection,
      extensionName: request.extensionName,
      provider: connection.provider,
      state
    }
    pendingOAuthConnections.set(state, pendingConnection)
    try {
      await shell.openExternal(authorizationUrl)
    } catch (error) {
      pendingOAuthConnections.delete(state)
      throw error
    }

    return {
      authorizationUrl,
      connectionId: connection.id,
      extensionName: request.extensionName,
      provider: connection.provider
    }
  }

  async finishCallback(rawUrl: string): Promise<NativeExtensionOAuthCallbackResult> {
    const callbackUrl = parseOAuthCallbackUrl(rawUrl)
    const state = callbackUrl.searchParams.get("state")
    if (!state) {
      throw new Error("OAuth callback is missing state")
    }

    const pending = pendingOAuthConnections.get(state)
    if (!pending) {
      throw new Error("OAuth callback state is not pending")
    }
    pendingOAuthConnections.delete(state)

    const provider = callbackUrl.searchParams.get("provider") ?? pending.provider
    if (provider !== pending.provider) {
      throw new Error(
        `OAuth callback provider mismatch: expected ${pending.provider}, got ${provider}`
      )
    }

    const accessToken = await exchangeOAuthToken({
      code: getCallbackHandoffCode(callbackUrl),
      codeVerifier: pending.codeVerifier,
      connection: pending.connection,
      extensionName: pending.extensionName,
      redirectUrl: getRedirectUrl(pending.connection),
      state
    })
    setNativeExtensionConnectionSecretRecord({
      connectionId: pending.connection.id,
      nextRecord: {
        accessToken
      },
      provider: pending.connection.provider,
      secretNames: pending.connection.auth.secretNames
    })

    return resolveNativeExtensionConnection({
      extensionName: pending.extensionName,
      platform: process.platform
    })
  }
}
