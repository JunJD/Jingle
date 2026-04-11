export function toNumber(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value
}

export function serializeJsonValue(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return null
  }
  return typeof value === "string" ? value : JSON.stringify(value)
}
