import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import type {
  ExtensionActionNode,
  ExtensionDetailMetadataNode,
  ExtensionFormFieldNode,
  ExtensionListDropdownNode,
  ExtensionListItemNode,
  ExtensionListSectionNode,
  ExtensionListSurfaceSnapshot,
  ExtensionRuntimeEvent,
  ExtensionRuntimeEventAck,
  ExtensionRuntimeLaunchIntent,
  ExtensionSurfaceSnapshot,
  ExtensionToastPayload
} from "@shared/extension-runtime-protocol"
import { normalizeExtensionRuntimeLaunchIntent } from "@shared/extension-runtime-protocol"
import type { NativeExtensionHostValue, NativeExtensionNavigation } from "../extension-host/sdk"
import type { NativeSurfaceListEmptyPresentation } from "../extension-host/list-presentation"
import {
  acknowledgeRuntimeFormLocalValue,
  createRuntimeFormValueOverrides,
  reconcileRuntimeFormLocalValues,
  type RuntimeFormLocalValues,
  type RuntimeFormPendingValue,
  type RuntimeFormValue
} from "./form-local-values"
import { handleRuntimeNavigationRequest } from "./runtime-navigation"

const RUNTIME_LIST_QUERY_THROTTLE_MS = 250
const RUNTIME_TOAST_DISMISS_MS = 3200

declare const runtimeOpenExternalTargetBrand: unique symbol

export type RuntimeOpenExternalTarget = string & {
  readonly [runtimeOpenExternalTargetBrand]: true
}

export type RuntimeOpenExternalCommand = (target: RuntimeOpenExternalTarget) => void

export type RuntimeDetailMetadataViewModel = Omit<ExtensionDetailMetadataNode, "target"> & {
  openTarget: RuntimeOpenExternalTarget | null
}

export type RuntimeListDropdownViewModel = Omit<ExtensionListDropdownNode, "value"> & {
  value: string
}

export type RuntimeListDropdownProjection =
  | { kind: "absent" }
  | { dropdown: RuntimeListDropdownViewModel; kind: "ready" }

type RuntimePrimaryActionPresentation =
  | {
      execute: () => void
      kind: "ready"
      title: string
    }
  | { kind: "invalid" }

interface RuntimeToastState {
  id: number
  toast: ExtensionToastPayload
}

export interface RuntimeListChromeViewModel {
  footerLabel: string
  headerLabel?: string
  placeholders: string[]
}

export interface RuntimeListItemViewModel extends ExtensionListItemNode {
  sectionTitle?: string
}

export interface RuntimeListSectionViewModel extends Omit<ExtensionListSectionNode, "items"> {
  items: RuntimeListItemViewModel[]
}

interface RuntimeSurfaceState {
  error: string | null
  sessionId: string | null
  snapshot: ExtensionSurfaceSnapshot | null
}

interface RuntimeFormState {
  localValues: RuntimeFormLocalValues
  pendingValues: ReadonlyMap<string, RuntimeFormPendingValue>
}

type RuntimeFormStateAction =
  | { ack: ExtensionRuntimeEventAck; type: "field.ack" }
  | { changeId: string; fieldId: string; type: "field.change"; value: RuntimeFormValue }
  | { fields: readonly ExtensionFormFieldNode[]; type: "surface.reconcile" }
  | { type: "reset" }

export interface RuntimeExtensionController {
  dismissToast: () => void
  executeAction: (action: ExtensionActionNode) => void
  executeToastAction: (actionId: string) => void
  formLocalValues: RuntimeFormLocalValues
  goHome: () => void
  inputText: string
  listDropdownProjection: RuntimeListDropdownProjection
  navigateBack: () => void
  runtimeState: RuntimeSurfaceState
  runtimeToast: RuntimeToastState | null
  sendEvent: (event: ExtensionRuntimeEvent) => void
  setFormDropdownSearch: (fieldId: string, query: string) => void
  setFormFieldValue: (fieldId: string, value: RuntimeFormValue) => void
  setInputText: (value: string, throttle: boolean) => void
  surfaceError: string | null
}

