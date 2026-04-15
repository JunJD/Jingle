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
  const hasProviderError = provider.modelListStatus === "error"
  const configured = provider.configurationStatus === "active"

  return (
    <div className="flex items-center justify-between gap-3 md:justify-end">
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 text-[12px] font-medium",
          hasProviderError
            ? "text-destructive"
            : configured
              ? "text-status-nominal"
              : "text-status-warning"
        )}
      >
        {hasProviderError ? (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        ) : configured ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">
          {hasProviderError
            ? copy.provider.modelListErrorBadge
            : configured
              ? copy.provider.configured
              : copy.provider.apiRequired}
        </span>
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 rounded-md bg-background-elevated/80 px-2.5 text-[11px]"
        onClick={() => onOpenProviderDialog(provider.provider)}
      >
        {configured ? copy.provider.editKey : copy.provider.addKey}
      </Button>
    </div>
  )
}
