export const REGISTER_DEV_PROTOCOL_CLIENT_ENV = "JINGLE_REGISTER_DEV_PROTOCOL_CLIENT"
export const JINGLE_PROTOCOL = "jingle"

export type JingleProtocolRegistrationMode = "register-dev" | "register-packaged" | "unregister-dev"

function parseJingleProtocolUrl(rawUrl: string): URL | null {
  try {
    const parsedUrl = new URL(rawUrl)
    return parsedUrl.protocol === `${JINGLE_PROTOCOL}:` ? parsedUrl : null
  } catch {
    return null
  }
}

export function isJingleOAuthCallbackUrl(rawUrl: string): boolean {
  const parsedUrl = parseJingleProtocolUrl(rawUrl)
  if (!parsedUrl) {
    return false
  }

  const hasNoCredentials = parsedUrl.username.length === 0 && parsedUrl.password.length === 0
  const isAuthorityForm =
    hasNoCredentials && parsedUrl.host === "oauth" && parsedUrl.pathname === "/callback"
  const isPathForm =
    hasNoCredentials && parsedUrl.host.length === 0 && parsedUrl.pathname === "/oauth/callback"
  return isAuthorityForm || isPathForm
}

export function findJingleProtocolUrl(entries: readonly string[]): string | null {
  return entries.find((entry) => parseJingleProtocolUrl(entry) !== null) ?? null
}

export function resolveJingleProtocolRegistrationMode(params: {
  bypassSingleInstanceLock: boolean
  isDev: boolean
  registerDevProtocolClient: string | undefined
}): JingleProtocolRegistrationMode | null {
  if (params.bypassSingleInstanceLock) {
    return null
  }

  if (!params.isDev) {
    return "register-packaged"
  }

  return params.registerDevProtocolClient === "1" ? "register-dev" : "unregister-dev"
}