export function projectRuntimeListDropdown(
  snapshot: ExtensionListSurfaceSnapshot | null
): RuntimeListDropdownProjection {
  const dropdown = snapshot?.searchBarAccessory
  if (!dropdown) {
    return { kind: "absent" }
  }

  return {
    dropdown,
    kind: "ready"
  }
}

export function projectRuntimeActiveActionNodes(params: {
  listSnapshot: ExtensionListSurfaceSnapshot | null
  selectedItem: ExtensionListItemNode | null
}): ExtensionActionNode[] {
  const { listSnapshot, selectedItem } = params

  if (selectedItem && selectedItem.actions.length > 0) {
    return selectedItem.actions
  }

  if (listSnapshot?.emptyView && listSnapshot.emptyView.actions.length > 0) {
    return listSnapshot.emptyView.actions
  }

  return listSnapshot ? listSnapshot.actions : []
}

export function projectRuntimeListItemPrimaryAction(params: {
  item: ExtensionListItemNode | undefined
  listSnapshot: ExtensionListSurfaceSnapshot
}): ExtensionActionNode | null {
  const { item, listSnapshot } = params
  const actions = item && item.actions.length > 0 ? item.actions : listSnapshot.actions
  return actions[0] ?? null
}

export function projectRuntimeListChrome(params: {
  selectedItem: RuntimeListItemViewModel | null
  snapshot: ExtensionListSurfaceSnapshot | null
}): RuntimeListChromeViewModel {
  const { selectedItem, snapshot } = params

  if (!snapshot) {
    return {
      footerLabel: "Results",
      placeholders: ["Search"]
    }
  }

  return {
    footerLabel: selectedItem?.sectionTitle ?? snapshot.navigationTitle,
    headerLabel: snapshot.navigationTitle,
    placeholders: [snapshot.searchBarPlaceholder ?? "Search"]
  }
}

export function projectRuntimeListSections(params: {
  query: string
  snapshot: ExtensionListSurfaceSnapshot | null
}): RuntimeListSectionViewModel[] {
  const { query, snapshot } = params
  if (!snapshot) {
    return []
  }

  const normalizedQuery = query.trim().toLowerCase()
  return snapshot.sections.reduce<RuntimeListSectionViewModel[]>((sections, section) => {
    const items = section.items.flatMap((item) => {
      if (snapshot.filtering && !runtimeListItemMatchesQuery(item, normalizedQuery)) {
        return []
      }

      return [{ ...item, sectionTitle: section.title }]
    })

    if (items.length > 0) {
      sections.push({ ...section, items })
    }

    return sections
  }, [])
}

export function projectRuntimeListEmptyPresentation(params: {
  listSnapshot: ExtensionListSurfaceSnapshot | null
  primaryAction: RuntimePrimaryActionPresentation
  snapshot: ExtensionSurfaceSnapshot | null
  surfaceError: string | null
}): NativeSurfaceListEmptyPresentation {
  const { listSnapshot, primaryAction, snapshot, surfaceError } = params

  if (surfaceError) {
    return {
      description: surfaceError,
      kind: "invalid",
      title: "Extension surface unavailable"
    }
  }

  if (snapshot?.kind === "error") {
    return {
      description: snapshot.description,
      kind: "invalid",
      title: snapshot.title
    }
  }

  if (!listSnapshot || listSnapshot.isLoading) {
    return {
      kind: "loading",
      label: "Loading extension"
    }
  }

  const action =
    primaryAction.kind === "ready"
      ? {
          execute: primaryAction.execute,
          title: primaryAction.title
        }
      : undefined

  if (!listSnapshot.emptyView) {
    return { action, kind: "ready", title: "No items" }
  }

  return {
    action,
    description: listSnapshot.emptyView.description,
    kind: "ready",
    title: listSnapshot.emptyView.title
  }
}

export function projectRuntimeDetailMetadata(
  entry: ExtensionDetailMetadataNode
): RuntimeDetailMetadataViewModel {
  const { target, ...metadata } = entry

  return {
    ...metadata,
    openTarget: projectRuntimeOpenExternalTarget(target)
  }
}

