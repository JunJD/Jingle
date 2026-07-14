import { useReducer, useRef } from "react"
import { ProviderLogo } from "@/components/model-provider-logo"
import { cn } from "@/lib/utils"
import type { ProviderId } from "@shared/app-types"
import type { ModelSetupProvider, ModelSetupSnapshot } from "@shared/model-setup"
import { CustomProviderForm } from "./CustomProviderForm"
import { ProviderEditorDialogs, type ProviderEditorState } from "./ProviderEditorDialogs"
import {
  CurrentModelPanel,
  FreeProviderGrid,
  LandingChoices,
  ProviderSettingsPage
} from "./ProviderSetupPages"
import { SwitchModelDialog } from "./SwitchModelDialog"
import { projectModelSetupSnapshot, type ModelSetupVariant } from "./model-setup-projection"
import type { ModelSetupCommands } from "./useModelSetupController"

type SetupMode = "landing" | "settings-home" | "free" | "providers" | "custom"

interface ModelSetupSurfaceState {
  editor: ProviderEditorState
  editorLoadingProviderId: ProviderId | null
  mode: SetupMode
  providerPageError: string | null
  query: string
  switchInitialProviderId: ProviderId | null
  switchOpen: boolean
}

type ModelSetupSurfaceAction =
  | { type: "set-mode"; mode: SetupMode }
  | { type: "set-query"; query: string }
  | { type: "set-switch-open"; open: boolean }
  | { type: "open-switch"; providerId: ProviderId | null }
  | { type: "set-editor"; editor: ProviderEditorState }
  | { type: "set-editor-loading-provider"; providerId: ProviderId | null }
  | { type: "set-provider-page-error"; error: string | null }

function getInitialSetupMode(variant: ModelSetupVariant): SetupMode {
  return variant === "onboarding" ? "landing" : "settings-home"
}

function createModelSetupSurfaceState(variant: ModelSetupVariant): ModelSetupSurfaceState {
  return {
    editor: { kind: "closed" },
    editorLoadingProviderId: null,
    mode: getInitialSetupMode(variant),
    providerPageError: null,
    query: "",
    switchInitialProviderId: null,
    switchOpen: false
  }
}

function modelSetupSurfaceReducer(
  state: ModelSetupSurfaceState,
  action: ModelSetupSurfaceAction
): ModelSetupSurfaceState {
  switch (action.type) {
    case "set-mode":
      return { ...state, mode: action.mode }
    case "set-query":
      return { ...state, query: action.query }
    case "set-switch-open":
      return { ...state, switchOpen: action.open }
    case "open-switch":
      return {
        ...state,
        switchInitialProviderId: action.providerId,
        switchOpen: true
      }
    case "set-editor":
      return { ...state, editor: action.editor }
    case "set-editor-loading-provider":
      return { ...state, editorLoadingProviderId: action.providerId }
    case "set-provider-page-error":
      return { ...state, providerPageError: action.error }
  }
}

export interface ModelSetupSurfaceProps {
  commands: ModelSetupCommands
  focusProviderId?: ProviderId | null
  onFocusProviderConsumed?: () => void
  snapshot: ModelSetupSnapshot
  title?: string
  variant: ModelSetupVariant
}

