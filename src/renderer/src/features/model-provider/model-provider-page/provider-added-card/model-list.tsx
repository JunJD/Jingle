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
    <div className="px-4 py-2">
      <div className="divide-y divide-border/70">
        {models.map((model) => {
          const isDefault = model.id === defaultModelId

          return (
            <div
              key={model.id}
              className={cn(
                "grid gap-2 py-2.5 md:grid-cols-[minmax(180px,0.9fr)_minmax(220px,1fr)_auto] md:items-center",
                isDefault && "bg-background-elevated/55"
              )}
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-foreground">{model.name}</div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                  {model.model}
                </div>
              </div>
              <div className="min-w-0 text-[12px] leading-5 text-muted-foreground">
                <span className="line-clamp-2">{model.description}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1 md:justify-end">
                {isDefault && <ModelBadge>{copy.provider.defaultBadge}</ModelBadge>}
                {model.status !== "active" && (
                  <ModelBadge className="border-status-warning/25 bg-transparent text-status-warning">
                    {copy.provider.notConfigured}
                  </ModelBadge>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
