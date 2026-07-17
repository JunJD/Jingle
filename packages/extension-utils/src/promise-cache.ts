import { Cache } from "@jingle/extension-api"

const PROMISE_CACHE_ENVELOPE_VERSION = 1
const PROMISE_CACHE_NAMESPACE_PREFIX = "jingle.extension-utils.promise"

export interface PromiseCachePageZero {
  cursor: string | null
  hasMore: boolean
  kind: "page-zero"
}

export interface PromiseCacheValue<TResult> {
  data: TResult
  pagination: PromiseCachePageZero | { kind: "none" }
}

export type PromiseCacheSnapshot<TResult> =
  | { failure: PromiseCacheFailure; kind: "invalid" }
  | { kind: "miss" }
  | { kind: "value"; value: PromiseCacheValue<TResult> }

export interface PromiseCacheIdentity {
  identity: string
  key: string
  namespace: string
}

export type PromiseCacheFailure =
  | {
      cause: unknown
      code: "promise_cache_capacity_exceeded"
      message: "The latest data exceeded the extension cache capacity."
    }
  | {
      cause: unknown
      code: "promise_cache_encode_failed"
      message: "The latest data could not be encoded for the extension cache."
    }
  | {
      cause: unknown
      code: "promise_cache_decode_failed"
      message: "An invalid extension cache entry was discarded."
    }

export interface PromiseCacheBindingOptions {
  onFailure?: (failure: PromiseCacheFailure) => void
}

export interface PromiseCacheBinding<TResult> {
  identity: string
  getSnapshot: () => PromiseCacheSnapshot<TResult>
  subscribe: (listener: () => void) => () => void
  write: (value: PromiseCacheValue<TResult>) => boolean
}

interface PromiseCacheEnvelope {
  pagination:
    | { kind: "none" }
    | {
        cursor: string | null
        hasMore: boolean
        kind: "page-zero"
      }
  value:
    | { kind: "json"; data: unknown }
    | {
        kind: "undefined"
      }
  version: typeof PROMISE_CACHE_ENVELOPE_VERSION
}

export function createPromiseCacheIdentity(
  fn: (...args: any[]) => unknown,
  args: readonly unknown[]
): PromiseCacheIdentity {
  const namespaceHash = hashIdentityValue(fn)
  const key = hashIdentityValue(args)
  const namespace = `${PROMISE_CACHE_NAMESPACE_PREFIX}.${namespaceHash}`

  return {
    identity: `${namespace}:${key}`,
    key,
    namespace
  }
}

export function createPromiseArgumentsIdentity(args: readonly unknown[]): string {
  return hashIdentityValue(args)
}

export function createPromiseCacheBinding<TResult>(
  identity: PromiseCacheIdentity,
  options: PromiseCacheBindingOptions = {}
): PromiseCacheBinding<TResult> {
  return new RuntimePromiseCacheBinding<TResult>(identity, options)
}

class RuntimePromiseCacheBinding<TResult> implements PromiseCacheBinding<TResult> {
  readonly identity: string

  readonly #cache: Cache
  readonly #key: string
  readonly #listeners = new Set<() => void>()
  readonly #onFailure: PromiseCacheBindingOptions["onFailure"]
  #rawValue: string | undefined
  #snapshot: PromiseCacheSnapshot<TResult>
  #unsubscribeCache: (() => void) | null = null

  constructor(identity: PromiseCacheIdentity, options: PromiseCacheBindingOptions) {
    this.identity = identity.identity
    this.#cache = new Cache({ namespace: identity.namespace })
    this.#key = identity.key
    this.#onFailure = options.onFailure

    const initialValue = this.#readCurrentValue()
    this.#rawValue = initialValue
    this.#snapshot = decodePromiseCacheValue<TResult>(initialValue)
  }

  getSnapshot = (): PromiseCacheSnapshot<TResult> => this.#snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)

    if (!this.#unsubscribeCache) {
      let unsubscribeCache: (() => void) | null = null
      try {
        unsubscribeCache = this.#cache.subscribe(this.#handleCacheChange)
        this.#unsubscribeCache = unsubscribeCache
        this.#replaceRawValue(this.#readCurrentValue())
        this.#discardInvalidSnapshot()
      } catch (error) {
        unsubscribeCache?.()
        this.#unsubscribeCache = null
        this.#listeners.delete(listener)
        throw error
      }
    }

