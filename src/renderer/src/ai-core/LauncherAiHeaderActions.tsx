import {
  LauncherAiEnvironmentMenu,
  type LauncherAiEnvironmentInfo
} from "./LauncherAiEnvironmentMenu"
import { LauncherAiOpenTargetMenu } from "./LauncherAiOpenTargetMenu"
import { LauncherAiThreadMenu } from "./LauncherAiThreadMenu"

interface LauncherAiHeaderActionsProps {
  canBranchThread: boolean
  canOpenThreadMenu: boolean
  canOpenPinnedWindow: boolean
  showOpenPinnedWindowAction: boolean
  environment: LauncherAiEnvironmentInfo
  labels: {
    addAutomation: string
    actions: string
    branchIntoLocal: string
    branchIntoNewWorktree: string
    branchIntoSameWorktree: string
    branchMenu: string
    copyAsMarkdown: string
    copyChat: string
    copyDeeplink: string
    copySessionId: string
    copyWorkingDirectory: string
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
    environmentProgress: string
    environmentProgressMore: (count: number) => string
    environmentThread: string
    environmentWorkspace: string
    openSideChat: string
    openFolder: string
    openPinnedWindow: string
    openTarget: string
    pinChat: string
    renameChat: string
    underDevelopment: string
    unpinChat: string
  }
  isPinned: boolean
  onBranchIntoLocal: () => void
  onCopySessionId: () => void
  onCopyWorkingDirectory: () => void
  onOpenPinnedWindow: () => void
  onTogglePinned: () => void
}

export function LauncherAiHeaderActions(props: LauncherAiHeaderActionsProps): React.JSX.Element {
  const {
    canBranchThread,
    canOpenThreadMenu,
    canOpenPinnedWindow,
    environment,
    isPinned,
    labels,
    onBranchIntoLocal,
    onCopySessionId,
    onCopyWorkingDirectory,
    onOpenPinnedWindow,
    showOpenPinnedWindowAction,
    onTogglePinned
  } = props

  return (
    <div className="flex shrink-0 items-center gap-[var(--jingle-gap-xs)]">
      <LauncherAiOpenTargetMenu
        folderPath={environment.workspacePath}
        labels={{
          openFolder: labels.openFolder,
          openTarget: labels.openTarget
        }}
      />
      <LauncherAiEnvironmentMenu
        environment={environment}
        labels={{
          environmentDigest: labels.environmentDigest,
          environmentDigestCollapse: labels.environmentDigestCollapse,
          environmentDigestEmpty: labels.environmentDigestEmpty,
          environmentDigestError: labels.environmentDigestError,
          environmentDigestExpand: labels.environmentDigestExpand,
          environmentDigestGenerate: labels.environmentDigestGenerate,
          environmentDigestGenerating: labels.environmentDigestGenerating,
          environmentDigestRegenerate: labels.environmentDigestRegenerate,
          environmentDigestUpdated: labels.environmentDigestUpdated,
          environmentInfo: labels.environmentInfo,
          environmentModel: labels.environmentModel,
          environmentNoModel: labels.environmentNoModel,
          environmentNoThread: labels.environmentNoThread,
          environmentNoWorkspace: labels.environmentNoWorkspace,
          environmentPermission: labels.environmentPermission,
          environmentProgress: labels.environmentProgress,
          environmentProgressMore: labels.environmentProgressMore,
          environmentThread: labels.environmentThread,
          environmentWorkspace: labels.environmentWorkspace
        }}
      />
      {canOpenThreadMenu ? (
        <LauncherAiThreadMenu
          canBranchThread={canBranchThread}
          canOpenPinnedWindow={canOpenPinnedWindow}
          isPinned={isPinned}
          labels={{
            addAutomation: labels.addAutomation,
            branchIntoLocal: labels.branchIntoLocal,
            branchIntoNewWorktree: labels.branchIntoNewWorktree,
            branchIntoSameWorktree: labels.branchIntoSameWorktree,
            branchMenu: labels.branchMenu,
            copyAsMarkdown: labels.copyAsMarkdown,
            copyChat: labels.copyChat,
            copyDeeplink: labels.copyDeeplink,
            copySessionId: labels.copySessionId,
            copyWorkingDirectory: labels.copyWorkingDirectory,
            moreActions: labels.actions,
            openPinnedWindow: labels.openPinnedWindow,
            openSideChat: labels.openSideChat,
            pinChat: labels.pinChat,
            renameChat: labels.renameChat,
            underDevelopment: labels.underDevelopment,
            unpinChat: labels.unpinChat
          }}
          onBranchIntoLocal={onBranchIntoLocal}
          onCopySessionId={onCopySessionId}
          onCopyWorkingDirectory={onCopyWorkingDirectory}
          onOpenPinnedWindow={onOpenPinnedWindow}
          onTogglePinned={onTogglePinned}
          showOpenPinnedWindowAction={showOpenPinnedWindowAction}
        />
      ) : null}
    </div>
  )
}