export function ModelSetupSurface(props: ModelSetupSurfaceProps): React.JSX.Element {
  const {
    commands,
    focusProviderId,
    onFocusProviderConsumed,
    snapshot,
    title = "欢迎使用金果",
    variant
  } = props
  const [surfaceState, dispatchSurface] = useReducer(
    modelSetupSurfaceReducer,
    variant,
    createModelSetupSurfaceState
  )
  const providerEditorRequestIdRef = useRef(0)
  const {
    editor,
    editorLoadingProviderId,
    mode,
    providerPageError,
    query,
    switchInitialProviderId,
    switchOpen
  } = surfaceState
  const focusedProvider = focusProviderId
    ? (snapshot.providers.find((provider) => provider.id === focusProviderId) ?? null)
    : null
  const effectiveMode: SetupMode = focusedProvider ? "providers" : mode
  const projection = projectModelSetupSnapshot({ query, snapshot, variant })

  function cancelProviderEditorRequest(): void {
    providerEditorRequestIdRef.current += 1
    dispatchSurface({ providerId: null, type: "set-editor-loading-provider" })
  }

  function openSwitchDialog(providerId?: ProviderId | null): void {
    cancelProviderEditorRequest()
    dispatchSurface({
      providerId: resolveSwitchInitialProviderId({
        currentProvider: projection.currentProvider,
        requestedProviderId: providerId
      }),
      type: "open-switch"
    })
  }

  function handleProviderConfigured(providerId: ProviderId): void {
    dispatchSurface({ providerId, type: "open-switch" })
  }

  function closeProviderEditor(): void {
    cancelProviderEditorRequest()
    dispatchSurface({ editor: { kind: "closed" }, type: "set-editor" })
  }

  function closeProviderSettingsPage(): void {
    cancelProviderEditorRequest()
    onFocusProviderConsumed?.()
    dispatchSurface({ error: null, type: "set-provider-page-error" })
    dispatchSurface({
      mode: getInitialSetupMode(variant),
      type: "set-mode"
    })
  }

  async function openProviderEditor(provider: ModelSetupProvider): Promise<void> {
    const requestId = providerEditorRequestIdRef.current + 1
    providerEditorRequestIdRef.current = requestId
    onFocusProviderConsumed?.()
    dispatchSurface({ error: null, type: "set-provider-page-error" })

    if (provider.source === "custom") {
      dispatchSurface({ providerId: provider.id, type: "set-editor-loading-provider" })
      try {
        const config = await commands.getCustomProvider(provider.id)
        if (!config) {
          throw new Error(`Custom provider is not configured: ${provider.name}`)
        }
        if (providerEditorRequestIdRef.current !== requestId) {
          return
        }
        dispatchSurface({
          editor: { config, kind: "custom", providerId: provider.id },
          type: "set-editor"
        })
      } catch (error) {
        if (providerEditorRequestIdRef.current === requestId) {
          dispatchSurface({
            error: error instanceof Error ? error.message : String(error),
            type: "set-provider-page-error"
          })
        }
      } finally {
        if (providerEditorRequestIdRef.current === requestId) {
          dispatchSurface({ providerId: null, type: "set-editor-loading-provider" })
        }
      }
      return
    }

    if (provider.providerCredentialSchema.credentialFormSchemas.length > 0) {
      dispatchSurface({
        editor: { kind: "credentials", providerId: provider.id },
        type: "set-editor"
      })
      return
    }

    dispatchSurface({
      editor: { kind: "activation", providerId: provider.id },
      type: "set-editor"
    })
  }

  return (
    <div className={cn("w-full", variant === "onboarding" ? "min-h-screen bg-background" : "")}>
      <div
        className={cn(
          "mx-auto w-full",
          variant === "onboarding"
            ? "max-w-[860px] px-[calc(var(--window-controls-offset-inline)+18px)] pb-16 pt-[120px]"
            : "max-w-[1024px] space-y-[var(--jingle-space-5)]"
        )}
      >
        {variant === "onboarding" && (
          <div className="mb-[var(--jingle-space-7)]">
            <div className="mb-[var(--jingle-space-4)] flex h-7 w-7 items-center justify-center text-foreground">
              <ProviderLogo providerId="codex" className="h-5 w-5" />
            </div>
            <h1 className="[font-size:32px] font-normal leading-tight tracking-normal text-foreground">
              {title}
            </h1>
            <p className="mt-[var(--jingle-space-3)] [font-size:17px] leading-[var(--jingle-line-body)] text-muted-foreground">
              你的本地 AI agent。连接 AI 模型提供商即可开始。
            </p>
          </div>
        )}

        {variant === "settings" && effectiveMode === "settings-home" ? (
          <CurrentModelPanel
            currentModel={projection.currentModel}
            currentProvider={projection.currentProvider}
            onConfigureProvider={() => dispatchSurface({ mode: "providers", type: "set-mode" })}
            onSwitchModels={() => openSwitchDialog()}
          />
        ) : null}

        {effectiveMode === "landing" ? (
          <LandingChoices
            onChooseFree={() => dispatchSurface({ mode: "free", type: "set-mode" })}
            onChooseProvider={() => dispatchSurface({ mode: "providers", type: "set-mode" })}
          />
        ) : null}

        {effectiveMode === "free" ? (
          <FreeProviderGrid
            defaultModelId={snapshot.defaultModel.id}
            models={snapshot.models}
            providers={projection.freeProviders}
            onBack={() => dispatchSurface({ mode: "landing", type: "set-mode" })}
            onConfigureProvider={(providerId) => {
              const provider = snapshot.providers.find((item) => item.id === providerId)
              if (provider) {
                void openProviderEditor(provider)
              }
            }}
          />
        ) : null}

        {effectiveMode === "providers" ? (
          <ProviderSettingsPage
            editorLoadingProviderId={editorLoadingProviderId}
            errorText={providerPageError}
            models={snapshot.models}
            providers={projection.visibleProviders}
            query={query}
            title="提供商配置项"
            onAddCustom={() => {
              cancelProviderEditorRequest()
              onFocusProviderConsumed?.()
              dispatchSurface({ error: null, type: "set-provider-page-error" })
              dispatchSurface({ mode: "custom", type: "set-mode" })
            }}
            onBack={closeProviderSettingsPage}
            onConfigureProvider={(provider) => void openProviderEditor(provider)}
            onQueryChange={(nextQuery) => dispatchSurface({ query: nextQuery, type: "set-query" })}
            onSwitchModel={(providerId) => openSwitchDialog(providerId)}
          />
        ) : null}

        {effectiveMode === "custom" ? (
          <CustomProviderForm
            modelProviderPaths={snapshot.modelProviderPaths}
            onBack={() => dispatchSurface({ mode: "providers", type: "set-mode" })}
            onSubmit={async (input) => {
              const result = await commands.upsertCustomProvider(input)
              if (result.snapshotReady) {
                handleProviderConfigured(result.providerId)
              }
              dispatchSurface({ mode: "providers", type: "set-mode" })
            }}
            submitLabel="保存 provider"
            title="添加自定义 provider"
          />
        ) : null}
      </div>

      <SwitchModelDialog
        commands={commands}
        initialProviderId={switchInitialProviderId}
        open={switchOpen}
        snapshot={snapshot}
        onConfigureProviders={() => {
          dispatchSurface({ open: false, type: "set-switch-open" })
          dispatchSurface({ mode: "providers", type: "set-mode" })
        }}
        onOpenChange={(open) => dispatchSurface({ open, type: "set-switch-open" })}
      />

      <ProviderEditorDialogs
        activeProviderId={snapshot.activeProviderId}
        commands={commands}
        editor={editor}
        modelProviderPaths={snapshot.modelProviderPaths}
        providers={snapshot.providers}
        onClose={closeProviderEditor}
        onConfigured={handleProviderConfigured}
      />
    </div>
  )
}

function resolveSwitchInitialProviderId(input: {
  currentProvider: ModelSetupProvider
  requestedProviderId?: ProviderId | null
}): ProviderId | null {
  if (input.requestedProviderId) {
    return input.requestedProviderId
  }
  return input.currentProvider.id
}
