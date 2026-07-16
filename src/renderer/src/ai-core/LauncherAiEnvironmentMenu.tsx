import * as DropdownMenu from "@/components/ui/dropdown-menu"
import { ChevronDown, Info, RefreshCw, Sparkles } from "lucide-react"
import { useId, useMemo, useState } from "react"
import type { Todo } from "@/types"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { LauncherAiProgressList } from "./LauncherAiProgressList"
import { useLauncherAiThreadDigestController } from "./use-launcher-ai-thread-digest-controller"
import type { LauncherAiModelDisplayProjection } from "./use-launcher-ai-model-display-controller"

export interface LauncherAiEnvironmentInfo {
  model: LauncherAiModelDisplayProjection
  permissionLabel: string | null
  threadId: string | null
  todos: readonly Todo[]
  workspacePath: string | null
}

interface LauncherAiEnvironmentMenuProps {
  environment: LauncherAiEnvironmentInfo
  labels: {
    environmentDigest: string
    environmentDigestCollapse: string
    environmentDigestEmpty: string
    environmentDigestError: string
    environmentDigestExpand: string
    environmentDigestGenerate: string
    environmentDigestGenerating: string
    environmentDigestRegenerate: string
    environmentDigestUpdated: string
    environmentInfo: string
    environmentModel: string
    environmentNoModel: string
    environmentNoThread: string
    environmentNoWorkspace: string
    environmentPermission: string
    environmentUnknownModel: (modelId: string) => string
    environmentProgress: string
    environmentProgressMore: (count: number) => string
    environmentThread: string
    environmentWorkspace: string
  }
}

