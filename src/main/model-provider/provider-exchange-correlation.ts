import { types } from "node:util"

export const PROVIDER_EXCHANGE_CORRELATION_VERSION = 1
export const MAX_PROVIDER_CORRELATION_ID_LENGTH = 256

const PROVIDER_CORRELATION_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/i

export interface ProviderExchangeCorrelation {
  readonly providerRequestId?: string
  readonly providerResponseId?: string
  readonly version: typeof PROVIDER_EXCHANGE_CORRELATION_VERSION
}

export type ProviderExchangeCorrelationSink = (fact: ProviderExchangeCorrelation) => void

export function parseProviderCorrelationId(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PROVIDER_CORRELATION_ID_LENGTH &&
    PROVIDER_CORRELATION_ID_PATTERN.test(value)
    ? value
    : null
}

export function createProviderExchangeCorrelation(input: {
  providerRequestId?: unknown
  providerResponseId?: unknown
}): ProviderExchangeCorrelation | null {
  const providerRequestId = parseProviderCorrelationId(input.providerRequestId)
  const providerResponseId = parseProviderCorrelationId(input.providerResponseId)
  if (!providerRequestId && !providerResponseId) {
    return null
  }

  return Object.freeze({
    ...(providerRequestId ? { providerRequestId } : {}),
    ...(providerResponseId ? { providerResponseId } : {}),
    version: PROVIDER_EXCHANGE_CORRELATION_VERSION
  })
}

export function recordProviderExchangeCorrelation(
  sink: ProviderExchangeCorrelationSink | undefined,
  input: {
    providerRequestId?: unknown
    providerResponseId?: unknown
  }
): void {
  if (!sink) {
    return
  }
  const fact = createProviderExchangeCorrelation(input)
  if (!fact) {
    return
  }
  try {
    void Promise.resolve(sink(fact)).catch(() => {})
  } catch {
    // Diagnostics must never change provider request semantics.
  }
}

export function readProviderRequestIdFromError(error: unknown): string | null {
  const visited = new Set<object>()
  let current = error
  for (let depth = 0; depth < 6; depth += 1) {
    if (!current || typeof current !== "object" || types.isProxy(current) || visited.has(current)) {
      return null
    }
    visited.add(current)
    const requestId = readOwnDataField(current, "requestID")
    const parsedRequestId = parseProviderCorrelationId(requestId)
    if (parsedRequestId) {
      return parsedRequestId
    }
    current = readOwnDataField(current, "cause")
  }
  return null
}

export function readProviderResponseIdFromMessage(message: unknown): string | null {
  if (!message || typeof message !== "object" || types.isProxy(message)) {
    return null
  }
  const responseMetadata = readOwnDataField(message, "response_metadata")
  if (
    responseMetadata &&
    typeof responseMetadata === "object" &&
    !types.isProxy(responseMetadata)
  ) {
    const metadataId = readOwnDataField(responseMetadata, "id")
    if (metadataId !== undefined) {
      return parseProviderCorrelationId(metadataId)
    }
  }

  return parseProviderCorrelationId(readOwnDataField(message, "id"))
}

function readOwnDataField(value: object, key: PropertyKey): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && "value" in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}
