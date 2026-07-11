import { RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ModelSetupSurface } from "@/features/model-provider/model-setup/ModelSetupSurface"
import { InlineError } from "@/features/model-provider/model-setup/ProviderSetupPages"
import { useModelSetupController } from "@/features/model-provider/model-setup/useModelSetupController"
import type { ProviderId } from "@shared/app-types"
import type { ModelSetupProvider } from "@shared/model-setup"
import type { SettingsWindowTarget } from "@shared/settings-window"

type ProviderTabProps = {
  focusTarget: SettingsWindowTarget | null
  onFocusTargetConsumed: () => void
}

function ProviderTabSkeleton(): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[var(--ow-settings-content-max-width)] space-y-[var(--ow-space-4)]">
      <div className="h-[var(--ow-settings-provider-skeleton-lg)] animate-pulse rounded-[var(--ow-radius-panel)] border border-border/70 bg-background-secondary/70" />
      <div className="h-[var(--ow-settings-provider-skeleton-md)] animate-pulse rounded-[var(--ow-radius-panel)] border border-dashed border-border/80 bg-background-secondary/45" />
      <div className="space-y-[var(--ow-space-2)]">
        <div className="h-[var(--ow-settings-provider-skeleton-sm)] animate-pulse rounded-[var(--ow-radius-panel)] border border-border/80 bg-background-elevated/70" />
        <div className="h-[var(--ow-settings-provider-skeleton-sm)] animate-pulse rounded-[var(--ow-radius-panel)] border border-border/80 bg-background-elevated/70" />
      </div>
    </div>
  )
}

function ProviderTabError(props: {
  error: string
  loading: boolean
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div className="space-y-[var(--ow-space-3)]">
      <InlineError text={props.error} />
      <Button type="button" variant="outline" disabled={props.loading} onClick={props.onRetry}>
        <RotateCw className={props.loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        重试
      </Button>
    </div>
  )
}

export function ProviderTab(props: ProviderTabProps): React.JSX.Element {
  const { focusTarget, onFocusTargetConsumed } = props
  const controller = useModelSetupController()

  if (controller.loading && !controller.snapshot) {
    return <ProviderTabSkeleton />
  }
  if (!controller.snapshot) {
    if (!controller.error) {
      throw new Error("Model setup controller finished without a snapshot or an error.")
    }
    return (
      <div className="mx-auto w-full max-w-[var(--ow-settings-content-max-width)]">
        <ProviderTabError
          error={controller.error}
          loading={controller.loading}
          onRetry={() => void controller.reload()}
        />
      </div>
    )
  }

  const focusProviderId = getValidFocusProviderId(focusTarget, controller.snapshot.providers)

  return (
    <div className="mx-auto w-full max-w-[var(--ow-settings-content-max-width)]">
      <ModelSetupSurface
        commands={controller.commands}
        focusProviderId={focusProviderId}
        snapshot={controller.snapshot}
        variant="settings"
        onFocusProviderConsumed={onFocusTargetConsumed}
      />
      {controller.error ? (
        <div className="mt-[var(--ow-space-3)]">
          <ProviderTabError
            error={controller.error}
            loading={controller.loading}
            onRetry={() => void controller.reload()}
          />
        </div>
      ) : null}
    </div>
  )
}

function getValidFocusProviderId(
  focusTarget: SettingsWindowTarget | null,
  providers: ModelSetupProvider[]
): ProviderId | null {
  if (!focusTarget?.providerId) {
    return null
  }

  return providers.some((provider) => provider.id === focusTarget.providerId)
    ? focusTarget.providerId
    : null
}
