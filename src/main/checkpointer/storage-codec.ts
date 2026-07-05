const BASE64_TYPE_PREFIX = "base64:"

export function encodeSerializedPayload(type: string, value: Uint8Array): [string, string] {
  return [`${BASE64_TYPE_PREFIX}${type}`, Buffer.from(value).toString("base64")]
}

export function decodeSerializedPayload(
  type: string | null,
  value: Uint8Array | string | null
): { type: string; value: Uint8Array | string } {
  const normalizedType = type ?? "json"

  if (!normalizedType.startsWith(BASE64_TYPE_PREFIX)) {
    return {
      type: normalizedType,
      value: value ?? ""
    }
  }

  const actualType = normalizedType.slice(BASE64_TYPE_PREFIX.length)

  if (typeof value !== "string") {
    return {
      type: actualType,
      value: value ?? new Uint8Array()
    }
  }

  return {
    type: actualType,
    value: Uint8Array.from(Buffer.from(value, "base64"))
  }
}
