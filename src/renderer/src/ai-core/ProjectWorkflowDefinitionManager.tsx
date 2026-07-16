import { Check, Plus, Star, Tag, X } from "lucide-react"
import { useState, type CSSProperties } from "react"
import type {
  ProjectWorkflowDefinition,
  WorkflowColor,
  WorkflowLabelValueType,
  WorkflowStatusCategory
} from "@shared/thread-workflow"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const STATUS_COLORS: WorkflowColor[] = [
  { dark: "#60A5FA", light: "#2563EB" },
  { dark: "#2DD4BF", light: "#0F766E" },
  { dark: "#F87171", light: "#DC2626" },
  { dark: "#A78BFA", light: "#7C3AED" },
  { dark: "#4ADE80", light: "#15803D" },
  { dark: "#FBBF24", light: "#B45309" }
]

interface ProjectWorkflowDefinitionManagerProps {
  createLabel: (input: {
    name: string
    parentLabelId?: string
    valueType: WorkflowLabelValueType
  }) => Promise<boolean>
  createStatus: (input: {
    category: WorkflowStatusCategory
    color: WorkflowColor
    label: string
  }) => Promise<boolean>
  isSaving: boolean
  project: ProjectWorkflowDefinition
  setDefaultStatus: (projectId: string, statusId: string) => Promise<boolean>
}

function statusColorStyle(color: WorkflowColor | null): CSSProperties | undefined {
  if (!color) {
    return undefined
  }

  return {
    "--workflow-status-color-dark": color.dark,
    "--workflow-status-color-light": color.light
  } as CSSProperties
}

