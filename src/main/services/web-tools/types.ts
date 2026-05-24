export type WebSearchProviderId = "tavily"

export interface WebSearchResult {
  readonly snippet: string
  readonly title: string
  readonly url: string
}

export interface WebSearchResponse {
  readonly provider: WebSearchProviderId
  readonly query: string
  readonly results: readonly WebSearchResult[]
  readonly totalResults: number
}
