import type { AppLocale } from "../../../shared/i18n"

interface SettingsCopy {
  title: string
  tabs: {
    extensions: string
    general: string
    provider: string
    shortcuts: string
  }
  common: {
    addRoot: string
    cancel: string
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
  provider: {
    title: string
    description: string
    apiRequired: string
    connectedSection: string
    configureTip: string
    defaultModelTitle: string
    defaultModelDescription: string
    defaultBadge: string
    defaultModelUnavailable: string
    emptyStateTitle: string
    emptyStateTip: string
    configured: string
    llmBadge: string
    modelListErrorBadge: string
    modelsCount: (count: number) => string
    notConfigured: string
    addKey: string
    editKey: string
    modelsAvailable: (count: number) => string
    sectionTitle: string
    secureStorageHint: string
    showModels: string
    retryModels: string
    systemSettings: string
    toBeConfigured: string
  }
  extensions: {
    title: string
    rootsDescription: string
    installedTitle: string
    empty: string
    mode: string
    noPreferences: string
  }
  shortcuts: {
    title: string
    description: string
    edit: string
    useDefault: string
    cancel: string
    saved: string
    reset: string
    defaultBinding: string
    customBinding: string
    defaultBindingLabel: string
    registrationStatus: string
    recordingTitle: string
    recordingDescription: string
    recordingPlaceholder: string
    available: string
    unavailable: string
    unknown: string
    notSet: string
  }
}

const zhCN: SettingsCopy = {
  title: "设置",
  tabs: {
    extensions: "Extensions",
    general: "通用",
    provider: "模型",
    shortcuts: "快捷键"
  },
  common: {
    addRoot: "添加目录",
    cancel: "取消",
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
  provider: {
    title: "Model Provider",
    description: "集中管理默认模型和各 provider 的凭证状态。",
    apiRequired: "需要 API Key",
    connectedSection: "已接入 Provider",
    configureTip: "先配置凭证，再让这个 provider 参与默认模型和运行时解析。",
    defaultModelTitle: "默认模型",
    defaultModelDescription: "这里的选择会直接影响 launcher、新线程和 runtime 默认模型。",
    defaultBadge: "默认",
    defaultModelUnavailable: "当前还没有可用模型。先配置任意 provider 的密钥，再设置默认模型。",
    emptyStateTitle: "还没有可用的模型 provider",
    emptyStateTip: "先为任意 provider 配置密钥。配置完成后，这里会展示已接入 provider 和模型列表。",
    configured: "已配置",
    llmBadge: "LLM",
    modelListErrorBadge: "模型列表失败",
    modelsCount: (count) => `${count} 个模型`,
    notConfigured: "未配置",
    addKey: "添加密钥",
    editKey: "编辑密钥",
    modelsAvailable: (count) => `可用模型 ${count} 个`,
    sectionTitle: "模型",
    secureStorageHint: "Provider secret 只写入系统安全存储，不再写入 ~/.openwork/.env。",
    showModels: "查看模型",
    retryModels: "重试模型列表",
    systemSettings: "系统模型设置",
    toBeConfigured: "待配置"
  },
  extensions: {
    title: "Extensions",
    rootsDescription: "这里直接展示 Openwork 一方 native extensions 的 schema 和命令设置。",
    installedTitle: "搜索 Extensions",
    empty: "还没有扫描到 extension。",
    mode: "模式",
    noPreferences: "没有可配置项。"
  },
  shortcuts: {
    title: "快捷键",
    description: "当前只开放应用级快捷键。页面内部导航快捷键仍保持固定产品语义。",
    edit: "编辑快捷键",
    useDefault: "恢复默认",
    cancel: "取消",
    saved: "已保存",
    reset: "已恢复默认",
    defaultBinding: "默认绑定",
    customBinding: "自定义绑定",
    defaultBindingLabel: "默认值",
    registrationStatus: "全局注册状态",
    recordingTitle: "录制新快捷键",
    recordingDescription: "聚焦下面的按钮后按下新的快捷键组合。",
    recordingPlaceholder: "按下新的快捷键",
    available: "可用",
    unavailable: "不可用",
    unknown: "未知",
    notSet: "未设置"
  }
}

const enUS: SettingsCopy = {
  title: "Settings",
  tabs: {
    extensions: "Extensions",
    general: "General",
    provider: "Models",
    shortcuts: "Shortcuts"
  },
  common: {
    addRoot: "Add Root",
    cancel: "Cancel",
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
  provider: {
    title: "Model Providers",
    description: "Manage the default model and provider credentials from one place.",
    apiRequired: "API key required",
    connectedSection: "Connected Providers",
    configureTip:
      "Configure credentials first before this provider participates in default-model and runtime resolution.",
    defaultModelTitle: "Default Model",
    defaultModelDescription:
      "This default is used by launcher flows, new threads, and runtime resolution.",
    defaultBadge: "Default",
    defaultModelUnavailable:
      "No model is available yet. Configure a provider key first, then choose the default model.",
    emptyStateTitle: "No model provider is available yet",
    emptyStateTip:
      "Configure a key for any provider first. Once connected, this page shows providers and model lists.",
    configured: "Configured",
    llmBadge: "LLM",
    modelListErrorBadge: "Model list failed",
    modelsCount: (count) => `${count} model${count === 1 ? "" : "s"}`,
    notConfigured: "Not configured",
    addKey: "Add Key",
    editKey: "Edit Key",
    modelsAvailable: (count) => `${count} models available`,
    sectionTitle: "Models",
    secureStorageHint:
      "Provider secrets are stored in secure system storage and are no longer written to ~/.openwork/.env.",
    showModels: "Show Models",
    retryModels: "Retry Models",
    systemSettings: "System Model Settings",
    toBeConfigured: "To Be Configured"
  },
  extensions: {
    title: "Extensions",
    rootsDescription: "These settings are generated from native Openwork extension schemas.",
    installedTitle: "Search Extensions",
    empty: "No extensions were discovered yet.",
    mode: "Mode",
    noPreferences: "No configurable preferences."
  },
  shortcuts: {
    title: "Shortcuts",
    description:
      "Only app-level shortcuts are configurable right now. Surface navigation shortcuts remain fixed product semantics.",
    edit: "Edit Shortcut",
    useDefault: "Use Default",
    cancel: "Cancel",
    saved: "Saved",
    reset: "Restored default",
    defaultBinding: "Default binding",
    customBinding: "Custom binding",
    defaultBindingLabel: "Default",
    registrationStatus: "Global registration",
    recordingTitle: "Record new shortcut",
    recordingDescription: "Focus the button below, then press the new shortcut combination.",
    recordingPlaceholder: "Press the new shortcut",
    available: "Available",
    unavailable: "Unavailable",
    unknown: "Unknown",
    notSet: "Not set"
  }
}

export function getSettingsCopy(locale: AppLocale): SettingsCopy {
  return locale === "zh-CN" ? zhCN : enUS
}
