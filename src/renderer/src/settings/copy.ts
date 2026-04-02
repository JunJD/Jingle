import type { AppLocale } from "../../../shared/i18n"

interface SettingsCopy {
  title: string
  tabs: {
    extensions: string
    general: string
  }
  common: {
    addRoot: string
    change: string
    choose: string
    clear: string
    none: string
    remove: string
    reveal: string
    save: string
  }
  general: {
    title: string
    workspaceTitle: string
    workspaceDescription: string
    defaultModelTitle: string
    defaultModelDescription: string
    launcherModeTitle: string
    launcherModeDescription: string
    launcherModeDefault: string
    launcherModeCompact: string
    localeTitle: string
    localeDescription: string
    skillSourcesTitle: string
    skillSourcesDescription: string
    memorySourcesTitle: string
    memorySourcesDescription: string
    nativeExtensionsTitle: string
    nativeExtensionsDescription: string
    noNativeExtensions: string
    useEnvironmentFallback: string
    saved: string
    workspaceHint: string
  }
  extensions: {
    title: string
    rootsDescription: string
    installedTitle: string
    empty: string
    mode: string
    noPreferences: string
  }
}

const zhCN: SettingsCopy = {
  title: "设置",
  tabs: {
    extensions: "Extensions",
    general: "通用"
  },
  common: {
    addRoot: "添加目录",
    change: "更换",
    choose: "选择",
    clear: "清空",
    none: "未设置",
    remove: "移除",
    reveal: "在 Finder 中显示",
    save: "保存"
  },
  general: {
    title: "Openwork 基础设置",
    workspaceTitle: "默认 Workspace",
    workspaceDescription: "Launcher 和新建线程会优先使用这个全局 workspace。",
    defaultModelTitle: "默认模型",
    defaultModelDescription: "作为 launcher 和新线程的默认模型。",
    launcherModeTitle: "Launcher 窗口模式",
    launcherModeDescription: "控制根搜索默认展示密度。",
    launcherModeDefault: "默认",
    launcherModeCompact: "紧凑",
    localeTitle: "界面语言",
    localeDescription: "影响应用文案和设置页语言。",
    skillSourcesTitle: "Skill Sources",
    skillSourcesDescription: "每行一个目录，会并入 agent 默认技能源。",
    memorySourcesTitle: "Memory Sources",
    memorySourcesDescription: "每行一个文件或目录，会并入 agent 默认记忆源。",
    nativeExtensionsTitle: "Native Extensions",
    nativeExtensionsDescription: "这些设置直接来自 first-party extension package 的 schema。",
    noNativeExtensions: "当前没有带设置项的 native extension。",
    useEnvironmentFallback: "跟随环境变量 / 默认值",
    saved: "已保存",
    workspaceHint: "线程级 workspace 仍然可以覆盖这里的默认值。"
  },
  extensions: {
    title: "Extensions",
    rootsDescription: "这里直接展示 Openwork 一方 native extensions 的 schema 和命令设置。",
    installedTitle: "搜索 Extensions",
    empty: "还没有扫描到 extension。",
    mode: "模式",
    noPreferences: "没有可配置项。"
  }
}

const enUS: SettingsCopy = {
  title: "Settings",
  tabs: {
    extensions: "Extensions",
    general: "General"
  },
  common: {
    addRoot: "Add Root",
    change: "Change",
    choose: "Choose",
    clear: "Clear",
    none: "Not set",
    remove: "Remove",
    reveal: "Reveal in Finder",
    save: "Save"
  },
  general: {
    title: "Openwork Foundation",
    workspaceTitle: "Default Workspace",
    workspaceDescription: "Launcher and new threads use this global workspace by default.",
    defaultModelTitle: "Default Model",
    defaultModelDescription: "Used as the default model for launcher and new threads.",
    launcherModeTitle: "Launcher Window Mode",
    launcherModeDescription: "Controls the default density of root search.",
    launcherModeDefault: "Default",
    launcherModeCompact: "Compact",
    localeTitle: "Interface Language",
    localeDescription: "Affects app copy and settings language.",
    skillSourcesTitle: "Skill Sources",
    skillSourcesDescription: "One directory per line. Merged into the default agent skill sources.",
    memorySourcesTitle: "Memory Sources",
    memorySourcesDescription:
      "One file or directory per line. Merged into the default agent memory sources.",
    nativeExtensionsTitle: "Native Extensions",
    nativeExtensionsDescription:
      "These settings are generated directly from first-party extension package schemas.",
    noNativeExtensions: "No native extensions expose preferences yet.",
    useEnvironmentFallback: "Use env var / fallback default",
    saved: "Saved",
    workspaceHint: "Thread-level workspace can still override this global default."
  },
  extensions: {
    title: "Extensions",
    rootsDescription: "These settings are generated from native Openwork extension schemas.",
    installedTitle: "Search Extensions",
    empty: "No extensions were discovered yet.",
    mode: "Mode",
    noPreferences: "No configurable preferences."
  }
}

export function getSettingsCopy(locale: AppLocale): SettingsCopy {
  return locale === "zh-CN" ? zhCN : enUS
}
