import { AiCoreHostProvider } from "@ai-core/AiCoreHost"
import { getAiShellConfig } from "@ai-core/ai-config"
import { NativeExtensionHostProvider } from "@extension-host/NativeExtensionHost"
import { LauncherCommandErrorPage } from "@launcher-components/LauncherCommandErrorPage"
import { Suspense } from "react"
import type { LauncherShellConfig } from "@shared/launcher"
import { AI_CHAT_COMMAND_NAME } from "@shared/launcher-ai"
import type { PermissionModeName } from "@shared/permission-mode"
import { useI18n } from "@/lib/i18n"
import type { Thread } from "@/types"
import { deriveLauncherCommandOwnerClipboardContext } from "@shared/clipboard-derivations"
import type { LauncherClipboardState } from "./LauncherClipboardContext"
import type { LauncherInputElement } from "./input-element"
import type { LauncherInputStatus } from "./launcher-input-status"
import type { ComposerAreaHandle } from "@/composer-area"
import type { ActiveLauncherCommandState } from "./hooks/useActiveLauncherCommand"
import type {
  LauncherCommandAddress,
  LauncherCommandOpenOptions,
  LauncherCommandRoute
} from "./pages/types"
import { isLauncherExtensionCommandRoute } from "./pages/types"

interface LauncherThreadCreateInput {
  modelId?: string
  permissionMode?: PermissionModeName
  source: string
  title: string
  visibility: string
}

interface LauncherThreadSubmitInput {
  message: string
  threadId: string
}

interface LauncherCommandSurfaceProps {
  activatePluginThread: (threadId: string) => Promise<void>
  branchPluginThread: (
    threadId: string,
    messageId?: string
  ) => Promise<{
    modelId: string
    threadId: string
    workspacePath: string
  }>
  clipboard: LauncherClipboardState
  closeActivePlugin: () => void
  commandState: ActiveLauncherCommandState
  createPluginThread: (input: LauncherThreadCreateInput) => Promise<{
    modelId: string
    threadId: string
    workspacePath: string
  }>
  getCurrentPluginThreadId: () => string | null
  hideLauncher: () => Promise<void>
  listPluginThreads: () => Promise<Thread[]>
  openCommand: (address: LauncherCommandAddress, options?: LauncherCommandOpenOptions) => void
  pluginInputRef: React.RefObject<LauncherInputElement | ComposerAreaHandle | null>
  pluginInputStatus: LauncherInputStatus
  route: LauncherCommandRoute
  searchShellConfig: LauncherShellConfig
  setPluginInputStatus: (status: LauncherInputStatus) => void
  shownSequence: number
  submitPluginThread: (input: LauncherThreadSubmitInput) => Promise<void>
}

/**
 * 渲染当前命令路由对应的 surface，并在这里装配 built-in / extension host。
 */
