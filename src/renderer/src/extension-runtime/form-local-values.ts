import type { ExtensionFormFieldNode } from "@shared/extension-runtime-protocol"

export type RuntimeFormValue = unknown
export type RuntimeFormLocalValues = Record<string, RuntimeFormValue>
export interface RuntimeFormPendingValue {
  changeId: string
  value: RuntimeFormValue
}

export function reconcileRuntimeFormLocalValues(params: {
  fields: readonly ExtensionFormFieldNode[]
  localValues: RuntimeFormLocalValues
  pendingValues: ReadonlyMap<string, RuntimeFormPendingValue>
}): {
  localValues: RuntimeFormLocalValues
  pendingValues: ReadonlyMap<string, RuntimeFormPendingValue>
} {
  let nextLocalValues = params.localValues
  let nextPendingValues: Map<string, RuntimeFormPendingValue> | null = null
  const liveFieldIds = new Set<string>()

  const mutableLocalValues = (): RuntimeFormLocalValues => {
    if (nextLocalValues === params.localValues) {
      nextLocalValues = { ...params.localValues }
    }
    return nextLocalValues
  }

  const mutablePendingValues = (): Map<string, RuntimeFormPendingValue> => {
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
    if (field.kind === "message" || field.kind === "separator") {
      continue
    }

    liveFieldIds.add(field.id)
    if (!params.pendingValues.has(field.id)) {
      deleteLocalValue(field.id)
      continue
    }

    const pendingValue = params.pendingValues.get(field.id)?.value
    if (!Object.is(nextLocalValues[field.id], pendingValue)) {
      mutableLocalValues()[field.id] = pendingValue
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

export function acknowledgeRuntimeFormLocalValue(params: {
  changeId: string
  fieldId: string
  localValues: RuntimeFormLocalValues
  pendingValues: ReadonlyMap<string, RuntimeFormPendingValue>
}): {
  localValues: RuntimeFormLocalValues
  pendingValues: ReadonlyMap<string, RuntimeFormPendingValue>
} {
  const pendingValue = params.pendingValues.get(params.fieldId)
  if (!pendingValue || pendingValue.changeId !== params.changeId) {
    return {
      localValues: params.localValues,
      pendingValues: params.pendingValues
    }
  }

  const pendingValues = new Map(params.pendingValues)
  pendingValues.delete(params.fieldId)

  if (!Object.prototype.hasOwnProperty.call(params.localValues, params.fieldId)) {
    return {
      localValues: params.localValues,
      pendingValues
    }
  }

  const localValues = { ...params.localValues }
  delete localValues[params.fieldId]

  return {
    localValues,
    pendingValues
  }
}

export function createRuntimeFormValueOverrides(params: {
  fields: readonly ExtensionFormFieldNode[]
  localValues: RuntimeFormLocalValues
}): Record<string, RuntimeFormValue> | undefined {
  let values: Record<string, RuntimeFormValue> | null = null

  for (const field of params.fields) {
    if (
      (field.kind === "message" || field.kind === "separator") ||
      !Object.prototype.hasOwnProperty.call(params.localValues, field.id)
    ) {
      continue
    }

    values ??= {}
    values[field.id] = params.localValues[field.id]
  }

  return values ?? undefined
}
