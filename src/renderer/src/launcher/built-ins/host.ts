import {
  useLauncherPluginClipboard,
  useLauncherPluginHost,
  useLauncherPluginLifecycle,
  useLauncherPluginNavigation,
  useLauncherPluginSurface,
  useLauncherPluginThreads
} from "../LauncherPluginHost"

export function useBuiltInLauncherHost() {
  return useLauncherPluginHost()
}

export const useBuiltInLauncherLifecycle = useLauncherPluginLifecycle
export const useBuiltInLauncherClipboard = useLauncherPluginClipboard
export const useBuiltInLauncherNavigation = useLauncherPluginNavigation
export const useBuiltInLauncherSurface = useLauncherPluginSurface
export const useBuiltInLauncherThreads = useLauncherPluginThreads
