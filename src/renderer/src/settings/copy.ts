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
    builtPluginsTitle: string
    builtPluginsDescription: string
    translateModelLabel: string
    useEnvironmentFallback: string
    saved: string
    workspaceHint: string
  }
  extensions: {
    title: string
    rootsTitle: string
    rootsDescription: string
    installedTitle: string
    empty: string
    extensionPreferences: string
    commandPreferences: string
    sourceRoot: string
    extensionPath: string
    owner: string
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
    builtPluginsTitle: "内建插件",
    builtPluginsDescription: "目前先暴露 Translate 的模型设置。",
    translateModelLabel: "Translate 模型",
    useEnvironmentFallback: "跟随环境变量 / 默认值",
    saved: "已保存",
    workspaceHint: "线程级 workspace 仍然可以覆盖这里的默认值。"
  },
  extensions: {
    title: "外部 Extensions",
    rootsTitle: "扫描目录",
    rootsDescription: "这些目录会被当作 Raycast extension 根目录扫描。",
    installedTitle: "已发现 Extensions",
    empty: "还没有扫描到 extension。",
    extensionPreferences: "Extension Preferences",
    commandPreferences: "Command Preferences",
    sourceRoot: "来源目录",
    extensionPath: "扩展路径",
    owner: "作者",
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
    memorySourcesDescription: "One file or directory per line. Merged into the default agent memory sources.",
    builtPluginsTitle: "Built-in Plugins",
    builtPluginsDescription: "Exposes the Translate model setting for now.",
    translateModelLabel: "Translate Model",
    useEnvironmentFallback: "Use env var / fallback default",
    saved: "Saved",
    workspaceHint: "Thread-level workspace can still override this global default."
  },
  extensions: {
    title: "External Extensions",
    rootsTitle: "Scan Roots",
    rootsDescription: "These directories are scanned as Raycast extension roots.",
    installedTitle: "Installed Extensions",
    empty: "No extensions were discovered yet.",
    extensionPreferences: "Extension Preferences",
    commandPreferences: "Command Preferences",
    sourceRoot: "Source Root",
    extensionPath: "Extension Path",
    owner: "Owner",
    mode: "Mode",
    noPreferences: "No configurable preferences."
  }
}

export function getSettingsCopy(locale: AppLocale): SettingsCopy {
  return locale === "zh-CN" ? zhCN : enUS
}
