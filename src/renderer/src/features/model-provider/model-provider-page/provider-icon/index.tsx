import { Cloud } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ModelProvider } from "../declarations"

type ProviderIconProps = {
  className?: string
  provider: ModelProvider
}

function AnthropicIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.304 3.541h-3.672l6.696 16.918h3.672l-6.696-16.918zm-10.608 0L0 20.459h3.744l1.368-3.562h7.044l1.368 3.562h3.744L10.608 3.541H6.696zm.576 10.852l2.352-6.122 2.352 6.122H7.272z" />
    </svg>
  )
}

function OpenAIIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  )
}

function GoogleIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.616 10.835a14.147 14.147 0 0 1-4.45-3.001 14.111 14.111 0 0 1-3.678-6.452.503.503 0 0 0-.975 0 14.134 14.134 0 0 1-3.679 6.452 14.155 14.155 0 0 1-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 0 0 0 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 0 1 4.45 3.001 14.112 14.112 0 0 1 3.679 6.453.502.502 0 0 0 .975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 0 1 3.001-4.45 14.113 14.113 0 0 1 6.453-3.678.503.503 0 0 0 0-.975 13.245 13.245 0 0 1-2.003-.678z" />
    </svg>
  )
}

function KimiIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.43 2.1c-4.62 0-8.37 3.75-8.37 8.37 0 4.22 3.13 7.72 7.2 8.29A8.94 8.94 0 0 1 5.1 9.93c0-4.73 3.68-8.6 8.34-8.9.66.31 1.33.67 1.99 1.07z" />
      <path d="M17.62 4.68a7.22 7.22 0 1 1-7.1 12.9 5.92 5.92 0 1 0 7.1-12.9z" />
    </svg>
  )
}

function ProviderGlyph({ provider }: { provider: ModelProvider }): React.JSX.Element {
  switch (provider.provider) {
    case "anthropic":
      return <AnthropicIcon className="h-4 w-4" />
    case "openai":
      return <OpenAIIcon className="h-4 w-4" />
    case "google":
      return <GoogleIcon className="h-4 w-4" />
    case "kimi":
      return <KimiIcon className="h-4 w-4" />
    case "dashscope":
      return <Cloud className="h-4 w-4" />
  }

  const exhaustiveProvider: never = provider.provider
  throw new Error(`Provider icon is not implemented: ${exhaustiveProvider}`)
}

export default function ProviderIcon(props: ProviderIconProps): React.JSX.Element {
  const { className, provider } = props

  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background-secondary/70 text-foreground">
        <ProviderGlyph provider={provider} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[14px] font-semibold text-foreground">{provider.label}</div>
        <div className="mt-0.5 hidden text-[11px] uppercase tracking-[0.12em] text-muted-foreground md:block">
          {provider.provider}
        </div>
      </div>
    </div>
  )
}