export function ProjectWorkflowDefinitionManager(
  props: ProjectWorkflowDefinitionManagerProps
): React.JSX.Element {
  const { createLabel, createStatus, isSaving, project, setDefaultStatus } = props
  const { copy } = useI18n()
  const [showStatusForm, setShowStatusForm] = useState(false)
  const [statusLabel, setStatusLabel] = useState("")
  const [statusCategory, setStatusCategory] = useState<WorkflowStatusCategory>("open")
  const [statusColor, setStatusColor] = useState<WorkflowColor>(STATUS_COLORS[0])
  const [showLabelForm, setShowLabelForm] = useState(false)
  const [labelName, setLabelName] = useState("")
  const [labelValueType, setLabelValueType] = useState<WorkflowLabelValueType>("string")
  const [parentLabelId, setParentLabelId] = useState("")

  async function submitStatus(): Promise<void> {
    const label = statusLabel.trim()
    if (!label) {
      return
    }

    const created = await createStatus({
      category: statusCategory,
      color: statusColor,
      label
    })
    if (created) {
      setShowStatusForm(false)
      setStatusLabel("")
    }
  }

  async function submitLabel(): Promise<void> {
    const name = labelName.trim()
    if (!name) {
      return
    }

    const created = await createLabel({
      name,
      parentLabelId: parentLabelId || undefined,
      valueType: labelValueType
    })
    if (created) {
      setShowLabelForm(false)
      setLabelName("")
      setParentLabelId("")
    }
  }

  return (
    <div className="space-y-[var(--jingle-space-4)]">
      <section className="space-y-[var(--jingle-space-2)]">
        <div className="flex items-center justify-between gap-[var(--jingle-space-2)]">
          <h3 className="[font-size:var(--jingle-font-meta)] font-medium text-muted-foreground">
            {copy.threadWorkflow.statusDefinitions}
          </h3>
          <IconButton
            type="button"
            label={copy.threadWorkflow.addStatus}
            onClick={() => setShowStatusForm((current) => !current)}
            size="icon-sm"
            variant="ghost"
          >
            {showStatusForm ? <X /> : <Plus />}
          </IconButton>
        </div>

        <div className="grid gap-px">
          {project.statuses.map((status) => (
            <div
              key={status.statusId}
              className="flex h-[var(--jingle-control-h-compact)] items-center gap-[var(--jingle-space-2)] rounded-[var(--jingle-radius-sm)] px-[var(--jingle-space-2)] [font-size:var(--jingle-font-body)]"
            >
              <span
                aria-hidden="true"
                className="launcher-workflow-status-dot"
                style={statusColorStyle(status.color)}
              />
              <span className="min-w-0 flex-1 truncate">{status.label}</span>
              <span className="[font-size:var(--jingle-font-meta)] text-muted-foreground">
                {status.category === "open"
                  ? copy.threadWorkflow.openCategory
                  : copy.threadWorkflow.closedCategory}
              </span>
              <IconButton
                type="button"
                disabled={isSaving || status.isDefault}
                label={
                  status.isDefault
                    ? copy.threadWorkflow.defaultStatus
                    : copy.threadWorkflow.setDefaultStatus(status.label)
                }
                onClick={() => {
                  void setDefaultStatus(project.projectId, status.statusId)
                }}
                pressed={status.isDefault}
                size="icon-sm"
                variant="ghost"
              >
                {status.isDefault ? <Check /> : <Star />}
              </IconButton>
            </div>
          ))}
        </div>

        {showStatusForm ? (
          <form
            className="space-y-[var(--jingle-space-2)] border-t border-border/72 pt-[var(--jingle-space-2)]"
            onSubmit={(event) => {
              event.preventDefault()
              void submitStatus()
            }}
          >
            <Input
              autoFocus
              placeholder={copy.threadWorkflow.statusName}
              value={statusLabel}
              onChange={(event) => setStatusLabel(event.target.value)}
            />
            <div className="grid grid-cols-2 gap-px rounded-[var(--jingle-radius-sm)] bg-background-secondary p-px">
              {(["open", "closed"] as const).map((category) => (
                <Button
                  key={category}
                  aria-pressed={statusCategory === category}
                  className={cn(
                    "h-[var(--jingle-control-h-compact)]",
                    statusCategory === category && "bg-background"
                  )}
                  onClick={() => setStatusCategory(category)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {category === "open"
                    ? copy.threadWorkflow.openCategory
                    : copy.threadWorkflow.closedCategory}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-[var(--jingle-space-2)]">
              {STATUS_COLORS.map((color) => {
                const selected = color.light === statusColor.light
                return (
                  <IconButton
                    type="button"
                    key={color.light}
                    label={copy.threadWorkflow.selectColor(color.light)}
                    pressed={selected}
                    size="icon-sm"
                    className="flex size-6 items-center justify-center rounded-full border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setStatusColor(color)}
                  >
                    <span
                      className="size-3.5 rounded-full"
                      style={{ backgroundColor: color.light }}
                    />
                  </IconButton>
                )
              })}
            </div>
            <Button disabled={isSaving || !statusLabel.trim()} size="sm" type="submit">
              {copy.threadWorkflow.addStatus}
            </Button>
          </form>
        ) : null}
      </section>

      <section className="space-y-[var(--jingle-space-2)]">
        <div className="flex items-center justify-between gap-[var(--jingle-space-2)]">
          <h3 className="[font-size:var(--jingle-font-meta)] font-medium text-muted-foreground">
            {copy.threadWorkflow.labelDefinitions}
          </h3>
          <IconButton
            type="button"
            label={copy.threadWorkflow.addLabelDefinition}
            onClick={() => setShowLabelForm((current) => !current)}
            size="icon-sm"
            variant="ghost"
          >
            {showLabelForm ? <X /> : <Plus />}
          </IconButton>
        </div>

        <div className="grid gap-px">
          {project.labels.map((label) => {
            const parent = project.labels.find(
              (candidate) => candidate.labelId === label.parentLabelId
            )
            return (
              <div
                key={label.labelId}
                className="flex h-[var(--jingle-control-h-compact)] items-center gap-[var(--jingle-space-2)] rounded-[var(--jingle-radius-sm)] px-[var(--jingle-space-2)] [font-size:var(--jingle-font-body)]"
              >
                <Tag className="size-[var(--jingle-icon-xs)] shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {parent ? `${parent.name} / ${label.name}` : label.name}
                </span>
                <span className="[font-size:var(--jingle-font-meta)] text-muted-foreground">
                  {copy.threadWorkflow.valueTypes[label.valueType]}
                </span>
              </div>
            )
          })}
        </div>

        {showLabelForm ? (
          <form
            className="space-y-[var(--jingle-space-2)] border-t border-border/72 pt-[var(--jingle-space-2)]"
            onSubmit={(event) => {
              event.preventDefault()
              void submitLabel()
            }}
          >
            <Input
              autoFocus
              placeholder={copy.threadWorkflow.labelName}
              value={labelName}
              onChange={(event) => setLabelName(event.target.value)}
            />
            <Select
              aria-label={copy.threadWorkflow.valueType}
              className="h-[var(--jingle-control-h-md)] w-full rounded-[var(--jingle-radius-sm)] border border-input bg-background px-[var(--jingle-space-2)] [font-size:var(--jingle-font-body)]"
              value={labelValueType}
              onChange={(event) => setLabelValueType(event.target.value as WorkflowLabelValueType)}
            >
              {(["boolean", "string", "number", "date", "link"] as const).map((valueType) => (
                <option key={valueType} value={valueType}>
                  {copy.threadWorkflow.valueTypes[valueType]}
                </option>
              ))}
            </Select>
            <Select
              aria-label={copy.threadWorkflow.parentLabel}
              className="h-[var(--jingle-control-h-md)] w-full rounded-[var(--jingle-radius-sm)] border border-input bg-background px-[var(--jingle-space-2)] [font-size:var(--jingle-font-body)]"
              value={parentLabelId}
              onChange={(event) => setParentLabelId(event.target.value)}
            >
              <option value="">{copy.threadWorkflow.noParentLabel}</option>
              {project.labels.map((label) => (
                <option key={label.labelId} value={label.labelId}>
                  {label.name}
                </option>
              ))}
            </Select>
            <Button disabled={isSaving || !labelName.trim()} size="sm" type="submit">
              {copy.threadWorkflow.addLabelDefinition}
            </Button>
          </form>
        ) : null}
      </section>
    </div>
  )
}
