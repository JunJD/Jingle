import type { AppLocale } from "@shared/i18n"

interface SettingsCopy {
  title: string
  tabs: {
    appearance: string
    extensions: string
    general: string
    memory: string
    provider: string
    quicklinks: string
    shortcuts: string
  }
  common: {
    addRoot: string
    cancel: string
    change: string
    choose: string
    clear: string
    error: string
    none: string
    remove: string
    reveal: string
    save: string
    hideSecret: string
    showSecret: string
  }
  general: {
    desktopAutomationAllowlistDescription: string
    desktopAutomationAllowlistTitle: string
    title: string
    workspaceTitle: string
    workspaceDescription: string
    launcherModeTitle: string
    launcherModeDescription: string
    launcherModeDefault: string
    launcherModeCompact: string
    localeTitle: string
    localeDescription: string
    skillSourcesTitle: string
    skillSourcesDescription: string
    nativeExtensionsTitle: string
    nativeExtensionsDescription: string
    noNativeExtensions: string
    useEnvironmentFallback: string
    saved: string
    workspaceHint: string
  }
  appearance: {
    accentColor: string
    behaviorDescription: string
    behaviorTitle: string
    codeFont: string
    codeTheme: string
    colorsDescription: string
    colorsTitle: string
    contrast: string
    copied: string
    copyTheme: string
    customTheme: string
    darkVariant: string
    description: string
    diffAddedColor: string
    diffRemovedColor: string
    fontsDescription: string
    fontsTitle: string
    importDescription: string
    importFailed: string
    importTheme: string
    importTitle: string
    imported: string
    inkColor: string
    lightVariant: string
    skillColor: string
    surfaceColor: string
    themeDescription: string
    themeTitle: string
    title: string
    tokenFormat: string
    translucentWindows: string
    uiFont: string
    variant: string
  }
  provider: {
    title: string
    description: string
    apiRequired: string
    connectedSection: string
    configureTip: string
    credentialColumn: string
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
    modelsColumn: string
    providerColumn: string
    registryLabel: string
    systemSettings: string
    typeColumn: string
    toBeConfigured: string
  }
  extensions: {
    connectAccount: string
    connectFailed: string
    connectingAccount: string
    connectionConnected: string
    connectionDescription: string
    connectionMissing: string
    connectionTitle: string
    disabled: string
    enabled: string
    title: string
    rootsDescription: string
    installedTitle: string
    empty: string
    mode: string
    noPreferences: string
  }
  memory: {
    accept: string
    add: string
    archive: string
    askBeforeSaving: string
    askBeforeSavingDescription: string
    content: string
    contextSources: string
    correction: string
    delete: string
    description: string
    emptyMemories: string
    emptySuggestions: string
    global: string
    loading: string
    memoryType: string
    pendingSuggestions: string
    reject: string
    savedMemories: string
    savedStatus: string
    scope: string
    showIncludedMemories: string
    showIncludedMemoriesDescription: string
    title: string
    useMemory: string
    useMemoryDescription: string
    workspace: string
    workspaceContext: string
    aboutMe: string
  }
  quicklinks: {
    commandLink: string
    description: string
    empty: string
    link: string
    name: string
    remove: string
    save: string
    shortcut: string
    title: string
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
    appearance: "外观",
    extensions: "Extensions",
    general: "通用",
    memory: "记忆",
    provider: "模型",
    quicklinks: "Quicklinks",
    shortcuts: "快捷键"
  },
  common: {
    addRoot: "添加目录",
    cancel: "取消",
    change: "更换",
    choose: "选择",
    clear: "清空",
    error: "错误",
    none: "未设置",
    remove: "移除",
    reveal: "在 Finder 中显示",
    save: "保存",
    hideSecret: "隐藏密钥",
    showSecret: "显示密钥"
  },
  general: {
    desktopAutomationAllowlistDescription:
      "每行一个 bundle id 或应用名。白名单内的桌面自动化会直接执行，不再弹审批。",
    desktopAutomationAllowlistTitle: "Desktop Automation 白名单",
    title: "Jingle 基础设置",
    workspaceTitle: "默认 Workspace",
    workspaceDescription: "Launcher 和新建线程会优先使用这个全局 workspace。",
    launcherModeTitle: "Launcher 窗口模式",
    launcherModeDescription: "控制根搜索默认展示密度。",
    launcherModeDefault: "默认",
    launcherModeCompact: "紧凑",
    localeTitle: "界面语言",
    localeDescription: "影响应用文案和设置页语言。",
    skillSourcesTitle: "Skill Sources",
    skillSourcesDescription: "每行一个目录，会并入 agent 默认技能源。",
    nativeExtensionsTitle: "Native Extensions",
    nativeExtensionsDescription: "管理 Jingle 内置 extension 的偏好设置。",
    noNativeExtensions: "当前没有带设置项的 native extension。",
    useEnvironmentFallback: "跟随环境变量 / 默认值",
    saved: "已保存",
    workspaceHint: "线程级 workspace 仍然可以覆盖这里的默认值。"
  },
  appearance: {
    accentColor: "强调色",
    behaviorDescription: "控制窗口透明度、主题风格、主题明暗和整体对比度。",
    behaviorTitle: "主题行为",
    codeFont: "代码字体",
    codeTheme: "主题风格 ID",
    colorsDescription: "这些颜色会映射到 Jingle 的 semantic token。",
    colorsTitle: "颜色",
    contrast: "对比度",
    copied: "已复制主题",
    copyTheme: "复制主题",
    customTheme: "自定义",
    darkVariant: "深色",
    description: "配置 Codex theme v1 格式，实时应用到窗口、Launcher 和设置页。",
    diffAddedColor: "Diff 新增",
    diffRemovedColor: "Diff 删除",
    fontsDescription: "留空时使用 Jingle 默认 UI 字体和代码字体。",
    fontsTitle: "字体",
    importDescription: "粘贴 codex-theme-v1 token 后导入当前主题。",
    importFailed: "主题格式不正确",
    importTheme: "导入主题",
    importTitle: "导入",
    imported: "已导入主题",
    inkColor: "前景色",
    lightVariant: "浅色",
    skillColor: "Skill 语义色",
    surfaceColor: "背景",
    themeDescription: "选择一个基础主题，再按需微调颜色、字体和对比度。",
    themeTitle: "主题",
    title: "外观",
    tokenFormat: "codex-theme-v1",
    translucentWindows: "半透明窗口",
    uiFont: "UI 字体",
    variant: "模式"
  },
  provider: {
    title: "Model Provider",
    description: "集中管理默认模型和各 provider 的凭证状态。",
    apiRequired: "需要 API Key",
    connectedSection: "已接入 Provider",
    configureTip: "先配置凭证，再让这个 provider 参与默认模型和运行时解析。",
    credentialColumn: "凭证",
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
    secureStorageHint: "Provider secret 写入 Jingle auth.json，不再写入 ~/.openwork/.env。",
    showModels: "查看模型",
    retryModels: "重试模型列表",
    modelsColumn: "模型",
    providerColumn: "Provider",
    registryLabel: "Provider Registry",
    systemSettings: "系统模型设置",
    typeColumn: "类型",
    toBeConfigured: "待配置"
  },
  extensions: {
    connectAccount: "连接账号",
    connectFailed: "无法启动授权，请稍后重试。",
    connectingAccount: "正在打开授权",
    connectionConnected: "已连接",
    connectionDescription: "账号授权由 Jingle 管理；extension 只会收到运行所需的连接状态和 token。",
    connectionMissing: "未连接",
    connectionTitle: "账号连接",
    disabled: "关闭",
    enabled: "开启",
    title: "Extensions",
    rootsDescription: "管理 Jingle 内置 extension 的偏好和命令设置。",
    installedTitle: "搜索 Extensions",
    empty: "还没有扫描到 extension。",
    mode: "模式",
    noPreferences: "没有可配置项。"
  },
  memory: {
    accept: "保存",
    add: "添加记忆",
    archive: "归档",
    askBeforeSaving: "保存前确认",
    askBeforeSavingDescription: "V1 固定开启；Agent 只能创建待确认建议。",
    content: "内容",
    contextSources: "上下文来源",
    correction: "纠偏",
    delete: "删除",
    description: "管理本地个人记忆、当前工作区记忆和 Agent 建议。",
    emptyMemories: "还没有保存的记忆。",
    emptySuggestions: "没有待确认建议。",
    global: "全局",
    loading: "正在加载记忆...",
    memoryType: "类型",
    pendingSuggestions: "待确认建议",
    reject: "忽略",
    savedMemories: "已保存记忆",
    savedStatus: "已保存",
    scope: "范围",
    showIncludedMemories: "展示纳入记录",
    showIncludedMemoriesDescription: "对话完成后允许界面展示本轮纳入上下文的记忆。",
    title: "记忆",
    useMemory: "启用记忆",
    useMemoryDescription: "开启后，Agent 会在每次运行前读取本地记忆和上下文文件。",
    workspace: "当前工作区",
    workspaceContext: "当前工作区上下文",
    aboutMe: "关于我"
  },
  quicklinks: {
    commandLink: "Command Quicklink",
    description:
      "管理 extension 创建的 quicklink。它们会出现在 Launcher 搜索里，并可带 launch context 打开 command。",
    empty: "还没有 extension quicklink。",
    link: "链接",
    name: "名称",
    remove: "删除",
    save: "保存",
    shortcut: "快捷键",
    title: "Quicklinks"
  },
  shortcuts: {
    title: "快捷键",
    description: "配置 Launcher 唤起、主页入口等少数稳定快捷键。",
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
    appearance: "Appearance",
    extensions: "Extensions",
    general: "General",
    memory: "Memory",
    provider: "Models",
    quicklinks: "Quicklinks",
    shortcuts: "Shortcuts"
  },
  common: {
    addRoot: "Add Root",
    cancel: "Cancel",
    change: "Change",
    choose: "Choose",
    clear: "Clear",
    error: "Error",
    none: "Not set",
    remove: "Remove",
    reveal: "Reveal in Finder",
    save: "Save",
    hideSecret: "Hide secret",
    showSecret: "Show secret"
  },
  general: {
    desktopAutomationAllowlistDescription:
      "One bundle id or app name per line. Allowlisted desktop automation runs directly without HITL approval.",
    desktopAutomationAllowlistTitle: "Desktop Automation Allowlist",
    title: "Jingle Foundation",
    workspaceTitle: "Default Workspace",
    workspaceDescription: "Launcher and new threads use this global workspace by default.",
    launcherModeTitle: "Launcher Window Mode",
    launcherModeDescription: "Controls the default density of root search.",
    launcherModeDefault: "Default",
    launcherModeCompact: "Compact",
    localeTitle: "Interface Language",
    localeDescription: "Affects app copy and settings language.",
    skillSourcesTitle: "Skill Sources",
    skillSourcesDescription: "One directory per line. Merged into the default agent skill sources.",
    nativeExtensionsTitle: "Native Extensions",
    nativeExtensionsDescription: "Manage preferences for built-in Jingle extensions.",
    noNativeExtensions: "No native extensions expose preferences yet.",
    useEnvironmentFallback: "Use env var / fallback default",
    saved: "Saved",
    workspaceHint: "Thread-level workspace can still override this global default."
  },
  appearance: {
    accentColor: "Accent",
    behaviorDescription: "Controls opacity, theme style, light mode, dark mode, and contrast.",
    behaviorTitle: "Theme Behavior",
    codeFont: "Code Font",
    codeTheme: "Theme Style ID",
    colorsDescription: "These colors map into Jingle semantic tokens.",
    colorsTitle: "Colors",
    contrast: "Contrast",
    copied: "Theme copied",
    copyTheme: "Copy Theme",
    customTheme: "Custom",
    darkVariant: "Dark",
    description: "Configure Codex theme v1 and apply it to windows, Launcher, and Settings.",
    diffAddedColor: "Diff Added",
    diffRemovedColor: "Diff Removed",
    fontsDescription: "Leave blank to use the Jingle default UI and code fonts.",
    fontsTitle: "Fonts",
    importDescription: "Paste a codex-theme-v1 token to import it as the current theme.",
    importFailed: "Theme token is invalid",
    importTheme: "Import Theme",
    importTitle: "Import",
    imported: "Theme imported",
    inkColor: "Ink",
    lightVariant: "Light",
    skillColor: "Skill Semantic",
    surfaceColor: "Surface",
    themeDescription: "Start from a preset, then adjust colors, fonts, and contrast.",
    themeTitle: "Theme",
    title: "Appearance",
    tokenFormat: "codex-theme-v1",
    translucentWindows: "Translucent Windows",
    uiFont: "UI Font",
    variant: "Variant"
  },
  provider: {
    title: "Model Providers",
    description: "Manage the default model and provider credentials from one place.",
    apiRequired: "API key required",
    connectedSection: "Connected Providers",
    configureTip:
      "Configure credentials first before this provider participates in default-model and runtime resolution.",
    credentialColumn: "Credential",
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
      "Provider secrets are stored in Jingle auth.json and are no longer written to ~/.openwork/.env.",
    showModels: "Show Models",
    retryModels: "Retry Models",
    modelsColumn: "Models",
    providerColumn: "Provider",
    registryLabel: "Provider Registry",
    systemSettings: "System Model Settings",
    typeColumn: "Type",
    toBeConfigured: "To Be Configured"
  },
  extensions: {
    connectAccount: "Connect Account",
    connectFailed: "Failed to start authorization. Try again.",
    connectingAccount: "Opening Authorization",
    connectionConnected: "Connected",
    connectionDescription:
      "Jingle manages account authorization; extensions only receive the connection state and token needed at runtime.",
    connectionMissing: "Not Connected",
    connectionTitle: "Account Connection",
    disabled: "Off",
    enabled: "On",
    title: "Extensions",
    rootsDescription: "Manage preferences and commands for built-in Jingle extensions.",
    installedTitle: "Search Extensions",
    empty: "No extensions were discovered yet.",
    mode: "Mode",
    noPreferences: "No configurable preferences."
  },
  memory: {
    accept: "Save",
    add: "Add memory",
    archive: "Archive",
    askBeforeSaving: "Confirm before saving",
    askBeforeSavingDescription: "Always on in V1. The agent can only create pending suggestions.",
    content: "Content",
    contextSources: "Context Sources",
    correction: "Correction",
    delete: "Delete",
    description: "Manage local personal memory, current workspace memory, and agent suggestions.",
    emptyMemories: "No saved memories yet.",
    emptySuggestions: "No pending suggestions.",
    global: "Global",
    loading: "Loading memory...",
    memoryType: "Type",
    pendingSuggestions: "Pending Suggestions",
    reject: "Ignore",
    savedMemories: "Saved Memories",
    savedStatus: "Saved",
    scope: "Scope",
    showIncludedMemories: "Show included memories",
    showIncludedMemoriesDescription:
      "Allow the UI to show which memories were included after a run.",
    title: "Memory",
    useMemory: "Use memory",
    useMemoryDescription:
      "When enabled, the agent reads local memory and context files before a run.",
    workspace: "Current Workspace",
    workspaceContext: "Current workspace context",
    aboutMe: "About me"
  },
  quicklinks: {
    commandLink: "Command Quicklink",
    description:
      "Manage quicklinks created by extensions. They appear in Launcher search and can open commands with launch context.",
    empty: "No extension quicklinks yet.",
    link: "Link",
    name: "Name",
    remove: "Remove",
    save: "Save",
    shortcut: "Shortcut",
    title: "Quicklinks"
  },
  shortcuts: {
    title: "Shortcuts",
    description: "Configure stable shortcuts such as launcher toggle and home actions.",
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
