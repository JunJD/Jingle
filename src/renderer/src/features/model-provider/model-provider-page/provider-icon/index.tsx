import { ProviderLogo } from "@/components/model-provider-logo"
import { cn } from "@/lib/utils"
import type { ModelProvider } from "../declarations"

type ProviderIconProps = {
  className?: string
  provider: ModelProvider
}

function ProviderGlyph({ provider }: { provider: ModelProvider }): React.JSX.Element {
  return <ProviderLogo className="h-4 w-4" providerId={provider.provider} />
}

export default function ProviderIcon(props: ProviderIconProps): React.JSX.Element {
  const { className, provider } = props

  return (
    <div className={cn("inline-flex items-center gap-[var(--ow-gap-sm)]", className)}>
      <div className="flex h-[var(--ow-control-h-md)] w-8 items-center justify-center rounded-md border border-border bg-background-secondary/70 text-foreground">
        <ProviderGlyph provider={provider} />
      </div>
      <div className="min-w-0">
        <div className="truncate [font-size:var(--ow-font-title)] font-semibold text-foreground">
          {provider.label}
        </div>
        <div className="mt-0.5 hidden [font-size:var(--ow-font-meta)] uppercase tracking-[0.12em] text-muted-foreground md:block">
          {provider.provider}
        </div>
      </div>
    </div>
  )
}
