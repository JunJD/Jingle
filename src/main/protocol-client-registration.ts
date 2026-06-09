export const REGISTER_DEV_PROTOCOL_CLIENT_ENV = "OPENWORK_REGISTER_DEV_PROTOCOL_CLIENT"

export type JingleProtocolRegistrationMode = "register-dev" | "register-packaged" | "unregister-dev"

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