    return () => {
      this.#listeners.delete(listener)
      if (this.#listeners.size === 0) {
        this.#unsubscribeCache?.()
        this.#unsubscribeCache = null
      }
    }
  }

  write = (value: PromiseCacheValue<TResult>): boolean => {
    let encoded: string
    try {
      encoded = encodePromiseCacheValue(value)
    } catch (error) {
      this.#onFailure?.({
        cause: error,
        code: "promise_cache_encode_failed",
        message: "The latest data could not be encoded for the extension cache."
      })
      return false
    }

    this.#cache.set(this.#key, encoded)
    if (!this.#hasStoredValue()) {
      this.#onFailure?.({
        cause: new Error("Promise cache entry exceeded the cache capacity"),
        code: "promise_cache_capacity_exceeded",
        message: "The latest data exceeded the extension cache capacity."
      })
      this.#replaceRawValue(undefined)
      return false
    }
    this.#replaceRawValue(encoded)
    return true
  }

  #readCurrentValue(): string | undefined {
    return this.#cache.get(this.#key)
  }

  #hasStoredValue(): boolean {
    return this.#cache.has(this.#key)
  }

  #handleCacheChange = (changedKey: string | undefined, data?: string): void => {
    if (changedKey !== undefined && changedKey !== this.#key) {
      return
    }

    this.#replaceRawValue(changedKey === undefined ? undefined : data)
  }

  #discardInvalidSnapshot(): void {
    if (this.#snapshot.kind !== "invalid") {
      return
    }
    const failure = this.#snapshot.failure
    this.#cache.remove(this.#key)
    this.#replaceRawValue(undefined)
    this.#onFailure?.(failure)
  }

  #replaceRawValue(rawValue: string | undefined): void {
    if (rawValue === this.#rawValue) {
      return
    }

    this.#rawValue = rawValue
    this.#snapshot = decodePromiseCacheValue<TResult>(rawValue)
    for (const listener of this.#listeners) {
      listener()
    }
  }
}

function encodePromiseCacheValue<TResult>(value: PromiseCacheValue<TResult>): string {
  assertPromiseCacheValue(value)
  const envelope: PromiseCacheEnvelope = {
    pagination: value.pagination,
    value:
      value.data === undefined
        ? { kind: "undefined" }
        : {
            data: value.data,
            kind: "json"
          },
    version: PROMISE_CACHE_ENVELOPE_VERSION
  }

  const encoded = JSON.stringify(envelope)
  if (encoded === undefined) {
    throw new TypeError("Promise cache envelope could not be encoded")
  }
  return encoded
}

function decodePromiseCacheValue<TResult>(
  rawValue: string | undefined
): PromiseCacheSnapshot<TResult> {
  if (rawValue === undefined) {
    return { kind: "miss" }
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown
    if (!isPromiseCacheEnvelope(parsed)) {
      throw new Error("Unsupported promise cache envelope")
    }
    if (parsed.value.kind === "json") {
      assertJsonCacheValue(parsed.value.data, "data", new Set<object>())
    }

    return {
      kind: "value",
      value: {
        data: (parsed.value.kind === "undefined" ? undefined : parsed.value.data) as TResult,
        pagination: parsed.pagination
      }
    }
  } catch (error) {
    return {
      failure: {
        cause: error,
        code: "promise_cache_decode_failed",
        message: "An invalid extension cache entry was discarded."
      },
      kind: "invalid"
    }
  }
}

function isPromiseCacheEnvelope(value: unknown): value is PromiseCacheEnvelope {
  if (!isPlainRecord(value) || !hasExactlyKeys(value, ["pagination", "value", "version"])) {
    return false
  }

  if (value.version !== PROMISE_CACHE_ENVELOPE_VERSION) {
    return false
  }

  if (!isPlainRecord(value.value)) {
    return false
  }

  if (value.value.kind === "undefined") {
    if (!hasExactlyKeys(value.value, ["kind"])) {
      return false
    }
  } else if (value.value.kind !== "json" || !hasExactlyKeys(value.value, ["data", "kind"])) {
    return false
  }

  if (!isPlainRecord(value.pagination) || typeof value.pagination.kind !== "string") {
    return false
  }

  if (value.pagination.kind === "none") {
    return hasExactlyKeys(value.pagination, ["kind"])
  }

  return (
    value.pagination.kind === "page-zero" &&
    hasExactlyKeys(value.pagination, ["cursor", "hasMore", "kind"]) &&
    (value.pagination.cursor === null || typeof value.pagination.cursor === "string") &&
    typeof value.pagination.hasMore === "boolean"
  )
}

