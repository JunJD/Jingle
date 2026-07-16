import { ArrowLeft, Check, ChevronDown, Plus, Settings2, Tag, X } from "lucide-react"
import { useState, type CSSProperties } from "react"
import type {
  WorkflowColor,
  WorkflowLabelDefinition,
  WorkflowLabelValueType
} from "@shared/thread-workflow"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { ProjectWorkflowDefinitionManager } from "./ProjectWorkflowDefinitionManager"
import { useLauncherAiWorkflowController } from "./use-launcher-ai-workflow-controller"

function inputTypeForLabel(valueType: WorkflowLabelValueType): React.HTMLInputTypeAttribute {
  switch (valueType) {
    case "date":
      return "date"
    case "link":
      return "url"
    case "number":
      return "number"
    case "boolean":
    case "string":
      return "text"
  }
}

function workflowColorStyle(color: WorkflowColor | null): CSSProperties | undefined {
  if (!color) {
    return undefined
  }

  return {
    "--workflow-status-color-dark": color.dark,
    "--workflow-status-color-light": color.light
  } as CSSProperties
}

export function LauncherAiWorkflowAccessory(props: {
  canManageDefinitions: boolean
  threadId: string
}): React.JSX.Element | null {
  const { canManageDefinitions, threadId } = props
  const { copy } = useI18n()
  const [open, setOpen] = useState(false)
  const [managingDefinitions, setManagingDefinitions] = useState(false)
  const [draftLabelId, setDraftLabelId] = useState<string | null>(null)
  const [draftValue, setDraftValue] = useState("")
  const {
    addLabel,
    clearError,
    createLabel,
    createStatus,
    error,
    isSaving,
    projectionError,
    refreshError,
    removeLabel,
    setDefaultStatus,
    setStatus,
    snapshot
  } = useLauncherAiWorkflowController(threadId)

  const summary = snapshot?.summary ?? null
  const project = snapshot?.project ?? null
  const displayError = error ?? refreshError ?? projectionError
  const draftLabel = project?.labels.find((label) => label.labelId === draftLabelId) ?? null

  function handleAddLabel(label: WorkflowLabelDefinition): void {
    if (label.valueType === "boolean") {
      void addLabel({ labelId: label.labelId, rawValue: "" })
      return
    }

    clearError()
    setDraftLabelId(label.labelId)
    setDraftValue("")
  }

  function submitDraftLabel(): void {
    if (!draftLabel || !draftValue.trim()) {
      return
    }

    const rawValue = draftValue
    void addLabel({ labelId: draftLabel.labelId, rawValue }).then((didAdd) => {
      if (didAdd) {
        setDraftLabelId(null)
        setDraftValue("")
      }
    })
  }

  if (!snapshot && !displayError) {
    return (
      <span className="flex h-[var(--jingle-control-h-compact)] items-center text-muted-foreground">
        <Spinner label={copy.common.running} size="sm" />
      </span>
    )
  }

  if (!summary?.projectId && !displayError) {
    return null
  }

  if (summary?.projectId && !project) {
    const invalidProjectMessage = `Workflow project metadata unavailable: ${summary.projectId}`
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={invalidProjectMessage}
            className="flex h-[var(--jingle-control-h-compact)] items-center rounded-[var(--jingle-radius-xs)] text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring"
            role="status"
            tabIndex={0}
          >
            <Tag className="size-[var(--jingle-icon-xs)]" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{invalidProjectMessage}</TooltipContent>
      </Tooltip>
    )
  }

  if (!summary || !project) {
    if (!displayError) {
      throw new Error("[LauncherAiWorkflowAccessory] Missing workflow projection state.")
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={displayError}
            className="flex h-[var(--jingle-control-h-compact)] items-center rounded-[var(--jingle-radius-xs)] text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring"
            role="alert"
            tabIndex={0}
          >
            <Tag className="size-[var(--jingle-icon-xs)]" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{displayError}</TooltipContent>
      </Tooltip>
    )
  }

  const assignedBooleanLabelIds = new Set(
    summary.labels
      .filter((assignment) => assignment.label.valueType === "boolean")
      .map((assignment) => assignment.label.labelId)
  )
  const visibleLabels = summary.labels.slice(0, 2)
  const remainingLabelCount = summary.labels.length - visibleLabels.length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          className="group flex h-[22px] min-w-0 max-w-[24rem] shrink items-center gap-[var(--jingle-space-1-5)] rounded-[var(--jingle-radius-xs)] px-[var(--jingle-space-1)] py-0 font-normal text-muted-foreground transition hover:bg-background-secondary/62 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={copy.threadWorkflow.edit}
          variant="ghost"
        >
          {summary.status ? (
            <span className="inline-flex shrink-0 items-center gap-[var(--jingle-space-1)] [font-size:var(--jingle-font-meta)] font-medium leading-[var(--jingle-line-tight)] text-foreground">
              <span
                aria-hidden="true"
                className="launcher-workflow-status-dot"
                style={workflowColorStyle(summary.status.color)}
              />
              {summary.status.label}
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-[var(--jingle-space-1)] [font-size:var(--jingle-font-meta)] leading-[var(--jingle-line-tight)]">
              <Tag className="size-[var(--jingle-icon-xs)]" />
              {copy.threadWorkflow.unclassified}
            </span>
          )}
          {visibleLabels.length ? (
            <span aria-hidden="true" className="h-3 w-px shrink-0 bg-border/72" />
          ) : null}
          {visibleLabels.map((assignment) => (
            <span
              key={`${assignment.label.labelId}:${assignment.rawValue}`}
              className="min-w-0 truncate [font-size:var(--jingle-font-meta)] leading-[var(--jingle-line-tight)]"
            >
              {assignment.rawValue
                ? `${assignment.label.name}: ${assignment.rawValue}`
                : assignment.label.name}
            </span>
          ))}
          {remainingLabelCount > 0 ? (
            <span className="shrink-0 [font-size:var(--jingle-font-meta)]">
              +{remainingLabelCount}
            </span>
          ) : null}
          <ChevronDown className="size-[var(--jingle-icon-xs)] shrink-0 opacity-45 transition group-hover:opacity-80 group-data-[state=open]:opacity-80" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-busy={isSaving || undefined}
        align="start"
        className="max-h-[min(34rem,calc(100vh-2rem))] w-[min(24rem,calc(100vw-2rem))] space-y-[var(--jingle-space-3)] overflow-y-auto border-border/72 bg-popover/96 p-[var(--jingle-space-3)]"
        sideOffset={6}
      >
        <div className="flex items-center justify-between gap-[var(--jingle-space-2)]">
          <div className="min-w-0">
            <p className="truncate [font-size:var(--jingle-font-body)] font-medium">
              {project.displayName}
            </p>
            <p className="truncate [font-size:var(--jingle-font-meta)] text-muted-foreground">
              {project.workspacePath}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-[var(--jingle-space-1)]">
            {isSaving ? <Spinner label={copy.common.running} size="sm" /> : null}
            {canManageDefinitions ? (
              <IconButton
                type="button"
                label={
                  managingDefinitions
                    ? copy.threadWorkflow.backToAssignments
                    : copy.threadWorkflow.manageDefinitions
                }
                onClick={() => {
                  clearError()
                  setManagingDefinitions((current) => !current)
                }}
                size="icon-sm"
                variant="ghost"
              >
                {managingDefinitions ? <ArrowLeft /> : <Settings2 />}
              </IconButton>
            ) : null}
          </div>
        </div>

        {displayError ? (
          <p
            aria-live="assertive"
            className="rounded-[var(--jingle-radius-md)] border border-destructive/25 bg-destructive/10 px-[var(--jingle-space-2)] py-[var(--jingle-space-2)] [font-size:var(--jingle-font-meta)] text-destructive"
            role="alert"
          >
            {displayError}
          </p>
        ) : null}

        {managingDefinitions ? (
          <ProjectWorkflowDefinitionManager
            createLabel={createLabel}
            createStatus={createStatus}
            isSaving={isSaving}
            project={project}
            setDefaultStatus={setDefaultStatus}
          />
        ) : (
          <>
            <section className="space-y-[var(--jingle-space-1)]">
              <h3 className="[font-size:var(--jingle-font-meta)] font-medium text-muted-foreground">
                {copy.threadWorkflow.status}
              </h3>
              <div className="grid gap-px">
                {project.statuses.map((status) => {
                  const selected = status.statusId === summary.status?.statusId
                  return (
                    <Button
                      key={status.statusId}
                      type="button"
                      aria-pressed={selected}
                      className={cn(
                        "flex h-[var(--jingle-control-h-compact)] items-center gap-[var(--jingle-space-2)] rounded-[var(--jingle-radius-sm)] px-[var(--jingle-space-2)] text-left [font-size:var(--jingle-font-body)] transition hover:bg-background-secondary",
                        selected && "bg-background-secondary"
                      )}
                      disabled={isSaving || selected}
                      onClick={() => {
                        void setStatus(status.statusId)
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      <span
                        aria-hidden="true"
                        className="launcher-workflow-status-dot"
                        style={workflowColorStyle(status.color)}
                      />
                      <span className="flex-1 truncate">{status.label}</span>
                      {selected ? <Check className="size-[var(--jingle-icon-xs)]" /> : null}
                    </Button>
                  )
                })}
              </div>
            </section>

            <section className="space-y-[var(--jingle-space-2)]">
              <h3 className="[font-size:var(--jingle-font-meta)] font-medium text-muted-foreground">
                {copy.threadWorkflow.labels}
              </h3>
              {summary.labels.length ? (
                <div className="flex flex-wrap gap-[var(--jingle-space-1)]">
                  {summary.labels.map((assignment) => (
                    <span
                      key={`${assignment.label.labelId}:${assignment.rawValue}`}
                      className="inline-flex min-w-0 max-w-full items-center gap-[var(--jingle-space-1)] rounded-[var(--jingle-radius-xs)] bg-background-secondary px-[var(--jingle-space-1-5)] py-px [font-size:var(--jingle-font-meta)]"
                    >
                      <span className="truncate">
                        {assignment.rawValue
                          ? `${assignment.label.name}: ${assignment.rawValue}`
                          : assignment.label.name}
                      </span>
                      <IconButton
                        type="button"
                        className="size-auto shrink-0 p-0 text-muted-foreground transition hover:text-foreground"
                        label={copy.threadWorkflow.removeLabel(assignment.label.name)}
                        disabled={isSaving}
                        onClick={() => {
                          void removeLabel({
                            labelId: assignment.label.labelId,
                            rawValue: assignment.rawValue
                          })
                        }}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <X className="size-[var(--jingle-icon-xs)]" />
                      </IconButton>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="[font-size:var(--jingle-font-meta)] text-muted-foreground">
                  {copy.threadWorkflow.noLabels}
                </p>
              )}

              <div className="grid gap-px border-t border-border/72 pt-[var(--jingle-space-2)]">
                {project.labels.map((label) => {
                  const booleanAssigned = assignedBooleanLabelIds.has(label.labelId)
                  return (
                    <Button
                      key={label.labelId}
                      type="button"
                      className="flex h-[var(--jingle-control-h-compact)] items-center gap-[var(--jingle-space-2)] rounded-[var(--jingle-radius-sm)] px-[var(--jingle-space-2)] text-left [font-size:var(--jingle-font-body)] transition hover:bg-background-secondary disabled:opacity-45"
                      disabled={isSaving || booleanAssigned}
                      onClick={() => handleAddLabel(label)}
                      size="sm"
                      variant="ghost"
                    >
                      <Plus className="size-[var(--jingle-icon-xs)] shrink-0" />
                      <span className="flex-1 truncate">{label.name}</span>
                      <span className="[font-size:var(--jingle-font-meta)] text-muted-foreground">
                        {copy.threadWorkflow.valueTypes[label.valueType]}
                      </span>
                    </Button>
                  )
                })}
              </div>

              {draftLabel ? (
                <form
                  className="flex items-center gap-[var(--jingle-space-2)]"
                  onSubmit={(event) => {
                    event.preventDefault()
                    submitDraftLabel()
                  }}
                >
                  <Input
                    autoFocus
                    className="h-[var(--jingle-control-h-md)] min-w-0"
                    placeholder={copy.threadWorkflow.valuePlaceholder(draftLabel.name)}
                    step={draftLabel.valueType === "number" ? "any" : undefined}
                    type={inputTypeForLabel(draftLabel.valueType)}
                    value={draftValue}
                    onChange={(event) => setDraftValue(event.target.value)}
                  />
                  <Button
                    className="h-[var(--jingle-control-h-md)] shrink-0"
                    disabled={isSaving || !draftValue.trim()}
                    size="sm"
                    type="submit"
                  >
                    {copy.threadWorkflow.add}
                  </Button>
                </form>
              ) : null}
            </section>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
