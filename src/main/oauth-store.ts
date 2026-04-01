import Store from "electron-store"
import { getOpenworkDir } from "./storage"
import type { OAuthTokenRecord } from "../shared/oauth"

interface OAuthStoreShape {
  tokens: Record<string, OAuthTokenRecord>
}

const oauthStore = new Store<OAuthStoreShape>({
  name: "oauth",
  cwd: getOpenworkDir(),
  defaults: {
    tokens: {}
  }
})

export function getOAuthToken(provider: string): OAuthTokenRecord | null {
  const tokens = oauthStore.get("tokens", {})
  return tokens[provider] ?? null
}

export function setOAuthToken(provider: string, token: OAuthTokenRecord): void {
  const tokens = oauthStore.get("tokens", {})
  oauthStore.set("tokens", {
    ...tokens,
    [provider]: token
  })
}

export function removeOAuthToken(provider: string): void {
  const tokens = oauthStore.get("tokens", {})
  if (!(provider in tokens)) {
    return
  }

  const { [provider]: _removed, ...remainingTokens } = tokens
  oauthStore.set("tokens", remainingTokens)
}