export function createRuntimeForegroundLaunchIntent(
  host: Pick<
    NativeExtensionHostValue,
    "commandName" | "extensionName" | "initialAction" | "launchProps"
  >,
  seedQuery: string
): ExtensionRuntimeLaunchIntent {
  return normalizeExtensionRuntimeLaunchIntent({
    commandName: host.commandName,
    extensionName: host.extensionName,
    initialAction: host.initialAction,
    ...(host.launchProps !== undefined ? { launchProps: host.launchProps } : {}),
    seedQuery
  })
}

export function useRuntimeExtensionController(params: {
  activeSessionIdRef: { current: string | null }
  host: NativeExtensionHostValue
  navigation: NativeExtensionNavigation
}): RuntimeExtensionController {
  const { activeSessionIdRef, host, navigation } = params
  const initialSeedQueryRef = useRef(host.seedQuery)
  const lastLocalInputRef = useRef(host.seedQuery)
  const hasReceivedListSurfaceRef = useRef(false)
  const listQueryThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextFormChangeIdRef = useRef(0)
  const syncInputAfterActionRef = useRef(false)
  const toastDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextToastIdRef = useRef(0)
  const [formState, dispatchFormState] = useReducer(
    runtimeFormStateReducer,
    undefined,
    createRuntimeFormState
  )
  const [inputText, setInputTextState] = useState(host.seedQuery)
  const [runtimeToast, setRuntimeToast] = useState<RuntimeToastState | null>(null)
  const [runtimeState, setRuntimeState] = useState<RuntimeSurfaceState>({
    error: null,
    sessionId: null,
    snapshot: null
  })

  const clearListQueryThrottleTimer = useCallback((): void => {
    if (!listQueryThrottleTimerRef.current) {
      return
    }

    clearTimeout(listQueryThrottleTimerRef.current)
    listQueryThrottleTimerRef.current = null
  }, [])

  const clearToastDismissTimer = useCallback((): void => {
    if (!toastDismissTimerRef.current) {
      return
    }

    clearTimeout(toastDismissTimerRef.current)
    toastDismissTimerRef.current = null
  }, [])

  const sendEvent = useCallback(
    (event: ExtensionRuntimeEvent): void => {
      if (!runtimeState.sessionId) {
        return
      }

      sendRuntimeExtensionEvent(runtimeState.sessionId, event)
    },
    [runtimeState.sessionId]
  )

  const dismissToast = useCallback((): void => {
    clearToastDismissTimer()
    setRuntimeToast(null)
  }, [clearToastDismissTimer])

  const showToast = useCallback(
    (toast: ExtensionToastPayload): void => {
      clearToastDismissTimer()
      const id = nextToastIdRef.current++
      setRuntimeToast({ id, toast })
      toastDismissTimerRef.current = setTimeout(() => {
        setRuntimeToast((current) => (current?.id === id ? null : current))
        toastDismissTimerRef.current = null
      }, RUNTIME_TOAST_DISMISS_MS)
    },
    [clearToastDismissTimer]
  )

  const executeToastAction = useCallback(
    (actionId: string): void => {
      sendEvent({
        actionId,
        type: "toast.action.execute"
      })
      dismissToast()
    },
    [dismissToast, sendEvent]
  )

  const setInputText = useCallback(
    (value: string, throttle: boolean): void => {
      lastLocalInputRef.current = value
      setInputTextState(value)
      clearListQueryThrottleTimer()

      if (!throttle) {
        sendEvent({ query: value, type: "list.query.change" })
        return
      }

      listQueryThrottleTimerRef.current = setTimeout(() => {
        listQueryThrottleTimerRef.current = null
        sendEvent({ query: value, type: "list.query.change" })
      }, RUNTIME_LIST_QUERY_THROTTLE_MS)
    },
    [clearListQueryThrottleTimer, sendEvent]
  )

  const executeAction = useCallback(
    (action: ExtensionActionNode): void => {
      const snapshot = runtimeState.snapshot
      if (!snapshot) {
        return
      }

      if (snapshot.kind === "list") {
        syncInputAfterActionRef.current = true
      }

      sendEvent({
        actionId: action.id,
        formValues:
          snapshot.kind === "form"
            ? createRuntimeFormValueOverrides({
                fields: snapshot.fields,
                localValues: formState.localValues
              })
            : undefined,
        revision: snapshot.revision,
        type: "action.execute"
      })
    },
    [formState.localValues, runtimeState.snapshot, sendEvent]
  )

  const setFormFieldValue = useCallback(
    (fieldId: string, value: RuntimeFormValue): void => {
      const changeId = `form-change-${nextFormChangeIdRef.current++}`
      dispatchFormState({ changeId, fieldId, type: "field.change", value })
      sendEvent({
        changeId,
        fieldId,
        type: "form.field.change",
        value
      })
    },
    [sendEvent]
  )

  const setFormDropdownSearch = useCallback(
    (fieldId: string, query: string): void => {
      sendEvent({
        fieldId,
        query,
        type: "form.dropdown.search"
      })
    },
    [sendEvent]
  )

  const navigateBack = useCallback((): void => {
    sendEvent({ type: "navigation.pop" })
  }, [sendEvent])

  const goHome = useCallback((): void => {
    navigation.goHome()
  }, [navigation])

  useEffect(() => {
    return window.api.extensionRuntime.subscribeSurfaces(
      (event) => {
        if (event.session.sessionId !== activeSessionIdRef.current) {
          return
        }

        setRuntimeState({
          error: null,
          sessionId: event.session.sessionId,
          snapshot: event.surface
        })

        if (event.surface.kind === "list") {
          const isFirstListSurface = !hasReceivedListSurfaceRef.current
          hasReceivedListSurfaceRef.current = true
          const localInputText = lastLocalInputRef.current
          const shouldSyncInput =
            syncInputAfterActionRef.current ||
            (isFirstListSurface && localInputText === initialSeedQueryRef.current) ||
            event.surface.searchText === localInputText
          if (shouldSyncInput) {
            syncInputAfterActionRef.current = false
            lastLocalInputRef.current = event.surface.searchText
            setInputTextState(event.surface.searchText)
          } else {
            sendRuntimeExtensionEvent(event.session.sessionId, {
              query: localInputText,
              type: "list.query.change"
            })
          }
        }

        if (event.surface.kind === "form") {
          dispatchFormState({
            fields: event.surface.fields,
            type: "surface.reconcile"
          })
        } else {
          dispatchFormState({ type: "reset" })
        }
      },
      (error) => {
        if (error.sessionId !== activeSessionIdRef.current) {
          return
        }

        setRuntimeState((current) => ({
          ...current,
          error: error.error.message
        }))
      }
    )
  }, [activeSessionIdRef])

  useEffect(() => {
    return window.api.extensionRuntime.subscribeNavigationRequests((event) => {
      if (event.sessionId !== activeSessionIdRef.current) {
        return
      }

      void handleRuntimeNavigationRequest(event, navigation)
    })
  }, [activeSessionIdRef, navigation])

  useEffect(() => {
    return window.api.extensionRuntime.subscribeToastRequests((event) => {
      if (event.sessionId === activeSessionIdRef.current) {
        showToast(event.toast)
      }
    })
  }, [activeSessionIdRef, showToast])

  useEffect(() => {
    return window.api.extensionRuntime.subscribeEventAcks((event) => {
      if (event.session.sessionId === activeSessionIdRef.current) {
        dispatchFormState({
          ack: event.ack,
          type: "field.ack"
        })
      }
    })
  }, [activeSessionIdRef])

  useEffect(() => {
    let cancelled = false
    const sessionId = createRuntimeSessionId()
    let launchIntent: ExtensionRuntimeLaunchIntent

    try {
      launchIntent = createRuntimeForegroundLaunchIntent(
        {
          commandName: host.commandName,
          extensionName: host.extensionName,
          initialAction: host.initialAction,
          ...(host.launchProps !== undefined ? { launchProps: host.launchProps } : {})
        },
        initialSeedQueryRef.current
      )
    } catch (error) {
      queueMicrotask(() => {
        if (!cancelled) {
          setRuntimeState({
            error: getRuntimeRequestErrorMessage(error),
            sessionId: null,
            snapshot: null
          })
        }
      })
      return () => {
        cancelled = true
      }
    }

    hasReceivedListSurfaceRef.current = false
    activeSessionIdRef.current = sessionId

    void window.api.extensionRuntime
      .startForeground({
        intent: launchIntent,
        sessionId
      })
      .then((session) => {
        if (cancelled) {
          void window.api.extensionRuntime.stopForeground(session.sessionId)
          return
        }

        nextFormChangeIdRef.current = 0
        dispatchFormState({ type: "reset" })
        clearListQueryThrottleTimer()
        setRuntimeState((current) => {
          if (current.sessionId === session.sessionId) {
            return current
          }

          return {
            error: null,
            sessionId: session.sessionId,
            snapshot: null
          }
        })
      })
      .catch((error) => {
        if (!cancelled) {
          setRuntimeState({
            error: getRuntimeRequestErrorMessage(error),
            sessionId: null,
            snapshot: null
          })
        }
      })

    return () => {
      cancelled = true
      clearListQueryThrottleTimer()
      clearToastDismissTimer()
      setRuntimeToast(null)
      void window.api.extensionRuntime.stopForeground(sessionId)
      activeSessionIdRef.current = null
    }
  }, [
    activeSessionIdRef,
    clearListQueryThrottleTimer,
    clearToastDismissTimer,
    host.commandName,
    host.extensionName,
    host.initialAction,
    host.launchProps
  ])

  const listSnapshot = runtimeState.snapshot?.kind === "list" ? runtimeState.snapshot : null
  const listDropdownProjection = projectRuntimeListDropdown(listSnapshot)

  return {
    dismissToast,
    executeAction,
    executeToastAction,
    formLocalValues: formState.localValues,
    goHome,
    inputText,
    listDropdownProjection,
    navigateBack,
    runtimeState,
    runtimeToast,
    sendEvent,
    setFormDropdownSearch,
    setFormFieldValue,
    setInputText,
    surfaceError: runtimeState.error
  }
}