function hashIdentityValue(value: unknown): string {
  const canonicalValue = encodeIdentityValue(value, new Set<object>())
  return hashCanonicalIdentity(canonicalValue)
}

function encodeIdentityValue(value: unknown, ancestors: Set<object>): string {
  if (value === null) {
    return "null"
  }

  switch (typeof value) {
    case "undefined":
      return "undefined"
    case "boolean":
      return value ? "boolean:true" : "boolean:false"
    case "number":
      if (Number.isNaN(value)) return "number:nan"
      if (value === Infinity) return "number:infinity"
      if (value === -Infinity) return "number:-infinity"
      if (Object.is(value, -0)) return "number:-0"
      return `number:${value}`
    case "string":
      return `string:${JSON.stringify(value)}`
    case "bigint":
      return `bigint:${value}`
    case "function": {
      if (Object.keys(value).length > 0 || Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError("Promise identity functions must not have custom enumerable state")
      }
      const source = Function.prototype.toString.call(value)
      if (/^\s*function\b[^{}]*\{\s*\[native code\]\s*\}\s*$/.test(source)) {
        throw new TypeError("Promise identity does not support bound or native functions")
      }
      return `function:${JSON.stringify(value.name)}:${JSON.stringify(source)}`
    }
    case "symbol":
      throw new TypeError("Promise identity does not support symbol values")
    case "object":
      break
  }

  if (ancestors.has(value)) {
    throw new TypeError("Promise identity arguments must not contain circular references")
  }

  ancestors.add(value)
  try {
    if (value instanceof Date) {
      assertUnmodifiedBuiltIn(value, Date.prototype, "Date")
      if (Number.isNaN(value.getTime())) {
        throw new TypeError("Promise identity does not support invalid Date values")
      }
      return `date:${value.toISOString()}`
    }

    if (value instanceof URL) {
      assertUnmodifiedBuiltIn(value, URL.prototype, "URL")
      return `url:${JSON.stringify(value.href)}`
    }

    if (Array.isArray(value)) {
      assertCanonicalIdentityArray(value)
      const items = Array.from({ length: value.length }, (_, index) =>
        Object.prototype.hasOwnProperty.call(value, index)
          ? encodeIdentityValue(value[index], ancestors)
          : "array-hole"
      )
      return `array:[${items.join(",")}]`
    }

    if (value instanceof WeakMap || value instanceof WeakSet || value instanceof Promise) {
      throw new TypeError(`Promise identity does not support ${value.constructor.name} values`)
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        `Promise identity does not support ${value.constructor?.name ?? "opaque"} instances`
      )
    }

    const symbolKeys = Object.getOwnPropertySymbols(value)
    if (symbolKeys.length > 0) {
      throw new TypeError("Promise identity does not support symbol object keys")
    }

    const properties = Object.keys(value).sort()
    for (const property of properties) {
      const descriptor = Object.getOwnPropertyDescriptor(value, property)
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError("Promise identity objects must contain enumerable data properties only")
      }
    }

    if (Object.getOwnPropertyNames(value).length !== properties.length) {
      throw new TypeError("Promise identity objects must not contain non-enumerable state")
    }

    const entries = properties.map(
      (property) =>
        `${JSON.stringify(property)}:${encodeIdentityValue((value as Record<string, unknown>)[property], ancestors)}`
    )
    return `object:{${entries.join(",")}}`
  } finally {
    ancestors.delete(value)
  }
}

function assertPromiseCacheValue<TResult>(value: PromiseCacheValue<TResult>): void {
  if (!isPlainRecord(value) || !hasExactlyKeys(value, ["data", "pagination"])) {
    throw new TypeError("Promise cache values must contain exactly data and pagination")
  }

  for (const property of ["data", "pagination"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(value, property)
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`Promise cache ${property} must be an enumerable data property`)
    }
  }

  const pagination: unknown = value.pagination
  if (!isPlainRecord(pagination) || typeof pagination.kind !== "string") {
    throw new TypeError("Promise cache pagination is invalid")
  }

  if (pagination.kind === "none") {
    if (!hasExactlyKeys(pagination, ["kind"])) {
      throw new TypeError("Promise cache pagination contains unsupported fields")
    }
  } else if (
    pagination.kind !== "page-zero" ||
    !hasExactlyKeys(pagination, ["cursor", "hasMore", "kind"]) ||
    (pagination.cursor !== null && typeof pagination.cursor !== "string") ||
    typeof pagination.hasMore !== "boolean"
  ) {
    throw new TypeError("Promise cache page-zero pagination is invalid")
  }

  assertJsonCacheValue(value.data, "data", new Set<object>(), true)
}

function assertJsonCacheValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
  allowUndefined = false
): void {
  if (value === undefined) {
    if (!allowUndefined) {
      throw new TypeError(`Promise cache value at "${path}" cannot be undefined`)
    }
    return
  }

  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError(`Promise cache value at "${path}" is not a lossless JSON number`)
    }
    return
  }

  if (typeof value !== "object") {
    throw new TypeError(`Promise cache value at "${path}" is not JSON-serializable`)
  }

  if (ancestors.has(value)) {
    throw new TypeError(`Promise cache value at "${path}" contains a circular reference`)
  }

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError(`Promise cache value at "${path}" uses an unsupported array prototype`)
      }
      assertJsonArrayShape(value, path)
      for (let index = 0; index < value.length; index += 1) {
        assertJsonCacheValue(value[index], `${path}[${index}]`, ancestors)
      }
      return
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        `Promise cache value at "${path}" does not support ${value.constructor?.name ?? "opaque"} instances`
      )
    }

    const keys = Reflect.ownKeys(value)
    for (const key of keys) {
      if (typeof key !== "string") {
        throw new TypeError(`Promise cache value at "${path}" cannot contain symbol keys`)
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError(
          `Promise cache value at "${path}.${key}" must be an enumerable data property`
        )
      }
      assertJsonCacheValue(descriptor.value, `${path}.${key}`, ancestors)
    }
  } finally {
    ancestors.delete(value)
  }
}

function assertJsonArrayShape(value: unknown[], path: string): void {
  const keys = Reflect.ownKeys(value)
  for (const key of keys) {
    if (key === "length") {
      continue
    }
    if (typeof key !== "string" || !isArrayIndex(key, value.length)) {
      throw new TypeError(`Promise cache value at "${path}" contains unsupported array state`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!("value" in (descriptor ?? {}))) {
      throw new TypeError(`Promise cache value at "${path}[${key}]" cannot be an accessor`)
    }
  }

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new TypeError(`Promise cache value at "${path}" cannot contain array holes`)
    }
  }
}

function assertUnmodifiedBuiltIn(value: object, prototype: object, name: string): void {
  if (Object.getPrototypeOf(value) !== prototype || Reflect.ownKeys(value).length > 0) {
    throw new TypeError(`Promise identity does not support ${name} subclasses or custom state`)
  }
}

function assertCanonicalIdentityArray(value: unknown[]): void {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError("Promise identity does not support Array subclasses")
  }

  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") {
      continue
    }
    if (typeof key !== "string" || !isArrayIndex(key, value.length)) {
      throw new TypeError("Promise identity arrays must not contain custom state")
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!("value" in (descriptor ?? {}))) {
      throw new TypeError("Promise identity arrays cannot contain accessors")
    }
  }
}

function isArrayIndex(key: string, length: number): boolean {
  const index = Number(key)
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key
}

function hashCanonicalIdentity(value: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  let third = 0x85ebca6b
  let fourth = 0xc2b2ae35

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
    third = Math.imul(third ^ code, 0xc2b2ae35)
    fourth = Math.imul(fourth ^ code, 0x27d4eb2f)
  }

  first = avalancheHash(first ^ value.length)
  second = avalancheHash(second ^ first)
  third = avalancheHash(third ^ second)
  fourth = avalancheHash(fourth ^ third)
  return [first, second, third, fourth]
    .map((part) => (part >>> 0).toString(16).padStart(8, "0"))
    .join("")
}

function avalancheHash(value: number): number {
  let result = value
  result = Math.imul(result ^ (result >>> 16), 0x85ebca6b)
  result = Math.imul(result ^ (result >>> 13), 0xc2b2ae35)
  return result ^ (result >>> 16)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.some((key) => typeof key !== "string")) {
    return false
  }
  const actualKeys = (ownKeys as string[]).sort()
  const expectedKeys = [...keys].sort()
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  )
}
