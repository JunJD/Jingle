import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { getSettingsCopy } from "@/settings/copy"
import type { ProviderId } from "@/types"
import type { ModelProvider } from "../declarations"

type CredentialPanelProps = {
  onOpenProviderDialog: (providerId: ProviderId) => void
  provider: ModelProvider
}

export default function CredentialPanel(props: CredentialPanelProps): React.JSX.Element {
  const { onOpenProviderDialog, provider } = props
  const { locale } = useI18n()
  const copy = getSettingsCopy(locale)
  const hasProviderError = provider.modelStatus === "error"

  return (
    <div
      className={cn(
        "flex min-w-[220px] items-center justify-between gap-3 rounded-xl border px-3 py-2 shadow-sm",
        hasProviderError
          ? "border-destructive/25 bg-destructive/10 text-destructive"
          : provider.hasApiKey
            ? "border-emerald-200/70 bg-emerald-50/70 text-emerald-950"
            : "border-amber-200/80 bg-amber-50/80 text-amber-950"
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {hasProviderError ? (
          <AlertTriangle className="h-4 w-4 shrink-0" />
        ) : provider.hasApiKey ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        ) : (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        )}
        <span className="truncate text-[12px] font-medium">
          {hasProviderError
            ? copy.provider.modelListErrorBadge
            : provider.hasApiKey
              ? copy.provider.configured
              : copy.provider.apiRequired}
        </span>
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 rounded-lg bg-background-elevated/90 px-2.5 text-[11px]"
        onClick={() => onOpenProviderDialog(provider.provider)}
      >
        {provider.hasApiKey ? copy.provider.editKey : copy.provider.addKey}
      </Button>
    </div>
  )
}
