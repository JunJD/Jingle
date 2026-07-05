export interface RuntimeOAuthPKCEClientOptions {
  description?: string
  providerIcon?: string
  providerId?: string
  providerName?: string
  redirectMethod?: string
}

export class RuntimeOAuthPKCEClient {
  readonly options: RuntimeOAuthPKCEClientOptions

  constructor(options: RuntimeOAuthPKCEClientOptions) {
    this.options = options
  }
}

export const OAuth = {
  PKCEClient: RuntimeOAuthPKCEClient,
  RedirectMethod: {
    Web: "web"
  }
} as const
