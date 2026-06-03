import type { AppLocale } from "@shared/i18n"

export interface AppCopy {
  app: {
    conversation: string
    initializing: string
    inspector: string
    inspectorSummary: string
    selectThreadToBegin: string
    workspaceSubtitle: string
  }
  apiKeyDialog: {
    addTitle: (providerName: string) => string
    addDescription: (providerName: string) => string
    cancel: string
    deleteError: string
    removeKey: string
    save: string
    saveError: string
    secureStorageHint: string
    updateTitle: (providerName: string) => string
    updateDescription: string
  }
  chat: {
    agentError: string
    agentErrorRecovery: string
    agentLabel: string
    copyMessage: string
    agentTasks: string
    agentThought: string
    agentThinking: string
    agentWorking: string
    executedSteps: (count: number) => string
    describeOutcome: string
    dismissError: string
    inputNeedsWorkspace: string
    memoryTemporaryOff: string
    memoryTemporaryOn: string
    pendingWorkspaceMemoryBlocksWorkspaceChange: string
    pendingMemoryAccept: string
    pendingMemoryReject: string
    pendingMemoryTitle: string
    includedMemoriesTitle: (count: number) => string
    subagentReferencesTitle: (count: number) => string
    messagePlaceholder: string
    newThreadEyebrow: string
    selectWorkspace: string
    selectWorkspaceHint: string
    selectWorkspaceTitle: string
    startConversation: string
    retryMessage: string
    tasksCompleted: (count: number) => string
    userLabel: string
  }
  common: {
    arguments: string
    approval: string
    completed: string
    copied: string
    error: string
    justNow: string
    ok: string
    rawArguments: string
    rawResult: string
    running: string
    synced: string
  }
  contextUsage: {
    cache: string
    cacheCreated: string
    cacheHits: string
    contextWindow: string
    critical: string
    input: string
    lastUpdated: string
    max: string
    moderate: string
    noCachedTokens: string
    normal: string
    output: string
    tokenBreakdown: string
    tokens: string
    total: string
    warning: string
  }
  launcher: {
    actionsLabel: string
    aiAddAttachment: string
    branchChat: string
    branchChatSwitched: string
    changeModel: string
    aiEmptyEyebrow: string
    aiEntryLabel: string
    aiIntentSubtitle: (query: string) => string
    aiFooterLeading: string
    aiHeroDescription: string
    aiHeroTitle: string
    aiInputPlaceholder: string
    aiInputPlaceholderSecondary: string
    aiPrimaryLabel: string
    aiStopLabel: string
    aiThreadTitle: string
    clearClipboardContext: string
    clipboardFiles: (count: number) => string
    clipboardImage: string
    enter: string
    goHome: string
    goToNextChat: string
    goToPreviousChat: string
    jumpToLatest: string
    newQuestion: string
    openSettings: string
    openAiHistory: string
    openApp: string
    permissionModeAskToEdit: string
    permissionModeAuto: string
    permissionModeExplore: string
    permissionModeSection: string
    commandMatches: string
    manageUseWithCommands: string
    useWithAvailable: string
    useWithDisableCommand: string
    useWithDisabledSubtitle: string
    useWithEnableCommand: string
    useWithEnabled: string
    useWithManagerTitle: string
    openGeneric: string
    openResult: string
    pinHistoryItem: string
    planned: string
    removeAttachment: string
    removeHistoryItem: string
    resultKindAgent: string
    resultKindApp: string
    resultKindExtension: string
    resultKindDirectory: string
    resultKindFile: string
    resultKindQuicklink: string
    resultKindUrl: string
    resultKindSuggestion: string
    resultKindThread: string
    searchInBrowserSuggestionSubtitle: string
    searchInBrowserSuggestionTitle: (query: string) => string
    searchSuggestionAction: string
    searchPlaceholder: string
    searchPlaceholderSecondary: string
    searching: string
    searchResults: string
    suggestions: string
    unpinHistoryItem: string
    useSuggestedQueryAction: string
    useSuggestedQuerySubtitle: string
    useSuggestedQueryTitle: (query: string) => string
    useWithSectionTitle: (query: string) => string
  }
  modelSwitcher: {
    apiKeyRequired: (providerName: string) => string
    configureApiKey: string
    editApiKey: string
    model: string
    noModelsAvailable: string
    provider: string
    providerError: (providerName: string) => string
    searchModels: string
    selectModel: string
  }
  sidebar: {
    delete: string
    newThread: string
    noThreads: string
    overview: string
    rename: string
  }
  toolCall: {
    approvalAction: string
    approvalApplyTitle: string
    approvalConfirmTitle: string
    approvalImpact: string
    approvalItem: string
    approvalParameters: string
    approvalPrediction: string
    approvalProfile: string
    approvalReason: string
    approvalRunTitle: string
    approvalSource: string
    approvalSubmit: string
    approvalTarget: string
    approve: string
    approveAndApply: string
    approveAndRun: string
    changeCreate: string
    changeDelete: string
    changeModify: string
    compactChangeSummary: (count: number) => string
    commandCompleted: string
    commandCompletedNoOutput: string
    completed: string
    edit: string
    fileReviewContent: string
    fileReviewDetails: string
    fileReviewOriginal: string
    fileReviewPath: string
    fileReviewUpdated: string
    fileSaved: string
    filesAndFolders: (files: number, dirs: number) => string
    foundMatches: (count: number) => string
    labels: Record<string, string>
    moreFiles: (count: number) => string
    moreItems: (count: number) => string
    moreLines: (count: number) => string
    moreMatches: (count: number) => string
    readLines: (count: number) => string
    reject: string
    rejectAndAdjust: string
    rejectFeedbackPlaceholder: string
    taskCompleted: string
    upcomingChanges: string
    writeLinesToFile: (count: number, fileName: string) => string
    matchesInFiles: (matchCount: number, fileCount: number) => string
  }
  workspacePicker: {
    changeFolder: string
    linkedHint: string
    selectFolder: string
    selectHint: string
    selectWorkspace: string
    title: string
  }
}

