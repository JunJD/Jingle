export interface OAuthTokenRecord {
  accessToken: string
  expiresIn?: number
  obtainedAt: string
  refreshToken?: string
  idToken?: string
  scope?: string
  tokenType?: string
}