export function sendRuntimeExtensionEvent(sessionId: string, event: ExtensionRuntimeEvent): void {
  void window.api.extensionRuntime.sendEvent(sessionId, event)
}

export function openRuntimeExternalTarget(target: RuntimeOpenExternalTarget): void {
  void window.electron.openExternal(target)
}

function createRuntimeSessionId(): string {
  return crypto.randomUUID()
}

function createRuntimeFormState(): RuntimeFormState {
  return {
    localValues: {},
    pendingValues: new Map()
  }
}

function runtimeFormStateReducer(
  state: RuntimeFormState,
  action: RuntimeFormStateAction
): RuntimeFormState {
  if (action.type === "reset") {
    return Object.keys(state.localValues).length === 0 && state.pendingValues.size === 0
      ? state
      : createRuntimeFormState()
  }

  if (action.type === "surface.reconcile") {
    const reconciled = reconcileRuntimeFormLocalValues({
      fields: action.fields,
      localValues: state.localValues,
      pendingValues: state.pendingValues
    })

    if (
      reconciled.localValues === state.localValues &&
      reconciled.pendingValues === state.pendingValues
    ) {
      return state
    }

    return reconciled
  }

  if (action.type === "field.ack") {
    return acknowledgeRuntimeFormLocalValue({
      changeId: action.ack.changeId,
      fieldId: action.ack.fieldId,
      localValues: state.localValues,
      pendingValues: state.pendingValues
    })
  }

  const pendingValues = new Map(state.pendingValues)
  pendingValues.set(action.fieldId, {
    changeId: action.changeId,
    value: action.value
  })

  return {
    localValues: Object.is(state.localValues[action.fieldId], action.value)
      ? state.localValues
      : {
          ...state.localValues,
          [action.fieldId]: action.value
        },
    pendingValues
  }
}

function getRuntimeRequestErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function projectRuntimeOpenExternalTarget(
  value: string | undefined
): RuntimeOpenExternalTarget | null {
  if (!value) {
    return null
  }

  try {
    const url = new URL(value)
    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:" &&
      url.protocol !== "mailto:" &&
      url.protocol !== "tel:"
    ) {
      return null
    }
  } catch {
    return null
  }

  return value as RuntimeOpenExternalTarget
}

function runtimeListItemMatchesQuery(
  item: ExtensionListItemNode,
  normalizedQuery: string
): boolean {
  if (!normalizedQuery) {
    return true
  }

  return [item.title, item.subtitle ?? "", ...item.keywords]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery)
}
