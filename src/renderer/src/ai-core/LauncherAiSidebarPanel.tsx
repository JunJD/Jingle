import { Clock3, FolderGit2, Pin } from "lucide-react"
import type { ReactNode } from "react"

export interface LauncherAiSidebarInfo {
  modelLabel: string | null
  permissionLabel: string
  threadId: string | null
  title: string
  workspacePath: string | null
}

interface LauncherAiSidebarPanelProps {
  info: LauncherAiSidebarInfo
  labels: {
    environmentModel: string
    environmentNoModel: string
    environmentNoThread: string
    environmentNoWorkspace: string
    environmentPermission: string
    environmentThread: string
    environmentWorkspace: string
    expandSidebar: string
    sidebarPinned: string
    sidebarRecent: string
    sidebarSources: string
    sidebarUnavailable: string
  }
  mode: "expanded" | "preview"
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}

function getFolderName(folderPath: string | null): string | null {
  if (!folderPath) {
    return null
  }

  const normalized = folderPath.replace(/[\\/]+$/, "")
  const parts = normalized.split(/[\\/]+/)
  return parts.at(-1) || normalized
}

function FactRow(props: { label: string; title?: string; value: string }): React.JSX.Element {
  const { label, title, value } = props

  return (
    <div className="launcher-ai-sidebar-panel__fact">
      <span className="launcher-ai-sidebar-panel__fact-label">{label}</span>
      <span className="launcher-ai-sidebar-panel__fact-value" title={title ?? value}>
        {value}
      </span>
    </div>
  )
}

function PlaceholderRow(props: {
  icon: ReactNode
  label: string
  unavailableLabel: string
}): React.JSX.Element {
  const { icon, label, unavailableLabel } = props

  return (
    <div className="launcher-ai-sidebar-panel__placeholder" aria-disabled="true">
      <span className="launcher-ai-sidebar-panel__placeholder-icon">{icon}</span>
      <span className="launcher-ai-sidebar-panel__placeholder-label">{label}</span>
      <span className="launcher-ai-sidebar-panel__placeholder-status">{unavailableLabel}</span>
    </div>
  )
}

export function LauncherAiSidebarPanel(props: LauncherAiSidebarPanelProps): React.JSX.Element {
  const { info, labels, mode, onPointerEnter, onPointerLeave } = props
  const workspaceName = getFolderName(info.workspacePath) ?? labels.environmentNoWorkspace
  const modelLabel = info.modelLabel ?? labels.environmentNoModel
  const threadLabel = info.threadId ?? labels.environmentNoThread

  return (
    <aside
      className="launcher-ai-sidebar-panel"
      aria-label={labels.expandSidebar}
      data-mode={mode}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="launcher-ai-sidebar-panel__current">
        <div className="launcher-ai-sidebar-panel__title" title={info.title}>
          {info.title}
        </div>
        <FactRow
          label={labels.environmentWorkspace}
          title={info.workspacePath ?? workspaceName}
          value={workspaceName}
        />
        <FactRow label={labels.environmentThread} value={threadLabel} />
        <FactRow label={labels.environmentModel} value={modelLabel} />
        <FactRow label={labels.environmentPermission} value={info.permissionLabel} />
      </div>

      <div className="launcher-ai-sidebar-panel__section">
        <PlaceholderRow
          icon={<Pin />}
          label={labels.sidebarPinned}
          unavailableLabel={labels.sidebarUnavailable}
        />
        <PlaceholderRow
          icon={<Clock3 />}
          label={labels.sidebarRecent}
          unavailableLabel={labels.sidebarUnavailable}
        />
        <PlaceholderRow
          icon={<FolderGit2 />}
          label={labels.sidebarSources}
          unavailableLabel={labels.sidebarUnavailable}
        />
      </div>
    </aside>
  )
}
