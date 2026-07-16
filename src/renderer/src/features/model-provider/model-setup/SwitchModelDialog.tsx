import { useEffect, useReducer } from "react"
import { Loader2, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import {
  SettingsField,
  SettingsSelect,
  SettingsTextInput,
  secondaryButtonClassName
} from "@/settings/settings-ui"
import type { ProviderId, ThinkingEffort } from "@shared/app-types"
import type { ModelSetupModel, ModelSetupProvider, ModelSetupSnapshot } from "@shared/model-setup"
import { InlineError } from "./ProviderSetupPages"
import { projectReasoningEffortSelection } from "./model-setup-projection"
import type { ModelSetupCommands } from "./useModelSetupController"

const CONFIGURE_PROVIDER_OPTION = "__jingle_configure_provider__"
const UNLISTED_MODEL_OPTION = "__jingle_unlisted_model__"

const THINKING_EFFORT_OPTIONS: Array<{ label: string; value: ThinkingEffort }> = [
  { label: "Off - No extended thinking", value: "off" },
  { label: "Low - Minimal thinking, fastest responses", value: "low" },
  { label: "Medium - Moderate thinking", value: "medium" },
  { label: "High - Deep reasoning (default)", value: "high" },
  { label: "Extra high - More reasoning", value: "xhigh" },
  { label: "Max - No constraints on thinking depth", value: "max" }
]

export function SwitchModelDialog(props: {
  commands: ModelSetupCommands
  initialProviderId: ProviderId | null
  onConfigureProviders: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  snapshot: ModelSetupSnapshot
}): React.JSX.Element | null {
  const { commands, initialProviderId, onConfigureProviders, onOpenChange, open, snapshot } = props
  const providerOptions = snapshot.providers
    .filter(
      (provider) =>
        provider.customConfiguration.status === "active" || provider.id === initialProviderId
    )
    .toSorted((left, right) => left.name.localeCompare(right.name))

  if (!open) {
    return null
  }

  return (
    <SwitchModelDialogContent
      commands={commands}
      initialSelectedProviderId={getInitialSelectedProviderId({
        currentModel: snapshot.defaultModel,
        initialProviderId,
        providerOptions
      })}
      providerOptions={providerOptions}
      snapshot={snapshot}
      onConfigureProviders={onConfigureProviders}
      onOpenChange={onOpenChange}
    />
  )
}

interface SwitchModelDialogState {
  customModelName: string
  interactionError: string | null
  loadingModels: boolean
  modelLoadFailed: boolean
  providerModelIds: string[]
  providerLoadError: string | null
  saving: boolean
  selectedModelValue: string
  selectedProviderId: ProviderId
  thinkingEffort: ThinkingEffort | null
  unlistedModelEfforts: ThinkingEffort[] | null
}

type SwitchModelDialogAction =
  | { type: "select-provider"; providerId: ProviderId }
  | { type: "select-model"; modelValue: string }
  | { type: "set-custom-model-name"; modelName: string }
  | { type: "set-thinking-effort"; thinkingEffort: ThinkingEffort }
  | { type: "clear-thinking-effort" }
  | {
      type: "resolve-unlisted-success"
      modelName: string
      providerId: ProviderId
      supportedEfforts: ThinkingEffort[]
    }
  | {
      type: "resolve-unlisted-failure"
      errorText: string
      modelName: string
      providerId: ProviderId
    }
  | {
      type: "load-success"
      customModelName: string
      errorText: string | null
      modelIds: string[]
      selectedModelValue: string
      unlistedModelEfforts: ThinkingEffort[] | null
    }
  | {
      type: "load-failure"
      errorText: string
    }
  | { type: "save-start" }
  | { type: "save-success" }
  | { type: "save-failure"; errorText: string }

function switchModelDialogReducer(
  state: SwitchModelDialogState,
  action: SwitchModelDialogAction
): SwitchModelDialogState {
  switch (action.type) {
    case "select-provider":
      return {
        ...state,
        customModelName: "",
        interactionError: null,
        loadingModels: true,
        modelLoadFailed: false,
        providerModelIds: [],
        providerLoadError: null,
        selectedModelValue: "",
        selectedProviderId: action.providerId,
        unlistedModelEfforts: null
      }
    case "select-model":
      return {
        ...state,
        customModelName: action.modelValue === UNLISTED_MODEL_OPTION ? state.customModelName : "",
        interactionError: null,
        selectedModelValue: action.modelValue,
        unlistedModelEfforts:
          action.modelValue === UNLISTED_MODEL_OPTION ? state.unlistedModelEfforts : null
      }
    case "set-custom-model-name":
      return {
        ...state,
        customModelName: action.modelName,
        interactionError: null,
        unlistedModelEfforts: null
      }
    case "set-thinking-effort":
      return {
        ...state,
        thinkingEffort: action.thinkingEffort
      }
    case "clear-thinking-effort":
      return {
        ...state,
        thinkingEffort: null
      }
    case "resolve-unlisted-success":
      if (
        state.selectedProviderId !== action.providerId ||
        state.customModelName !== action.modelName
      ) {
        return state
      }
      return {
        ...state,
        interactionError: null,
        unlistedModelEfforts: action.supportedEfforts
      }
    case "resolve-unlisted-failure":
      if (
        state.selectedProviderId !== action.providerId ||
        state.customModelName !== action.modelName
      ) {
        return state
      }
      return {
        ...state,
        interactionError: action.errorText,
        unlistedModelEfforts: null
      }
    case "load-success":
      return {
        ...state,
        customModelName: action.customModelName,
        interactionError: null,
        loadingModels: false,
        modelLoadFailed: false,
        providerModelIds: action.modelIds,
        providerLoadError: action.errorText,
        selectedModelValue: action.selectedModelValue,
        unlistedModelEfforts: action.unlistedModelEfforts
      }
    case "load-failure":
      return {
        ...state,
        customModelName: "",
        interactionError: null,
        loadingModels: false,
        modelLoadFailed: true,
        providerModelIds: [],
        providerLoadError: action.errorText,
        selectedModelValue: "",
        unlistedModelEfforts: null
      }
    case "save-start":
      return {
        ...state,
        interactionError: null,
        saving: true
      }
    case "save-success":
      return {
        ...state,
        saving: false
      }
    case "save-failure":
      return {
        ...state,
        interactionError: action.errorText,
        saving: false
      }
  }
}

function SwitchModelDialogContent(props: {
  commands: ModelSetupCommands
  initialSelectedProviderId: ProviderId
  onConfigureProviders: () => void
  onOpenChange: (open: boolean) => void
  providerOptions: ModelSetupProvider[]
  snapshot: ModelSetupSnapshot
}): React.JSX.Element {
  const { copy } = useI18n()
  const {
    commands,
    initialSelectedProviderId,
    onConfigureProviders,
    onOpenChange,
    providerOptions,
    snapshot
  } = props
  const [dialogState, dispatchDialog] = useReducer(switchModelDialogReducer, {
    customModelName: "",
    interactionError: null,
    loadingModels: Boolean(initialSelectedProviderId),
    modelLoadFailed: false,
    providerModelIds: [],
    providerLoadError: null,
    saving: false,
    selectedModelValue: "",
    selectedProviderId: initialSelectedProviderId,
    thinkingEffort: snapshot.defaultModelOptions.thinkingEffort ?? null,
    unlistedModelEfforts: null
  })
  const {
    customModelName,
    interactionError,
    loadingModels,
    modelLoadFailed,
    providerModelIds,
    providerLoadError,
    saving,
    selectedModelValue,
    selectedProviderId,
    thinkingEffort,
    unlistedModelEfforts
  } = dialogState
  const selectedProvider =
    snapshot.providers.find((provider) => provider.id === selectedProviderId) ?? null
  const providerModels = providerModelIds.map((modelId) =>
    requireSnapshotModel(snapshot.models, modelId)
  )
  const customMode = selectedModelValue === UNLISTED_MODEL_OPTION
  const selectedModelConfig = customMode
    ? null
    : (providerModels.find((model) => model.id === selectedModelValue) ?? null)
  const selectedModelName = customMode ? customModelName.trim() : selectedModelConfig?.model
  const supportedThinkingEfforts = customMode
    ? (unlistedModelEfforts ?? [])
    : (selectedModelConfig?.reasoningCapability.allowedValues ?? [])
  const reasoningEffortSelection = projectReasoningEffortSelection({
    allowedValues: supportedThinkingEfforts,
    selectedValue: thinkingEffort
  })
  const reasoningEnabled = supportedThinkingEfforts.length > 0
  const invalidStoredEffort =
    reasoningEffortSelection.invalidSelectedValue !== null
      ? `当前模型不支持已保存的思考努力：${reasoningEffortSelection.invalidSelectedValue}。请重新选择。`
      : null
  const canUseUnlisted =
    selectedProvider?.configurateMethods.includes("customizable-model") === true
  const canSave = Boolean(
    selectedProviderId &&
    selectedModelName &&
    !loadingModels &&
    !modelLoadFailed &&
    !saving &&
    !invalidStoredEffort &&
    (!reasoningEnabled || thinkingEffort !== null) &&
    (customMode ? unlistedModelEfforts !== null : Boolean(selectedModelConfig))
  )

  useEffect(() => {
    if (!selectedProviderId) {
      return
    }

    let cancelled = false
    async function loadModels(): Promise<void> {
      try {
        const result = await commands.refreshProviderModels(selectedProviderId)
        if (cancelled) {
          return
        }
        if (result.providerId !== selectedProviderId) {
          throw new Error(
            `Refreshed model provider does not match the request: ${result.providerId}`
          )
        }
        const refreshedProvider = requireSnapshotProvider(
          result.snapshot.providers,
          result.providerId
        )
        const refreshedModels = result.modelIds.map((modelId) =>
          requireSnapshotModel(result.snapshot.models, modelId)
        )
        const refreshedDefaultModel = result.snapshot.defaultModel
        const selection = getSelectionAfterLoad({
          canUseUnlisted: refreshedProvider.configurateMethods.includes("customizable-model"),
          currentModelId: refreshedDefaultModel.id,
          currentModelName: refreshedDefaultModel.model,
          currentModelEfforts: refreshedDefaultModel.reasoningCapability.allowedValues,
          currentProviderId: refreshedDefaultModel.provider,
          models: refreshedModels,
          selectedProviderId
        })
        dispatchDialog({
          customModelName: selection.customModelName,
          errorText: getProviderModelListError(refreshedProvider),
          modelIds: result.modelIds,
          selectedModelValue: selection.selectedModelValue,
          unlistedModelEfforts: selection.unlistedModelEfforts,
          type: "load-success"
        })
      } catch (loadError) {
        if (!cancelled) {
          dispatchDialog({
            errorText: getErrorMessage(loadError),
            type: "load-failure"
          })
        }
      }
    }

    void loadModels()
    return () => {
      cancelled = true
    }
  }, [commands, selectedProviderId])

  function handleCustomModelNameChange(modelName: string): void {
    const providerId = selectedProviderId
    dispatchDialog({ modelName, type: "set-custom-model-name" })
    if (!modelName.trim()) {
      return
    }

    void commands
      .resolveUnlistedModel(providerId, modelName)
      .then((metadata) => {
        if (metadata.providerId !== providerId) {
          throw new Error(
            `Resolved unlisted model provider does not match the request: ${metadata.providerId}`
          )
        }
        dispatchDialog({
          modelName,
          providerId,
          supportedEfforts: metadata.reasoningCapability.allowedValues,
          type: "resolve-unlisted-success"
        })
      })
      .catch((resolveError: unknown) => {
        dispatchDialog({
          errorText: getErrorMessage(resolveError),
          modelName,
          providerId,
          type: "resolve-unlisted-failure"
        })
      })
  }

  async function handleSave(): Promise<void> {
    if (!canSave || !selectedModelName) {
      return
    }

    dispatchDialog({ type: "save-start" })
    try {
      const result = await commands.selectDefaultModel(
        customMode
          ? {
              kind: "unlisted",
              modelName: selectedModelName,
              providerId: selectedProviderId,
              thinkingEffort: reasoningEnabled ? thinkingEffort : null
            }
          : {
              kind: "listed",
              modelId: requireSelectedModel(selectedModelConfig).id,
              thinkingEffort: reasoningEnabled ? thinkingEffort : null
            }
      )
      dispatchDialog({ type: "save-success" })
      if (!result.snapshotReady) {
        onOpenChange(false)
        return
      }
      onOpenChange(false)
    } catch (saveError) {
      dispatchDialog({
        errorText: getErrorMessage(saveError),
        type: "save-failure"
      })
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && saving) {
          return
        }
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent
        className="w-[var(--jingle-dialog-mobile-w)] rounded-[var(--jingle-radius-dialog)] sm:max-w-[500px] sm:rounded-[var(--jingle-radius-dialog)]"
        closeLabel={copy.common.close}
      >
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-[var(--jingle-space-2)]">
            <SlidersHorizontal className="h-4 w-4" />
            设置新线程默认模型
          </DialogTitle>
          <DialogDescription>
            选择后会用于之后新建的对话；当前已有对话请在对话顶部切换。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-[var(--jingle-space-3)]">
          <SettingsSelect
            value={selectedProviderId}
            disabled={saving}
            onChange={(event) => {
              if (event.target.value === CONFIGURE_PROVIDER_OPTION) {
                onConfigureProviders()
                return
              }
              dispatchDialog({
                providerId: event.target.value,
                type: "select-provider"
              })
            }}
          >
            {providerOptions.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
            <option value={CONFIGURE_PROVIDER_OPTION}>Use other provider</option>
          </SettingsSelect>

          <SettingsSelect
            value={selectedModelValue}
            disabled={!selectedProviderId || loadingModels || modelLoadFailed || saving}
            onChange={(event) => {
              dispatchDialog({
                modelValue: event.target.value,
                type: "select-model"
              })
            }}
          >
            {loadingModels ? <option value="">读取模型</option> : null}
            {!loadingModels && providerModels.length === 0 ? (
              <option value="">{canUseUnlisted ? "选择或输入模型" : "无可用模型"}</option>
            ) : null}
            {providerModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
            {canUseUnlisted ? (
              <option value={UNLISTED_MODEL_OPTION}>输入未列出的模型...</option>
            ) : null}
          </SettingsSelect>

          {customMode ? (
            <SettingsTextInput
              value={customModelName}
              disabled={saving}
              placeholder="gpt-5.5"
              onChange={(event) => handleCustomModelNameChange(event.target.value)}
            />
          ) : null}

          {reasoningEnabled ? (
            <SettingsField label="思考努力">
              <SettingsSelect
                value={thinkingEffort ?? ""}
                disabled={saving}
                onChange={(event) =>
                  dispatchDialog({
                    thinkingEffort: event.target.value as ThinkingEffort,
                    type: "set-thinking-effort"
                  })
                }
              >
                <option value="" disabled>
                  请选择思考努力
                </option>
                {THINKING_EFFORT_OPTIONS.filter((option) =>
                  supportedThinkingEfforts.includes(option.value)
                ).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SettingsSelect>
            </SettingsField>
          ) : null}

          {providerLoadError ? <InlineError text={providerLoadError} /> : null}
          {invalidStoredEffort ? <InlineError text={invalidStoredEffort} /> : null}
          {invalidStoredEffort && supportedThinkingEfforts.length === 0 ? (
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => dispatchDialog({ type: "clear-thinking-effort" })}
            >
              清除不支持的思考努力配置
            </Button>
          ) : null}
          {interactionError ? <InlineError text={interactionError} /> : null}

          <div className="flex items-center justify-between gap-[var(--jingle-space-3)] pt-[var(--jingle-space-2)]">
            <button
              type="button"
              className={secondaryButtonClassName}
              disabled={saving}
              onClick={onConfigureProviders}
            >
              Provider
            </button>
            <div className="flex items-center gap-[var(--jingle-space-2)]">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
              <Button type="button" disabled={!canSave} onClick={handleSave}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "选择模型"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function getInitialSelectedProviderId(input: {
  currentModel: ModelSetupModel
  initialProviderId: ProviderId | null
  providerOptions: ModelSetupProvider[]
}): ProviderId {
  if (input.initialProviderId) {
    return input.initialProviderId
  }
  if (input.providerOptions.some((provider) => provider.id === input.currentModel.provider)) {
    return input.currentModel.provider
  }

  return input.providerOptions[0]?.id ?? ""
}

function getSelectionAfterLoad(input: {
  canUseUnlisted: boolean
  currentModelId: string
  currentModelName: string
  currentModelEfforts: ThinkingEffort[]
  currentProviderId: ProviderId
  models: ModelSetupModel[]
  selectedProviderId: ProviderId
}): {
  customModelName: string
  selectedModelValue: string
  unlistedModelEfforts: ThinkingEffort[] | null
} {
  if (input.currentProviderId === input.selectedProviderId) {
    const currentModel = input.models.find((model) => model.id === input.currentModelId)
    if (currentModel) {
      return {
        customModelName: "",
        selectedModelValue: currentModel.id,
        unlistedModelEfforts: null
      }
    }
    if (input.canUseUnlisted) {
      return {
        customModelName: input.currentModelName,
        selectedModelValue: UNLISTED_MODEL_OPTION,
        unlistedModelEfforts: input.currentModelEfforts
      }
    }
  }

  return {
    customModelName: "",
    selectedModelValue: input.models[0]?.id ?? "",
    unlistedModelEfforts: null
  }
}

function getProviderModelListError(provider: ModelSetupProvider): string | null {
  if (provider.modelListStatus !== "error") {
    return null
  }
  if (!provider.modelListError) {
    throw new Error(`Provider model list error is missing: ${provider.id}`)
  }

  return provider.modelListError
}

function requireSelectedModel(model: ModelSetupModel | null): ModelSetupModel {
  if (!model) {
    throw new Error("Selected model is missing from the provider model list.")
  }

  return model
}

function requireSnapshotModel(models: ModelSetupModel[], modelId: string): ModelSetupModel {
  const model = models.find((candidate) => candidate.id === modelId)
  if (!model) {
    throw new Error(`Refreshed model is missing from the setup snapshot: ${modelId}`)
  }

  return model
}

function requireSnapshotProvider(
  providers: ModelSetupProvider[],
  providerId: ProviderId
): ModelSetupProvider {
  const provider = providers.find((candidate) => candidate.id === providerId)
  if (!provider) {
    throw new Error(`Refreshed provider is missing from the setup snapshot: ${providerId}`)
  }

  return provider
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
