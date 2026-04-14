import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { getSettingsCopy } from "@/settings/copy"
import type { ModelConfig } from "@/types"
import ModelBadge from "../model-badge"

type ModelListProps = {
  defaultModelId: string
  models: ModelConfig[]
}

export default function ModelList(props: ModelListProps): React.JSX.Element {
  const { defaultModelId, models } = props
  const { locale } = useI18n()
  const copy = getSettingsCopy(locale)

  return (
    <div className="rounded-b-xl px-2 pb-2">
      <div className="rounded-lg border border-border/60 bg-background-elevated/80 p-2 shadow-inner">
        <div className="space-y-1">
          {models.map((model) => {
            const isDefault = model.id === defaultModelId

            return (
              <div
                key={model.id}
                className={cn(
                  "rounded-lg border px-3 py-2",
                  isDefault
                    ? "border-foreground/15 bg-background"
                    : "border-transparent bg-background/45"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-foreground">
                      {model.name}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {model.model}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {isDefault && <ModelBadge>{copy.provider.defaultBadge}</ModelBadge>}
                    {model.status !== "active" && (
                      <ModelBadge className="border-amber-200 bg-amber-50 text-amber-700">
                        {copy.provider.notConfigured}
                      </ModelBadge>
                    )}
                  </div>
                </div>
                {model.description && (
                  <div className="mt-1 text-[12px] leading-5 text-muted-foreground">
                    {model.description}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
