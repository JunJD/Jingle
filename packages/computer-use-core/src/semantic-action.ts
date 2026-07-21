import {
  COMPUTER_USE_NATIVE_RESPONSE_LIMITS,
  type ComputerUseActionKind,
  type ComputerUseSemanticAction
} from "./contract"

const ACTION_KEYS: Readonly<Record<ComputerUseActionKind, readonly string[]>> = {
  keypress: ["keys", "kind", "ref"],
  press: ["kind", "ref"],
  scroll: ["kind", "ref", "scrollAmount"],
  set_value: ["kind", "ref", "value"],
  type_text: ["kind", "ref", "value"]
}

export function parseComputerUseSemanticActions(
  value: unknown,
  path = "actions"
): readonly ComputerUseSemanticAction[] {
  if (!isDenseArray(value, COMPUTER_USE_NATIVE_RESPONSE_LIMITS.actions) || value.length === 0) {
    throw new Error(`Computer-use ${path} must be a bounded non-empty action list.`)
  }
  return Object.freeze(
    value.map((action, index) => parseComputerUseSemanticAction(action, `${path}[${index}]`))
  )
}

export function parseComputerUseSemanticAction(
  value: unknown,
  path = "action"
): ComputerUseSemanticAction {
  if (!isRecord(value) || !isComputerUseActionKind(value.kind)) {
    throw new Error(`Computer-use ${path} has an invalid action kind.`)
  }
  if (!hasExactKeys(value, ACTION_KEYS[value.kind])) {
    throw new Error(`Computer-use ${path} has an invalid action shape.`)
  }
  const ref = readNonEmptyString(
    value.ref,
    `${path}.ref`,
    COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token
  )
  if (value.kind === "set_value" || value.kind === "type_text") {
    return Object.freeze({
      kind: value.kind,
      ref,
      value: readText(value.value, `${path}.value`)
    })
  }
  if (value.kind === "scroll") {
    if (typeof value.scrollAmount !== "number" || !Number.isFinite(value.scrollAmount)) {
      throw new Error(`Computer-use ${path}.scrollAmount must be finite.`)
    }
    return Object.freeze({ kind: "scroll", ref, scrollAmount: value.scrollAmount })
  }
  if (value.kind === "keypress") {
    if (
      !isDenseArray(value.keys, COMPUTER_USE_NATIVE_RESPONSE_LIMITS.keys) ||
      value.keys.length === 0
    ) {
      throw new Error(`Computer-use ${path}.keys must be a bounded non-empty key list.`)
    }
    const keys = value.keys.map((key, index) =>
      readNonEmptyString(key, `${path}.keys[${index}]`, COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token)
    )
    if (new Set(keys).size !== keys.length) {
      throw new Error(`Computer-use ${path}.keys must not contain duplicates.`)
    }
    return Object.freeze({ keys: Object.freeze(keys), kind: "keypress", ref })
  }
  return Object.freeze({ kind: "press", ref })
}

export function sameComputerUseSemanticAction(
  left: ComputerUseSemanticAction,
  right: ComputerUseSemanticAction
): boolean {
  return (
    left.kind === right.kind &&
    left.ref === right.ref &&
    left.value === right.value &&
    left.scrollAmount === right.scrollAmount &&
    sameKeys(left.keys, right.keys)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isComputerUseActionKind(value: unknown): value is ComputerUseActionKind {
  return (
    value === "keypress" ||
    value === "press" ||
    value === "scroll" ||
    value === "set_value" ||
    value === "type_text"
  )
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const allowed = new Set(required)
  const keys = Object.keys(value)
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key))
}

function isDenseArray(value: unknown, maximum: number): value is unknown[] {
  if (!Array.isArray(value) || value.length > maximum) return false
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false
  }
  return true
}

function readNonEmptyString(value: unknown, path: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim().length === 0
  ) {
    throw new Error(`Computer-use ${path} must be a bounded non-empty string.`)
  }
  return value
}

function readText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length > COMPUTER_USE_NATIVE_RESPONSE_LIMITS.text) {
    throw new Error(`Computer-use ${path} must be a bounded string.`)
  }
  return value
}

function sameKeys(left?: readonly string[], right?: readonly string[]): boolean {
  if (!left || !right) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}