export function LauncherCommandSurface(props: LauncherCommandSurfaceProps): React.JSX.Element {
  const {
    activatePluginThread,
    branchPluginThread,
    clipboard,
    closeActivePlugin,
    commandState,
    createPluginThread,
    getCurrentPluginThreadId,
    hideLauncher,
    listPluginThreads,
    openCommand,
    pluginInputRef,
    pluginInputStatus,
    route,
    searchShellConfig,
    setPluginInputStatus,
    shownSequence,
    submitPluginThread
  } = props
  const { locale } = useI18n()
  const {
    activeBuiltInCommand,
    activeCommandCapabilities,
    activeCommandClipboardEnabled,
    activeCommandError,
    activeCommandErrorTitle,
    activeCommandHostReady,
    activeCommandNavigationEnabled,
    activeCommandOwner,
    activeCommandPreferences,
    activeCommandSurfaceEnabled,
    activeCommandThreadsEnabled,
    activeViewCommand,
    viewportHeight
  } = commandState
  const ActivePluginComponent = activeViewCommand?.Component ?? null
  const nativeExtensionInputRef = pluginInputRef as React.RefObject<LauncherInputElement | null>
  const builtInSurfaceShellConfig =
    activeBuiltInCommand && route.commandName === AI_CHAT_COMMAND_NAME
      ? getAiShellConfig(searchShellConfig)
      : searchShellConfig

  if (activeCommandError) {
    return (
      <LauncherCommandErrorPage
        description={activeCommandError}
        onBack={closeActivePlugin}
        onOpenSettings={() => {
          if (!isLauncherExtensionCommandRoute(route)) {
            return
          }

          void window.api.settings.openWindow({
            tab: "extensions",
            target: {
              commandName: route.commandName,
              extensionName: route.extensionName
            }
          })
        }}
        title={activeCommandErrorTitle}
      />
    )
  }

  if (!activeViewCommand || !ActivePluginComponent) {
    return <div aria-busy="true" className="h-full w-full" />
  }

  if (
    isLauncherExtensionCommandRoute(route) &&
    activeCommandOwner &&
    activeCommandCapabilities &&
    activeCommandHostReady
  ) {
    return (
      <NativeExtensionHostProvider
        value={{
          capabilities: activeCommandCapabilities,
          clipboard: activeCommandClipboardEnabled
            ? {
                clearContext: clipboard.clearContext,
                context: deriveLauncherCommandOwnerClipboardContext(
                  clipboard.context,
                  activeCommandOwner.manifest.clipboard
                )
              }
            : undefined,
          commandName: route.commandName,
          commandPreferences: activeCommandPreferences ?? {},
          extensionName: route.extensionName,
          initialAction: route.initialAction,
          launchProps: route.launchProps,
          locale,
          navigation: activeCommandNavigationEnabled
            ? {
                goHome: closeActivePlugin,
                hideLauncher,
                openCommand
              }
            : undefined,
          seedQuery: route.seedQuery,
          surface: activeCommandSurfaceEnabled
            ? {
                inputRef: nativeExtensionInputRef,
                inputStatus: pluginInputStatus,
                shellConfig: searchShellConfig,
                setInputStatus: setPluginInputStatus,
                shownSequence,
                viewportHeight
              }
            : undefined,
          threads: activeCommandThreadsEnabled
            ? {
                create: createPluginThread,
                submit: submitPluginThread
              }
            : undefined
        }}
      >
        <Suspense fallback={<div aria-busy="true" className="h-full w-full" />}>
          <ActivePluginComponent
            key={`${route.kind}:${route.extensionName}:${route.commandName}:${route.initialAction}:${JSON.stringify(route.launchProps ?? {})}`}
          />
        </Suspense>
      </NativeExtensionHostProvider>
    )
  }

  if (
    activeBuiltInCommand &&
    activeCommandHostReady &&
    activeCommandClipboardEnabled &&
    activeCommandNavigationEnabled &&
    activeCommandSurfaceEnabled &&
    activeCommandThreadsEnabled
  ) {
    return (
      <AiCoreHostProvider
        value={{
          clipboard: {
            clearContext: clipboard.clearContext,
            context: deriveLauncherCommandOwnerClipboardContext(
              clipboard.context,
              activeCommandOwner?.manifest.clipboard
            )
          },
          commandName: route.commandName,
          initialAction: route.initialAction,
          navigation: {
            goHome: closeActivePlugin,
            hideLauncher,
            openCommand
          },
          seedQuery: route.seedQuery,
          surface: {
            inputRef: pluginInputRef,
            inputStatus: pluginInputStatus,
            shellConfig: builtInSurfaceShellConfig,
            setInputStatus: setPluginInputStatus,
            shownSequence,
            viewportHeight
          },
          threads: {
            activate: activatePluginThread,
            clone: (threadId) => branchPluginThread(threadId),
            cloneUntilMessage: branchPluginThread,
            create: createPluginThread,
            getActiveThreadId: getCurrentPluginThreadId,
            list: listPluginThreads,
            submit: submitPluginThread
          }
        }}
      >
        <Suspense fallback={<div aria-busy="true" className="h-full w-full" />}>
          <ActivePluginComponent
            key={`${route.kind}:${route.commandName}:${route.initialAction}`}
          />
        </Suspense>
      </AiCoreHostProvider>
    )
  }

  return <div aria-busy="true" className="h-full w-full" />
}