export const appCopy: Record<AppLocale, AppCopy> = {
  "zh-CN": {
    app: {
      conversation: "对话",
      initializing: "正在初始化...",
      inspector: "检查面板",
      inspectorSummary: "任务、文件、代理",
      selectThreadToBegin: "选择一个对话，或新建一个对话开始",
      workspaceSubtitle: "共享 Agent 工作区"
    },
    apiKeyDialog: {
      addTitle: (providerName) => `添加 ${providerName} API Key`,
      addDescription: (providerName) => `输入你的 ${providerName} API Key 以使用对应模型。`,
      cancel: "取消",
      deleteError: "移除密钥失败，请检查系统安全存储状态。",
      removeKey: "移除 Key",
      save: "保存",
      saveError: "保存密钥失败，请检查系统安全存储状态。",
      secureStorageHint: "密钥会写入系统安全存储，不会写入 ~/.openwork/.env。",
      updateTitle: (providerName) => `更新 ${providerName} API Key`,
      updateDescription: "输入新的 API Key 覆盖已有值，或直接移除。"
    },
    chat: {
      agentError: "Agent 错误",
      agentErrorRecovery: "你可以继续发送新消息，恢复这段对话。",
      agentLabel: "AGENT",
      copyMessage: "复制消息",
      agentTasks: "Agent 任务",
      agentThought: "已思考",
      agentThinking: "Agent 正在思考...",
      agentWorking: "正在工作",
      executedSteps: (count) => `已执行 ${count} 个步骤`,
      describeOutcome: "描述你想达成的结果。workspace 和 tools 会随后接上。",
      dismissError: "关闭错误",
      inputNeedsWorkspace: "请先选择一个 workspace 文件夹，再发送消息。",
      memoryTemporaryOff: "使用记忆",
      memoryTemporaryOn: "临时模式",
      pendingWorkspaceMemoryBlocksWorkspaceChange:
        "当前对话有待确认的工作区记忆。请先保存或忽略这些记忆，再更换 workspace。",
      pendingMemoryAccept: "保存",
      pendingMemoryReject: "忽略",
      pendingMemoryTitle: "待确认记忆",
      includedMemoriesTitle: (count) => `${count} 条记忆引用`,
      subagentReferencesTitle: (count) => `${count} 个子代理任务`,
      messagePlaceholder: "给 Agent 发送消息...",
      newThreadEyebrow: "新对话",
      selectWorkspace: "选择 workspace",
      selectWorkspaceHint: "Agent 需要一个 workspace 来创建和修改文件",
      selectWorkspaceTitle: "先选择一个 workspace 文件夹",
      startConversation: "开始和 Agent 对话",
      retryMessage: "重试回答",
      tasksCompleted: (count) => `${count} 个任务已完成`,
      userLabel: "你"
    },
    common: {
      arguments: "参数",
      approval: "待审批",
      completed: "已完成",
      copied: "已复制",
      error: "错误",
      justNow: "刚刚",
      ok: "正常",
      rawArguments: "原始参数",
      rawResult: "原始结果",
      running: "运行中",
      synced: "已同步"
    },
    contextUsage: {
      cache: "缓存",
      cacheCreated: "新建缓存",
      cacheHits: "缓存命中",
      contextWindow: "上下文窗口",
      critical: "临界",
      input: "输入",
      lastUpdated: "最近更新",
      max: "上限",
      moderate: "中等",
      noCachedTokens: "暂无缓存 token",
      normal: "正常",
      output: "输出",
      tokenBreakdown: "Token 构成",
      tokens: "tokens",
      total: "总计",
      warning: "警告"
    },
    launcher: {
      actionsLabel: "操作",
      aiAddAttachment: "添加附件",
      branchChat: "分叉对话",
      branchChatSwitched: "已切换到分叉对话",
      changeModel: "切换模型...",
      aiEmptyEyebrow: "Jingle",
      aiEntryLabel: "问 AI",
      aiIntentSubtitle: (query) => `带着“${query}”进入 AI`,
      aiFooterLeading: "快速 AI",
      aiHeroDescription: "把目标说清楚，剩下的交给我推进。",
      aiHeroTitle: "想做什么，直接说",
      aiInputPlaceholder: "描述你要完成的事情...",
      aiInputPlaceholderSecondary: "也可以直接贴文件、命令或报错信息",
      aiPrimaryLabel: "发给 AI",
      aiStopLabel: "停止",
      aiThreadTitle: "快速提问",
      clearClipboardContext: "清除剪贴板上下文",
      clipboardFiles: (count) => `${count} 个文件`,
      clipboardImage: "剪贴板图片",
      enter: "回车",
      goHome: "回到主页",
      goToNextChat: "前往下一个对话",
      goToPreviousChat: "前往上一个对话",
      jumpToLatest: "跳到最新",
      newQuestion: "新问题",
      openSettings: "打开设置",
      openAiHistory: "打开 AI 页面",
      openApp: "打开应用",
      permissionModeAskToEdit: "默认权限",
      permissionModeAuto: "完全访问权限",
      permissionModeExplore: "自动审查",
      permissionModeSection: "权限模式",
      commandMatches: "命令",
      manageUseWithCommands: "管理 Use With 命令",
      useWithAvailable: "可用",
      useWithDisableCommand: "停用",
      useWithDisabledSubtitle: "不会出现在 Use With 分组中",
      useWithEnableCommand: "启用",
      useWithEnabled: "已启用",
      useWithManagerTitle: "Use With 命令",
      openGeneric: "打开",
      openResult: "打开结果",
      pinHistoryItem: "固定到搜索面板",
      planned: "规划中",
      removeAttachment: "移除附件",
      removeHistoryItem: "从使用记录中删除",
      resultKindAgent: "Agent",
      resultKindApp: "应用",
      resultKindExtension: "扩展",
      resultKindDirectory: "文件夹",
      resultKindFile: "文件",
      resultKindQuicklink: "快捷链接",
      resultKindUrl: "网页",
      resultKindSuggestion: "建议",
      resultKindThread: "对话",
      searchInBrowserSuggestionSubtitle: "用默认浏览器搜索",
      searchInBrowserSuggestionTitle: (query) => `在浏览器中搜索“${query}”`,
      searchSuggestionAction: "搜索",
      searchPlaceholder: "你想处理什么工作？",
      searchPlaceholderSecondary: "搜应用、文件、命令，或直接问 AI",
      searching: "搜索中",
      searchResults: "搜索结果",
      suggestions: "建议",
      unpinHistoryItem: "取消固定",
      useSuggestedQueryAction: "填充",
      useSuggestedQuerySubtitle: "只填充输入框",
      useSuggestedQueryTitle: (query) => `补全为“${query}”`,
      useWithSectionTitle: (query) => `使用“${query}”打开...`
    },
    modelSwitcher: {
      apiKeyRequired: (providerName) => `${providerName} 需要 API Key`,
      configureApiKey: "配置 API Key",
      editApiKey: "编辑 API Key",
      model: "模型",
      noModelsAvailable: "没有可用模型",
      provider: "提供商",
      providerError: (providerName) => `${providerName} 模型列表读取失败`,
      searchModels: "搜索模型...",
      selectModel: "选择模型"
    },
    sidebar: {
      delete: "删除",
      newThread: "新对话",
      noThreads: "还没有对话",
      overview: "总览",
      rename: "重命名"
    },
    toolCall: {
      approvalAction: "动作",
      approvalApplyTitle: "是否应用这些变更？",
      approvalConfirmTitle: "是否继续执行？",
      approvalImpact: "预期影响",
      approvalItem: "审批事项",
      approvalParameters: "参数",
      approvalPrediction: "预测状态",
      approvalProfile: "执行类型",
      approvalReason: "原因",
      approvalRunTitle: "是否执行这个命令？",
      approvalSource: "来源",
      approvalSubmit: "提交",
      approvalTarget: "目标",
      approve: "批准",
      approveAndApply: "批准并修改",
      approveAndRun: "批准并执行",
      changeCreate: "新增",
      changeDelete: "删除",
      changeModify: "修改",
      compactChangeSummary: (count) => `${count} 个文件`,
      commandCompleted: "命令已完成",
      commandCompletedNoOutput: "命令已完成，无输出",
      completed: "已完成",
      edit: "编辑",
      fileReviewContent: "写入内容",
      fileReviewDetails: "内容详情",
      fileReviewOriginal: "当前内容",
      fileReviewPath: "路径",
      fileReviewUpdated: "更新后内容",
      fileSaved: "文件已保存",
      filesAndFolders: (files, dirs) =>
        dirs > 0 ? `${files} 个文件，${dirs} 个文件夹` : `${files} 个文件`,
      foundMatches: (count) => `找到 ${count} 个匹配`,
      labels: {
        click_screen_point: "坐标点击",
        edit_file: "编辑文件",
        execute: "执行命令",
        find_ax_elements: "查找 AX 元素",
        glob: "查找文件",
        grep: "搜索内容",
        ls: "列出目录",
        open_application: "打开应用",
        open_desktop_route: "打开桌面路由",
        present_artifacts: "呈现成果",
        press_ax_element: "按压 AX 元素",
        read_file: "读取文件",
        task: "子代理任务",
        web_search: "搜索网页",
        write_file: "写入文件",
        write_todos: "更新任务"
      },
      matchesInFiles: (matchCount, fileCount) => `${matchCount} 个匹配，来自 ${fileCount} 个文件`,
      moreFiles: (count) => `另外 ${count} 个文件仍有匹配`,
      moreItems: (count) => `... 以及另外 ${count} 项`,
      moreLines: (count) => `... 还有 ${count} 行`,
      moreMatches: (count) => `另外 ${count} 个匹配`,
      readLines: (count) => `读取了 ${count} 行`,
      reject: "拒绝",
      rejectAndAdjust: "拒绝，请告知 Agent 如何调整",
      rejectFeedbackPlaceholder: "告诉 Agent 需要怎么调整（可选）",
      taskCompleted: "任务已完成",
      upcomingChanges: "即将变更",
      writeLinesToFile: (count, fileName) => `向 ${fileName} 写入 ${count} 行`
    },
    workspacePicker: {
      changeFolder: "更换文件夹",
      linkedHint: "Agent 会在这个文件夹里读取和写入文件。",
      selectFolder: "选择文件夹",
      selectHint: "为 Agent 选择一个工作目录。后续读写都会直接发生在这里。",
      selectWorkspace: "选择 workspace",
      title: "Workspace 文件夹"
    }
  },
  "en-US": {
    app: {
      conversation: "Conversation",
      initializing: "Initializing...",
      inspector: "Inspector",
      inspectorSummary: "Tasks, files, agents",
      selectThreadToBegin: "Select or create a thread to begin",
      workspaceSubtitle: "Shared Agent Workspace"
    },
    apiKeyDialog: {
      addTitle: (providerName) => `Add ${providerName} API Key`,
      addDescription: (providerName) => `Enter your ${providerName} API key to use their models.`,
      cancel: "Cancel",
      deleteError: "Failed to remove the key. Check secure system storage status.",
      removeKey: "Remove Key",
      save: "Save",
      saveError: "Failed to save the key. Check secure system storage status.",
      secureStorageHint:
        "Keys are stored in secure system storage and are not written to ~/.openwork/.env.",
      updateTitle: (providerName) => `Update ${providerName} API Key`,
      updateDescription: "Enter a new API key to replace the existing one, or remove it."
    },
    chat: {
      agentError: "Agent Error",
      agentErrorRecovery: "You can send a new message to continue the conversation.",
      agentLabel: "AGENT",
      copyMessage: "Copy message",
      agentTasks: "Agent Tasks",
      agentThought: "Thought",
      agentThinking: "Agent is thinking...",
      agentWorking: "Working",
      executedSteps: (count) => `${count} steps completed`,
      describeOutcome: "Describe the outcome you want. The workspace and tools will follow.",
      dismissError: "Dismiss error",
      inputNeedsWorkspace: "Please select a workspace folder before sending messages.",
      memoryTemporaryOff: "Use memory",
      memoryTemporaryOn: "Temporary",
      pendingWorkspaceMemoryBlocksWorkspaceChange:
        "This conversation has pending workspace memories. Save or ignore them before changing workspace.",
      pendingMemoryAccept: "Save",
      pendingMemoryReject: "Ignore",
      pendingMemoryTitle: "Pending Memory",
      includedMemoriesTitle: (count) =>
        `${count} memory reference${count === 1 ? "" : "s"}`,
      subagentReferencesTitle: (count) =>
        `${count} subagent task${count === 1 ? "" : "s"}`,
      messagePlaceholder: "Message the agent...",
      newThreadEyebrow: "New Thread",
      selectWorkspace: "Select workspace",
      selectWorkspaceHint: "The agent needs a workspace to create and modify files",
      selectWorkspaceTitle: "Select a workspace folder first",
      startConversation: "Start a conversation with the agent",
      retryMessage: "Retry response",
      tasksCompleted: (count) => `${count} task${count === 1 ? "" : "s"} completed`,
      userLabel: "YOU"
    },
    common: {
      arguments: "Arguments",
      approval: "Approval",
      completed: "Completed",
      copied: "Copied",
      error: "Error",
      justNow: "just now",
      ok: "OK",
      rawArguments: "Raw Arguments",
      rawResult: "Raw Result",
      running: "Running",
      synced: "Synced"
    },
    contextUsage: {
      cache: "Cache",
      cacheCreated: "Cache created",
      cacheHits: "Cache hits",
      contextWindow: "Context Window",
      critical: "Critical",
      input: "Input",
      lastUpdated: "Last updated",
      max: "max",
      moderate: "Moderate",
      noCachedTokens: "No cached tokens",
      normal: "Normal",
      output: "Output",
      tokenBreakdown: "Token Breakdown",
      tokens: "tokens",
      total: "Total",
      warning: "Warning"
    },
    launcher: {
      actionsLabel: "Actions",
      aiAddAttachment: "Add attachment",
      branchChat: "Branch Chat",
      branchChatSwitched: "Switched to branched chat",
      changeModel: "Change Model...",
      aiEmptyEyebrow: "Jingle",
      aiEntryLabel: "Ask AI",
      aiIntentSubtitle: (query) => `Open AI with “${query}”`,
      aiFooterLeading: "Quick AI",
      aiHeroDescription: "Tell me the outcome. I will move the work forward.",
      aiHeroTitle: "Ask anything",
      aiInputPlaceholder: "Ask AI anything...",
      aiInputPlaceholderSecondary: "You can also paste files, commands, or error output",
      aiPrimaryLabel: "Ask AI",
      aiStopLabel: "Stop",
      aiThreadTitle: "Ask Anything",
      clearClipboardContext: "Clear clipboard context",
      clipboardFiles: (count) => `${count} file${count === 1 ? "" : "s"}`,
      clipboardImage: "Clipboard image",
      enter: "Enter",
      goHome: "Go Home",
      goToNextChat: "Go to Next Chat",
      goToPreviousChat: "Go to Previous Chat",
      jumpToLatest: "Jump to latest",
      newQuestion: "New Question",
      openSettings: "Open Settings",
      openAiHistory: "Open AI",
      openApp: "Open App",
      permissionModeAskToEdit: "Default Permission",
      permissionModeAuto: "Full Access",
      permissionModeExplore: "Auto Review",
      permissionModeSection: "Permission Mode",
      commandMatches: "Commands",
      manageUseWithCommands: "Manage Fallback Commands",
      useWithAvailable: "Available",
      useWithDisableCommand: "Disable",
      useWithDisabledSubtitle: "Hidden from the Use With section",
      useWithEnableCommand: "Enable",
      useWithEnabled: "Enabled",
      useWithManagerTitle: "Use With Commands",
      openGeneric: "Open",
      openResult: "Open Result",
      pinHistoryItem: "Pin to launcher",
      planned: "Planned",
      removeAttachment: "Remove attachment",
      removeHistoryItem: "Remove from history",
      resultKindAgent: "Agent",
      resultKindApp: "App",
      resultKindExtension: "Extension",
      resultKindDirectory: "Folder",
      resultKindFile: "File",
      resultKindQuicklink: "Quicklink",
      resultKindUrl: "Webpage",
      resultKindSuggestion: "Suggestion",
      resultKindThread: "Thread",
      searchInBrowserSuggestionSubtitle: "Search with your default browser",
      searchInBrowserSuggestionTitle: (query) => `Search “${query}” in browser`,
      searchSuggestionAction: "Search",
      searchPlaceholder: "What do you want to get done?",
      searchPlaceholderSecondary: "Search apps, files, commands, or ask AI",
      searching: "Searching",
      searchResults: "Search Results",
      suggestions: "Suggestions",
      unpinHistoryItem: "Unpin",
      useSuggestedQueryAction: "Fill",
      useSuggestedQuerySubtitle: "Only fill the input",
      useSuggestedQueryTitle: (query) => `Complete as “${query}”`,
      useWithSectionTitle: (query) => `Use “${query}” with...`
    },
    modelSwitcher: {
      apiKeyRequired: (providerName) => `API key required for ${providerName}`,
      configureApiKey: "Configure API Key",
      editApiKey: "Edit API Key",
      model: "Model",
      noModelsAvailable: "No models available",
      provider: "Provider",
      providerError: (providerName) => `Failed to load ${providerName} models`,
      searchModels: "Search models...",
      selectModel: "Select model"
    },
    sidebar: {
      delete: "Delete",
      newThread: "New Thread",
      noThreads: "No threads yet",
      overview: "Overview",
      rename: "Rename"
    },
    toolCall: {
      approvalAction: "Action",
      approvalApplyTitle: "Apply these changes?",
      approvalConfirmTitle: "Continue with this action?",
      approvalImpact: "Expected impact",
      approvalItem: "Approval Item",
      approvalParameters: "Parameters",
      approvalPrediction: "Prediction",
      approvalProfile: "Profile",
      approvalReason: "Reason",
      approvalRunTitle: "Run this command?",
      approvalSource: "Source",
      approvalSubmit: "Submit",
      approvalTarget: "Target",
      approve: "Approve",
      approveAndApply: "Approve & Apply",
      approveAndRun: "Approve & Run",
      changeCreate: "Create",
      changeDelete: "Delete",
      changeModify: "Modify",
      compactChangeSummary: (count) => `${count} file${count === 1 ? "" : "s"}`,
      commandCompleted: "Command completed",
      commandCompletedNoOutput: "Command completed (no output)",
      completed: "Completed",
      edit: "Edit",
      fileReviewContent: "Content",
      fileReviewDetails: "Content details",
      fileReviewOriginal: "Current Content",
      fileReviewPath: "Path",
      fileReviewUpdated: "Updated Content",
      fileSaved: "File saved",
      filesAndFolders: (files, dirs) =>
        dirs > 0
          ? `${files} file${files === 1 ? "" : "s"}, ${dirs} folder${dirs === 1 ? "" : "s"}`
          : `${files} file${files === 1 ? "" : "s"}`,
      foundMatches: (count) => `Found ${count} match${count === 1 ? "" : "es"}`,
      labels: {
        click_screen_point: "Click Screen Point",
        edit_file: "Edit File",
        execute: "Execute Command",
        find_ax_elements: "Find AX Elements",
        glob: "Find Files",
        grep: "Search Content",
        ls: "List Directory",
        open_application: "Open Application",
        open_desktop_route: "Open Desktop Route",
        present_artifacts: "Present Artifacts",
        press_ax_element: "Press AX Element",
        read_file: "Read File",
        task: "Subagent Task",
        web_search: "Search Web",
        write_file: "Write File",
        write_todos: "Update Tasks"
      },
      matchesInFiles: (matchCount, fileCount) =>
        `${matchCount} match${matchCount === 1 ? "" : "es"} in ${fileCount} file${
          fileCount === 1 ? "" : "s"
        }`,
      moreFiles: (count) => `... matches in ${count} more file${count === 1 ? "" : "s"}`,
      moreItems: (count) => `... and ${count} more`,
      moreLines: (count) => `... ${count} more lines`,
      moreMatches: (count) => `+${count} more matches`,
      readLines: (count) => `Read ${count} lines`,
      reject: "Reject",
      rejectAndAdjust: "Reject and tell the agent what to adjust",
      rejectFeedbackPlaceholder: "Tell the agent what to adjust (optional)",
      taskCompleted: "Task completed",
      upcomingChanges: "Upcoming changes",
      writeLinesToFile: (count, fileName) => `Writing ${count} lines to ${fileName}`
    },
    workspacePicker: {
      changeFolder: "Change Folder",
      linkedHint: "The agent will read and write files in this folder.",
      selectFolder: "Select Folder",
      selectHint:
        "Select a folder for the agent to work in. The agent will read and write files directly to this location.",
      selectWorkspace: "Select workspace",
      title: "Workspace Folder"
    }
  }
}
