import { CircleGauge, Zap, ArrowDown, ArrowUp, Database } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn, formatCompactNumber, formatNumber, formatTime } from "@/lib/utils"
import type { TokenUsage } from "@/lib/thread-context"
import { useI18n } from "@/lib/i18n"

// Context window limits by model (in tokens)
// These are approximate and may vary
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // Anthropic models
  "claude-opus-4-5-20251101": 200_000,
  "claude-sonnet-4-5-20250929": 200_000,
  "claude-3-5-sonnet-20241022": 200_000,
  "claude-3-5-haiku-20241022": 200_000,
  "claude-3-opus-20240229": 200_000,
  "claude-3-sonnet-20240229": 200_000,
  "claude-3-haiku-20240307": 200_000,
  // OpenAI models
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
  o1: 200_000,
  "o1-mini": 128_000,
  o3: 200_000,
  "o3-mini": 200_000,
  // Google models
  "gemini-3-pro-preview": 2_000_000,
  "gemini-3-flash-preview": 1_000_000,
  "gemini-2.5-pro": 2_000_000,
  "gemini-2.5-flash": 1_000_000,
  "gemini-2.5-flash-lite": 1_000_000,
  "gemini-2.0-flash": 1_000_000,
  "gemini-1.5-pro": 2_000_000,
  "gemini-1.5-flash": 1_000_000
}

// Default limit if model not found
const DEFAULT_CONTEXT_LIMIT = 128_000

function getContextLimit(modelId: string): number {
  // Try exact match first
  if (MODEL_CONTEXT_LIMITS[modelId]) {
    return MODEL_CONTEXT_LIMITS[modelId]
  }

  // Try prefix match for model families
  for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (modelId.startsWith(key)) {
      return limit
    }
  }

  // Infer from model name patterns
  if (modelId.includes("claude")) return 200_000
  if (modelId.includes("gpt-4o") || modelId.includes("o1") || modelId.includes("o3")) return 128_000
  if (modelId.includes("gemini")) return 1_000_000

  return DEFAULT_CONTEXT_LIMIT
}

interface ContextUsageIndicatorProps {
  tokenUsage: TokenUsage | null
  modelId: string
  className?: string
}

export function ContextUsageIndicator({
  tokenUsage,
  modelId,
  className
}: ContextUsageIndicatorProps): React.JSX.Element | null {
  const { copy, locale } = useI18n()
  if (!tokenUsage) {
    return null
  }

  const contextLimit = getContextLimit(modelId)
  const usedTokens = tokenUsage.inputTokens
  const usagePercent = Math.min((usedTokens / contextLimit) * 100, 100)

  // Determine color based on usage
  let colorClass = "text-status-info"
  let bgColorClass = "bg-status-info/10"
  let barColorClass = "bg-status-info"
  let statusText = copy.contextUsage.normal

  if (usagePercent >= 90) {
    colorClass = "text-status-critical"
    bgColorClass = "bg-status-critical/10"
    barColorClass = "bg-status-critical"
    statusText = copy.contextUsage.critical
  } else if (usagePercent >= 75) {
    colorClass = "text-status-warning"
    bgColorClass = "bg-status-warning/10"
    barColorClass = "bg-status-warning"
    statusText = copy.contextUsage.warning
  } else if (usagePercent >= 50) {
    colorClass = "text-status-warning"
    bgColorClass = "bg-status-warning/10"
    barColorClass = "bg-status-warning"
    statusText = copy.contextUsage.moderate
  }

  const hasCacheData = tokenUsage.cacheReadTokens || tokenUsage.cacheCreationTokens

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors hover:opacity-80",
            bgColorClass,
            colorClass,
            className
          )}
        >
          <CircleGauge className="size-3.5" />
          <span className="font-mono">
            {formatCompactNumber(usedTokens, locale)} / {formatCompactNumber(contextLimit, locale)}
          </span>
          <span className="text-[10px] opacity-70">({usagePercent.toFixed(0)}%)</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 border-border bg-popover p-0" align="end" sideOffset={8}>
        <div className="p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">
              {copy.contextUsage.contextWindow}
            </span>
            <span
              className={cn(
                "text-[10px] font-medium px-1.5 py-0.5 rounded",
                bgColorClass,
                colorClass
              )}
            >
              {statusText}
            </span>
          </div>

          <div className="space-y-1">
            <div className="h-2 overflow-hidden rounded-full bg-background-secondary">
              <div
                className={cn("h-full rounded-full transition-all", barColorClass)}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>
                {formatNumber(usedTokens, locale)} {copy.contextUsage.tokens}
              </span>
              <span>
                {formatNumber(contextLimit, locale)} {copy.contextUsage.max}
              </span>
            </div>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-border">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {copy.contextUsage.tokenBreakdown}
            </div>

            <div className="space-y-1">
              {/* Input tokens */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <ArrowUp className="size-3" />
                  <span>{copy.contextUsage.input}</span>
                </div>
                <span className="font-mono">{formatNumber(tokenUsage.inputTokens, locale)}</span>
              </div>

              {/* Output tokens */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <ArrowDown className="size-3" />
                  <span>{copy.contextUsage.output}</span>
                </div>
                <span className="font-mono">{formatNumber(tokenUsage.outputTokens, locale)}</span>
              </div>

              {/* Total */}
              <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Zap className="size-3" />
                  <span>{copy.contextUsage.total}</span>
                </div>
                <span className="font-mono">{formatNumber(tokenUsage.totalTokens, locale)}</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-border">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {copy.contextUsage.cache}
            </div>

            <div className="space-y-1">
              {hasCacheData ? (
                <>
                  {tokenUsage.cacheReadTokens !== undefined && tokenUsage.cacheReadTokens > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 text-status-nominal">
                        <Database className="size-3" />
                        <span>{copy.contextUsage.cacheHits}</span>
                      </div>
                      <span className="font-mono text-status-nominal">
                        {formatNumber(tokenUsage.cacheReadTokens, locale)}
                      </span>
                    </div>
                  )}

                  {tokenUsage.cacheCreationTokens !== undefined &&
                    tokenUsage.cacheCreationTokens > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 text-status-info">
                          <Database className="size-3" />
                          <span>{copy.contextUsage.cacheCreated}</span>
                        </div>
                        <span className="font-mono text-status-info">
                          {formatNumber(tokenUsage.cacheCreationTokens, locale)}
                        </span>
                      </div>
                    )}
                </>
              ) : (
                <div className="text-xs text-muted-foreground">
                  {copy.contextUsage.noCachedTokens}
                </div>
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-border">
            <div className="text-[10px] text-muted-foreground">
              {copy.contextUsage.lastUpdated}: {formatTime(tokenUsage.lastUpdated, locale)}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
