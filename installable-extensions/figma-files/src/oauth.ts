import { getConnectionSecret } from "@jingle/extension-api"
import type { WithAccessTokenService } from "@jingle/extension-utils"

export const figmaConnection: WithAccessTokenService = {
  async authorize() {
    return getFigmaAccessToken()
  },
  async getAccessToken() {
    return getFigmaAccessToken()
  }
}

export function getFigmaAccessToken(): string {
  const token = getConnectionSecret("accessToken")
  if (!token) {
    throw new Error("Connect Figma in Settings before using this extension.")
  }

  return token
}
