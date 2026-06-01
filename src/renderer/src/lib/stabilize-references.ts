type PlainRecord = Record<string, unknown>

function isPlainRecord(value: unknown): value is PlainRecord {
  if (!value || typeof value !== "object") {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function replaceEqualDeep(previous: unknown, next: unknown): unknown {
  if (Object.is(previous, next)) {
    return previous
  }

  if (previous instanceof Date && next instanceof Date) {
    return previous.getTime() === next.getTime() ? previous : next
  }

  if (Array.isArray(previous) && Array.isArray(next)) {
    let isEqual = previous.length === next.length
    const result = next.map((nextItem, index) => {
      const stableItem = replaceEqualDeep(previous[index], nextItem)
      if (!Object.is(stableItem, previous[index])) {
        isEqual = false
      }
      return stableItem
    })

    return isEqual ? previous : result
  }

  if (isPlainRecord(previous) && isPlainRecord(next)) {
    const previousKeys = Object.keys(previous)
    const nextKeys = Object.keys(next)
    let isEqual = previousKeys.length === nextKeys.length
    const result: PlainRecord = {}

    for (const key of nextKeys) {
      if (!(key in previous)) {
        isEqual = false
      }

      const stableValue = replaceEqualDeep(previous[key], next[key])
      if (!Object.is(stableValue, previous[key])) {
        isEqual = false
      }

      result[key] = stableValue
    }

    return isEqual ? previous : result
  }

  return next
}

export function stabilizeReferences<T>(previous: T, next: T): T {
  return replaceEqualDeep(previous, next) as T
}
