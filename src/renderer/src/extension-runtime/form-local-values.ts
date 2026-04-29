import type { ExtensionFormFieldNode } from "@shared/extension-runtime-protocol"

export type RuntimeFormValue = boolean | string
export type RuntimeFormLocalValues = Record<string, RuntimeFormValue>

export function reconcileRuntimeFormLocalValues(params: {
  fields: readonly ExtensionFormFieldNode[]
  localValues: RuntimeFormLocalValues
  pendingValues: ReadonlyMap<string, RuntimeFormValue>
}): {
  localValues: RuntimeFormLocalValues
  pendingValues: ReadonlyMap<string, RuntimeFormValue>
} {
  let nextLocalValues = params.localValues
  let nextPendingValues: Map<string, RuntimeFormValue> | null = null
  const liveFieldIds = new Set<string>()

  const mutableLocalValues = (): RuntimeFormLocalValues => {
    if (nextLocalValues === params.localValues) {
      nextLocalValues = { ...params.localValues }
    }
    return nextLocalValues
  }

  const mutablePendingValues = (): Map<string, RuntimeFormValue> => {
    if (!nextPendingValues) {
      nextPendingValues = new Map(params.pendingValues)
    }
    return nextPendingValues
  }

  const deleteLocalValue = (fieldId: string): void => {
    if (Object.prototype.hasOwnProperty.call(nextLocalValues, fieldId)) {
      delete mutableLocalValues()[fieldId]
    }
  }

  for (const field of params.fields) {
    if (field.kind === "separator") {
      continue
    }

    liveFieldIds.add(field.id)
    if (!params.pendingValues.has(field.id)) {
      deleteLocalValue(field.id)
      continue
    }

    const pendingValue = params.pendingValues.get(field.id)
    if (Object.is(pendingValue, field.value)) {
      mutablePendingValues().delete(field.id)
      deleteLocalValue(field.id)
      continue
    }

    if (!Object.is(nextLocalValues[field.id], pendingValue)) {
      mutableLocalValues()[field.id] = pendingValue as RuntimeFormValue
    }
  }

  for (const fieldId of Object.keys(nextLocalValues)) {
    if (!liveFieldIds.has(fieldId)) {
      deleteLocalValue(fieldId)
    }
  }

  for (const fieldId of params.pendingValues.keys()) {
    if (!liveFieldIds.has(fieldId)) {
      mutablePendingValues().delete(fieldId)
    }
  }

  return {
    localValues: nextLocalValues,
    pendingValues: nextPendingValues ?? params.pendingValues
  }
}