function ThreadDigestSection(props: {
  labels: LauncherAiEnvironmentMenuProps["labels"]
  threadId: string
}): React.JSX.Element {
  const { labels, threadId } = props
  const { locale } = useI18n()
  const summaryId = useId()
  const [expanded, setExpanded] = useState(false)
  const { digest, error, generate, isGenerating } = useLauncherAiThreadDigestController({
    errorFallback: labels.environmentDigestError,
    threadId
  })
  const updatedAtFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short"
      }),
    [locale]
  )
  const summary = digest?.summary ?? null
  const updatedAt =
    digest && digest.generatedAt !== null ? updatedAtFormatter.format(digest.generatedAt) : null

  return (
    <DropdownMenu.Group className="mt-2 border-t border-[color-mix(in_srgb,var(--launcher-border)_72%,transparent)] px-1 pb-0.5 pt-2.5">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <DropdownMenu.Label className="p-0 text-xs font-semibold leading-4 text-[color-mix(in_srgb,var(--muted-foreground)_82%,var(--foreground))]">
          {labels.environmentDigest}
        </DropdownMenu.Label>
        <DropdownMenu.Item
          className="flex min-h-7 cursor-default select-none items-center gap-1.5 rounded-[var(--jingle-radius-sm)] px-2 text-xs outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-background-interactive data-[highlighted]:text-foreground"
          disabled={isGenerating}
          onSelect={(event) => {
            event.preventDefault()
            void generate()
          }}
        >
          {summary ? <RefreshCw className="size-3.5" /> : <Sparkles className="size-3.5" />}
          <span aria-live="polite">
            {isGenerating
              ? labels.environmentDigestGenerating
              : summary
                ? labels.environmentDigestRegenerate
                : labels.environmentDigestGenerate}
          </span>
        </DropdownMenu.Item>
      </div>

      {summary ? (
        <DropdownMenu.Item
          aria-describedby={summaryId}
          aria-expanded={expanded}
          aria-label={expanded ? labels.environmentDigestCollapse : labels.environmentDigestExpand}
          className="mt-1 flex w-full cursor-default select-none items-start gap-2 rounded-[var(--jingle-radius-sm)] px-0 py-1 text-left text-xs font-normal leading-[18px] text-[color-mix(in_srgb,var(--foreground)_88%,var(--muted-foreground))] outline-none data-[highlighted]:bg-background-interactive"
          onSelect={(event) => {
            event.preventDefault()
            setExpanded((value) => !value)
          }}
        >
          <span
            id={summaryId}
            className={cn(
              "min-w-0 flex-1 [overflow-wrap:anywhere]",
              !expanded &&
                "[display:-webkit-box] overflow-hidden [-webkit-box-orient:vertical] [-webkit-line-clamp:3]"
            )}
          >
            {summary}
          </span>
          <ChevronDown
            className={cn(
              "mt-0.5 size-3.5 shrink-0 text-muted-foreground",
              expanded && "rotate-180"
            )}
          />
        </DropdownMenu.Item>
      ) : (
        <p className="pt-1 text-xs leading-4 text-muted-foreground">
          {labels.environmentDigestEmpty}
        </p>
      )}

      {updatedAt ? (
        <p className="pt-1 text-xs leading-4 text-muted-foreground">
          {labels.environmentDigestUpdated} {updatedAt}
        </p>
      ) : null}
      {error ? (
        <p
          className="pt-1 text-xs leading-4 text-destructive [overflow-wrap:anywhere]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </DropdownMenu.Group>
  )
}

function EnvironmentRow(props: {
  dataAttributes?: Record<`data-${string}`, string>
  label: string
  title?: string
  value: string
}): React.JSX.Element {
  const { dataAttributes, label, title, value } = props
  let valueTitle = value

  if (title !== undefined) {
    valueTitle = title
  }

  return (
    <div className="launcher-ai-environment-menu__row" {...dataAttributes}>
      <span className="launcher-ai-environment-menu__label">{label}</span>
      <span className="launcher-ai-environment-menu__value" title={valueTitle}>
        {value}
      </span>
    </div>
  )
}

export function LauncherAiEnvironmentMenu(
  props: LauncherAiEnvironmentMenuProps
): React.JSX.Element {
  const { environment, labels } = props
  let workspaceValue = labels.environmentNoWorkspace
  let modelLabel = labels.environmentNoModel
  let threadLabel = labels.environmentNoThread
  const workspaceDataAttributes: Record<`data-${string}`, string> = {}

  if (environment.workspacePath !== null) {
    workspaceValue = environment.workspacePath
    workspaceDataAttributes["data-launcher-ai-workspace-path"] = environment.workspacePath
  }

  if (environment.model.kind === "configured") {
    modelLabel = environment.model.label
  } else if (environment.model.kind === "unavailable") {
    modelLabel = labels.environmentUnknownModel(environment.model.modelId)
  }

  if (environment.threadId !== null) {
    threadLabel = environment.threadId
    workspaceDataAttributes["data-launcher-ai-workspace-thread-id"] = environment.threadId
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={labels.environmentInfo}
          data-launcher-ai-environment-trigger=""
          title={labels.environmentInfo}
          onMouseDown={(event) => event.preventDefault()}
          className={cn(
            "launcher-ai-environment-menu__trigger launcher-icon-button flex h-[var(--launcher-icon-button-size)] w-[var(--launcher-icon-button-size)] shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground",
            "aria-[expanded=true]:bg-background-secondary/70 aria-[expanded=true]:text-foreground"
          )}
        >
          <Info className="size-[var(--jingle-icon-sm)]" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          className="launcher-ai-menu launcher-ai-environment-menu"
          side="bottom"
          sideOffset={6}
          style={{
            maxHeight: "var(--radix-dropdown-menu-content-available-height)",
            overflowY: "auto"
          }}
        >
          <div className="launcher-ai-environment-menu__heading">{labels.environmentInfo}</div>
          <EnvironmentRow
            dataAttributes={workspaceDataAttributes}
            label={labels.environmentWorkspace}
            value={workspaceValue}
          />
          <EnvironmentRow label={labels.environmentModel} value={modelLabel} />
          {environment.permissionLabel !== null ? (
            <EnvironmentRow
              label={labels.environmentPermission}
              value={environment.permissionLabel}
            />
          ) : null}
          <EnvironmentRow label={labels.environmentThread} value={threadLabel} />
          {environment.threadId ? (
            <ThreadDigestSection
              key={environment.threadId}
              labels={labels}
              threadId={environment.threadId}
            />
          ) : null}
          <LauncherAiProgressList
            className="launcher-ai-environment-menu__progress"
            label={labels.environmentProgress}
            moreLabel={labels.environmentProgressMore}
            todos={environment.todos}
          />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
