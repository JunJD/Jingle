import { AlertTriangle, Gauge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ReasoningEffortPicker } from "@/features/model-selection/ReasoningEffortPicker"
import { useI18n } from "@/lib/i18n"
import { MODEL_RUNTIME_SELECTION_VERSION } from "@shared/model-runtime-selection"
import type { LauncherApprovalModelRecoveryProjection } from "./launcher-ai-controller"

export function LauncherAiResumeModelRecovery(props: {
  onSelect: (selection: {
    modelId: string
    thinkingEffort: import("@shared/app-types").ThinkingEffort | null
    version: 1
  }) => void
  projection: Exclude<LauncherApprovalModelRecoveryProjection, { kind: "not_required" }>
}): React.JSX.Element {
  const { copy } = useI18n()
  const { projection } = props
  if (projection.kind === "loading") {
    return (
      <div className="flex min-h-10 items-center gap-[var(--jingle-gap-sm)] border-t border-border/60 px-[var(--jingle-space-3)] py-[var(--jingle-space-2)] text-muted-foreground">
        <Gauge className="size-[var(--jingle-icon-sm)] shrink-0" />
        <span className="[font-size:var(--jingle-font-body)]">
          {copy.chat.pendingRunModelRecoveryLoading}
        </span>
      </div>
    )
  }

  if (projection.kind === "blocked") {
    return (
      <div className="flex min-h-10 items-center gap-[var(--jingle-gap-sm)] border-t border-destructive/20 px-[var(--jingle-space-3)] py-[var(--jingle-space-2)] text-destructive">
        <AlertTriangle className="size-[var(--jingle-icon-sm)] shrink-0" />
        <span className="[font-size:var(--jingle-font-body)]">
          {projection.reason === "source_run_unavailable"
            ? copy.chat.pendingRunModelRecoverySourceUnavailable
            : copy.chat.pendingRunModelRecoveryBlocked}
        </span>
      </div>
    )
  }

  return (
    <div className="border-t border-border/60 py-[var(--jingle-space-2)]">
      <div className="flex items-start gap-[var(--jingle-gap-sm)] px-[var(--jingle-space-3)] pb-[var(--jingle-space-1)]">
        <Gauge className="mt-0.5 size-[var(--jingle-icon-sm)] shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="[font-size:var(--jingle-font-body)] font-medium text-foreground">
            {copy.chat.pendingRunModelRecoveryTitle}
          </div>
          <div className="[font-size:var(--jingle-font-caption)] text-muted-foreground">
            {copy.chat.pendingRunModelRecoveryDescription(projection.modelName)}
          </div>
        </div>
      </div>
      {projection.allowedValues.length > 0 ? (
        <ReasoningEffortPicker
          allowedValues={projection.allowedValues}
          onSelect={(thinkingEffort) =>
            props.onSelect({
              modelId: projection.modelId,
              thinkingEffort,
              version: MODEL_RUNTIME_SELECTION_VERSION
            })
          }
          selectedValue={projection.selection?.thinkingEffort ?? null}
        />
      ) : (
        <div className="px-[var(--jingle-space-3)] pt-[var(--jingle-space-1)]">
          <Button
            type="button"
            onClick={() =>
              props.onSelect({
                modelId: projection.modelId,
                thinkingEffort: null,
                version: MODEL_RUNTIME_SELECTION_VERSION
              })
            }
            size="sm"
            variant={projection.selection ? "default" : "outline"}
          >
            {copy.chat.pendingRunModelRecoveryNoEffort}
          </Button>
        </div>
      )}
    </div>
  )
}
