import type { AppLocale } from "@shared/i18n"
import type { JingleRunCoachTipId } from "@jingle/agent-react"

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
    agentThought: string
    agentStatusThinking: string
    agentStatusSteered: string
    agentStatusWaitingApproval: string
    contextCompacted: string
    cancelEditMessage: string
    editUserMessage: string
    runCoachTip: Record<JingleRunCoachTipId, string>
    sendEditedMessage: string
    toolActivityChangedFiles: string
    toolActivityCompleted: string
    toolActivityCommands: (count: number) => string
    toolActivityExplored: string
    toolActivityFileMutations: (count: number) => string
    toolActivityFiles: (count: number) => string
    toolActivityLists: (count: number) => string
    toolActivityRanCommands: string
    toolActivityRunningCommand: string
    toolActivityRunningFileMutation: string
    toolActivityRunningGeneric: string
    toolActivityRunningList: string
    toolActivityRunningRead: string
    toolActivityRunningSearch: string
    toolActivityRunningWebSearch: string
    toolActivitySearches: (count: number) => string
    toolActivitySearchedWeb: string
    toolActivityWebSearches: (count: number) => string
    turnProcessed: string
    turnProcessSteps: (count: number) => string
    turnWorkedFor: (time: string) => string
    turnWorking: string
    turnWorkingFor: (time: string) => string
    addSelectionToChat: string
    executedSteps: (count: number) => string
    describeOutcome: string
    dismissError: string
    inputNeedsWorkspace: string
    messageContentUnavailable: string
    memoryTemporaryOff: string
    memoryTemporaryOn: string
    pendingWorkspaceMemoryBlocksWorkspaceChange: string
    pendingMemoryAccept: string
    pendingMemoryEvidenceTitle: (count: number) => string
    pendingMemoryReject: string
    pendingMemoryTitle: string
    includedMemoriesTitle: (count: number) => string
    contextEvidenceTitle: (count: number) => string
    contextEvidenceProvided: string
    contextEvidenceRetrieved: string
    contextEvidenceCited: string
    messagePlaceholder: string
    newThreadEyebrow: string
    queuedFollowUpDelete: string
    queuedFollowUpEdit: string
    queuedFollowUpMore: (count: number) => string
    queuedFollowUpSteer: string
    queuedFollowUpUntitled: string
    removeSelectionReference: string
    revealSelectionReference: string
    selectWorkspace: string
    selectWorkspaceHint: string
    selectWorkspaceTitle: string
    startConversation: string
    retryMessage: string
    selectedTextReferences: (count: number) => string
    userLabel: string
    userMessageNavigationJump: (position: number) => string
    userMessageNavigationLabel: string
    userMessageNavigationNoContent: string
    userMessageShowLess: string
    userMessageShowMore: string
  }
  common: {
    arguments: string
    approval: string
    close: string
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
  launcher: {
    actionsLabel: string
    addAutomation: string
    addClipboardContext: string
    aiAddAttachment: string
    archiveChat: string
    branchIntoLocal: string
    branchIntoNewWorktree: string
    branchIntoSameWorktree: string
    branchChat: string
    branchMenu: string
    branchChatSwitched: string
    changeModel: string
    aiEmptyEyebrow: string
    aiEntryLabel: string
    aiExtensionIntentSubtitle: (handle: string) => string
    aiExtensionIntentTitle: (name: string) => string
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
    collapseSidebar: string
    copyAsMarkdown: string
    copyChat: string
    copyDeeplink: string
    copySessionId: string
    copyWorkingDirectory: string
    enter: string
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
    environmentUnknownModel: (modelId: string) => string
    environmentProgress: string
    environmentProgressMore: (count: number) => string
    environmentThread: string
    environmentWorkspace: string
    expandSidebar: string
    goHome: string
    goToNextChat: string
    goToPreviousChat: string
    jumpToLatest: string
    addProject: string
    markAsUnread: string
    newQuestion: string
    organizeByProject: string
    organizeByTime: string
    openingThread: string
    openSettings: string
    openAiHistory: string
    openMainChat: string
    openFolder: string
    openMainWindow: string
    openThreadInNewWindow: string
    openTarget: string
    openSideChat: string
    openApp: string
    permissionModeAskToEdit: string
    permissionModeAuto: string
    permissionModeExplore: string
    permissionModeSection: string
    pinChat: string
    pinProject: string
    createPermanentWorktree: string
    projectOptions: string
    renameChat: string
    renameProject: string
    removeProject: string
    revealInFinder: string
    restoringThread: string
    sidebarAutomation: string
    sidebarArchiveAllChats: string
    sidebarChats: string
    sidebarEmptyPinned: string
    sidebarEmptyProjects: string
    sidebarEmptyRecent: string
    sidebarNewChat: string
    sidebarPinned: string
    sidebarProjects: string
    sidebarSearch: string
    sidebarWork: string
    clearWorkFilter: string
    sidebarSearchLoading: string
    sidebarSearchNoResults: string
    sortByCreated: string
    sortByManual: string
    sortByUpdated: string
    underDevelopment: string
    unpinChat: string
    workFilterError: string
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
    catalogError: string
    configureApiKey: string
    editApiKey: string
    loadError: string
    loading: string
    model: string
    modelDiscoveryPending: string
    noModelsAvailable: string
    openProviderSettings: string
    provider: string
    providerError: (providerName: string) => string
    retry: string
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
    accept: string
    approvalTarget: string
    approve: string
    approveAndApply: string
    approveAndRun: string
    appliedChanges: string
    compactChangeSummary: (count: number) => string
    commandCompleted: string
    commandCompletedNoOutput: string
    completed: string
    edit: string
    fileSaved: string
    filesAndFolders: (files: number, dirs: number) => string
    foundMatches: (count: number) => string
    labels: Record<string, string>
    moreFiles: (count: number) => string
    moreItems: (count: number) => string
    moreLines: (count: number) => string
    moreMatches: (count: number) => string
    readLines: (count: number) => string
    decline: string
    sendCorrection: string
    reject: string
    rejectAndAdjust: string
    correctionPlaceholder: string
    taskCompleted: string
    todoProgress: (completed: number, total: number) => string
    upcomingChanges: string
    writeLinesToFile: (count: number, fileName: string) => string
    matchesInFiles: (matchCount: number, fileCount: number) => string
  }
  runBotAgent: {
    addProject: string
    cancel: string
    cancelledError: string
    concurrentError: string
    confirm: string
    defaultStatus: string
    invalidLabelTypes: (labels: string) => string
    labels: string
    missingLabels: (labels: string) => string
    missingStatus: (status: string) => string
    noLabels: string
    noProjects: string
    project: string
    source: string
    status: string
    title: string
  }
  threadWorkflow: {
    add: string
    addLabelDefinition: string
    addStatus: string
    backToAssignments: string
    closedCategory: string
    defaultStatus: string
    edit: string
    labelDefinitions: string
    labelName: string
    labels: string
    manageDefinitions: string
    noLabels: string
    noParentLabel: string
    openCategory: string
    parentLabel: string
    removeLabel: (label: string) => string
    selectColor: (color: string) => string
    setDefaultStatus: (status: string) => string
    status: string
    statusDefinitions: string
    statusName: string
    unclassified: string
    valueType: string
    valuePlaceholder: (label: string) => string
    valueTypes: Record<"boolean" | "date" | "link" | "number" | "string", string>
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
      deleteError: "移除密钥失败，请检查本地凭证文件权限。",
      removeKey: "移除 Key",
      save: "保存",
      saveError: "保存密钥失败，请检查本地凭证文件权限。",
      secureStorageHint: "密钥会写入金果 auth.json，不会写入 ~/.jingle/.env。",
      updateTitle: (providerName) => `更新 ${providerName} API Key`,
      updateDescription: "输入新的 API Key 覆盖已有值，或直接移除。"
    },
    chat: {
      agentError: "Agent 错误",
      agentErrorRecovery: "你可以继续发送新消息，恢复这段对话。",
      agentLabel: "AGENT",
      copyMessage: "复制消息",
      agentThought: "已思考",
      agentStatusThinking: "正在思考",
      agentStatusSteered: "已引导对话",
      agentStatusWaitingApproval: "等待你确认",
      contextCompacted: "上下文已自动压缩",
      cancelEditMessage: "取消",
      editUserMessage: "编辑用户消息",
      runCoachTip: {
        iterate_after_first_draft: "第一版出来后，继续追问会更接近目标",
        keep_followups_in_thread: "同一目标下，继续追问更容易保留上下文",
        start_with_outcome: "说清楚结果和格式，我就少猜一步"
      },
      toolActivityChangedFiles: "已修改文件",
      toolActivityCompleted: "已处理工具",
      toolActivityCommands: (count) => `${count} 条命令`,
      toolActivityExplored: "已探索",
      toolActivityFileMutations: (count) => `${count} 个变更`,
      toolActivityFiles: (count) => `${count} 个文件`,
      toolActivityLists: (count) => `${count} 个列表`,
      toolActivityRanCommands: "已运行",
      toolActivityRunningCommand: "正在运行命令",
      toolActivityRunningFileMutation: "正在修改文件",
      toolActivityRunningGeneric: "正在使用工具",
      toolActivityRunningList: "正在列目录",
      toolActivityRunningRead: "正在读取文件",
      toolActivityRunningSearch: "正在搜索",
      toolActivityRunningWebSearch: "正在搜索网页",
      toolActivitySearches: (count) => `${count} 次搜索`,
      toolActivitySearchedWeb: "已搜索网页",
      toolActivityWebSearches: (count) => `${count} 次`,
      turnProcessed: "已处理",
      turnProcessSteps: (count) => `${count} 个步骤`,
      turnWorkedFor: (time) => `已处理 ${time}`,
      turnWorking: "处理中",
      turnWorkingFor: (time) => `处理中 ${time}`,
      addSelectionToChat: "添加到对话",
      executedSteps: (count) => `已执行 ${count} 个步骤`,
      describeOutcome: "描述你想达成的结果。workspace 和 tools 会随后接上。",
      dismissError: "关闭错误",
      inputNeedsWorkspace: "请先选择一个 workspace 文件夹，再发送消息。",
      messageContentUnavailable: "这条消息包含无法显示的内容。",
      memoryTemporaryOff: "使用记忆",
      memoryTemporaryOn: "临时模式",
      pendingWorkspaceMemoryBlocksWorkspaceChange:
        "当前对话有待确认的工作区记忆。请先保存或忽略这些记忆，再更换 workspace。",
      pendingMemoryAccept: "保存",
      pendingMemoryEvidenceTitle: (count) => `${count} 条来源`,
      pendingMemoryReject: "忽略",
      pendingMemoryTitle: "待确认记忆",
      includedMemoriesTitle: (count) => `${count} 条记忆引用`,
      contextEvidenceTitle: (count) => `${count} 条上下文`,
      contextEvidenceProvided: "已提供",
      contextEvidenceRetrieved: "已检索",
      contextEvidenceCited: "已引用",
      messagePlaceholder: "给 Agent 发送消息...",
      newThreadEyebrow: "新对话",
      queuedFollowUpDelete: "删除排队消息",
      queuedFollowUpEdit: "编辑排队消息",
      queuedFollowUpMore: (count) => `还有 ${count} 条后续消息`,
      queuedFollowUpSteer: "引导",
      queuedFollowUpUntitled: "后续消息",
      removeSelectionReference: "移除引用",
      revealSelectionReference: "跳到引用来源",
      selectWorkspace: "选择 workspace",
      selectWorkspaceHint: "Agent 需要一个 workspace 来创建和修改文件",
      selectWorkspaceTitle: "先选择一个 workspace 文件夹",
      sendEditedMessage: "发送",
      startConversation: "开始和 Agent 对话",
      retryMessage: "重试回答",
      selectedTextReferences: (count) => `${count} 个已选文本片段`,
      userLabel: "你",
      userMessageNavigationJump: (position) => `跳到第 ${position} 条用户消息`,
      userMessageNavigationLabel: "用户消息导航",
      userMessageNavigationNoContent: "无文本内容",
      userMessageShowLess: "收起",
      userMessageShowMore: "展开"
    },
    common: {
      arguments: "参数",
      approval: "待审批",
      close: "关闭",
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
    launcher: {
      actionsLabel: "操作",
      addAutomation: "添加自动化...",
      addClipboardContext: "添加剪贴板内容",
      aiAddAttachment: "添加图片",
      archiveChat: "归档对话",
      branchIntoLocal: "分叉到本地",
      branchIntoNewWorktree: "分叉到新 worktree",
      branchIntoSameWorktree: "分叉到同一 worktree",
      branchChat: "分叉对话",
      branchMenu: "分支",
      branchChatSwitched: "已切换到分叉对话",
      changeModel: "切换模型...",
      aiEmptyEyebrow: "金果",
      aiEntryLabel: "问 AI",
      aiExtensionIntentSubtitle: (handle) => `${handle} · AI 扩展`,
      aiExtensionIntentTitle: (name) => `问 ${name}`,
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
      collapseSidebar: "收起侧边栏",
      copyAsMarkdown: "复制为 Markdown",
      copyChat: "复制",
      copyDeeplink: "复制深层链接",
      copySessionId: "复制会话 ID",
      copyWorkingDirectory: "复制工作目录",
      enter: "回车",
      environmentDigest: "对话摘要",
      environmentDigestCollapse: "收起摘要",
      environmentDigestEmpty: "尚未生成摘要",
      environmentDigestError: "摘要暂不可用",
      environmentDigestExpand: "展开摘要",
      environmentDigestGenerate: "生成",
      environmentDigestGenerating: "生成中",
      environmentDigestRegenerate: "重新生成",
      environmentDigestUpdated: "更新于",
      environmentInfo: "环境信息",
      environmentModel: "模型",
      environmentNoModel: "暂无模型",
      environmentNoThread: "暂无会话",
      environmentNoWorkspace: "暂无 workspace",
      environmentPermission: "权限",
      environmentUnknownModel: (modelId) => `模型不可用（${modelId}）`,
      environmentProgress: "进度",
      environmentProgressMore: (count) => `再显示 ${count} 个`,
      environmentThread: "会话",
      environmentWorkspace: "Workspace",
      expandSidebar: "展开侧边栏",
      goHome: "回到主页",
      goToNextChat: "前往下一个对话",
      goToPreviousChat: "前往上一个对话",
      jumpToLatest: "跳到最新",
      addProject: "添加工作空间项目",
      markAsUnread: "标记为未读",
      newQuestion: "新问题",
      organizeByProject: "按项目整理",
      organizeByTime: "按时间整理",
      openingThread: "正在打开会话...",
      openSettings: "打开设置",
      openAiHistory: "打开 AI 页面",
      openMainChat: "在主窗口打开",
      openFolder: "打开当前文件夹",
      openMainWindow: "钉出窗口",
      openThreadInNewWindow: "在新窗口中打开",
      openTarget: "打开方式",
      openSideChat: "打开侧边聊天",
      openApp: "打开应用",
      permissionModeAskToEdit: "默认权限",
      permissionModeAuto: "完全访问权限",
      permissionModeExplore: "自动审查",
      permissionModeSection: "权限模式",
      pinChat: "置顶对话",
      pinProject: "置顶项目",
      createPermanentWorktree: "创建永久工作树",
      projectOptions: "项目选项",
      renameChat: "重命名对话",
      renameProject: "重命名项目",
      removeProject: "移除项目",
      revealInFinder: "在 Finder 中显示",
      restoringThread: "正在恢复会话...",
      sidebarAutomation: "自动化",
      sidebarArchiveAllChats: "归档所有聊天",
      sidebarChats: "对话",
      sidebarEmptyPinned: "暂无置顶对话",
      sidebarEmptyProjects: "暂无项目对话",
      sidebarEmptyRecent: "暂无最近对话",
      sidebarNewChat: "新对话",
      sidebarPinned: "置顶",
      sidebarProjects: "项目",
      sidebarSearch: "搜索",
      sidebarWork: "工作",
      clearWorkFilter: "清除工作筛选",
      sidebarSearchLoading: "正在加载聊天...",
      sidebarSearchNoResults: "没有匹配的对话",
      sortByCreated: "创建时间",
      sortByManual: "手动排序",
      sortByUpdated: "最近更新",
      underDevelopment: "待开发",
      unpinChat: "取消置顶",
      workFilterError: "部分工作分类暂时无法显示。",
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
      catalogError: "模型目录数据不完整，请检查提供商配置",
      configureApiKey: "配置 API Key",
      editApiKey: "编辑 API Key",
      loadError: "模型列表加载失败",
      loading: "正在加载模型...",
      model: "模型",
      modelDiscoveryPending: "模型列表尚未就绪，请在提供商设置中完成模型发现。",
      noModelsAvailable: "没有可用模型",
      openProviderSettings: "打开提供商设置",
      provider: "提供商",
      providerError: (providerName) => `${providerName} 模型列表读取失败`,
      retry: "重试",
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
      accept: "采纳",
      approvalTarget: "目标",
      approve: "批准",
      approveAndApply: "批准并修改",
      approveAndRun: "批准并执行",
      appliedChanges: "已变更",
      compactChangeSummary: (count) => `${count} 个文件`,
      commandCompleted: "命令已完成",
      commandCompletedNoOutput: "命令已完成，无输出",
      completed: "已完成",
      edit: "编辑",
      fileSaved: "文件已保存",
      filesAndFolders: (files, dirs) =>
        dirs > 0 ? `${files} 个文件，${dirs} 个文件夹` : `${files} 个文件`,
      foundMatches: (count) => `找到 ${count} 个匹配`,
      labels: {
        click_screen_point: "坐标点击",
        edit_file: "编辑文件",
        execute: "执行命令",
        find_ax_elements: "查找 AX 元素",
        get_message_context: "读取历史消息",
        get_trace_evidence: "读取执行证据",
        glob: "查找文件",
        grep: "搜索内容",
        ls: "列出目录",
        open_application: "打开应用",
        open_desktop_route: "打开桌面路由",
        present_artifacts: "呈现成果",
        press_ax_element: "按压 AX 元素",
        read_file: "读取文件",
        search_history: "搜索历史",
        task: "任务",
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
      decline: "放弃本次运行",
      sendCorrection: "发送修改意见",
      reject: "拒绝",
      rejectAndAdjust: "拒绝，请告知 Agent 如何调整",
      correctionPlaceholder: "告诉 Agent 需要怎么调整",
      taskCompleted: "任务已完成",
      todoProgress: (completed, total) => `${completed}/${total} 已完成`,
      upcomingChanges: "即将变更",
      writeLinesToFile: (count, fileName) => `向 ${fileName} 写入 ${count} 行`
    },
    runBotAgent: {
      addProject: "添加项目",
      cancel: "取消",
      cancelledError: "Agent 启动请求已取消。",
      concurrentError: "已有一个 Agent 启动请求正在等待确认。",
      confirm: "启动 Agent",
      defaultStatus: "项目默认状态",
      invalidLabelTypes: (labels) => `以下标签不是文本类型，无法由扩展设置：${labels}`,
      labels: "标签",
      missingLabels: (labels) => `项目中缺少以下标签：${labels}`,
      missingStatus: (status) => `项目中没有状态「${status}」。`,
      noLabels: "无",
      noProjects: "还没有可用项目",
      project: "项目",
      source: "来源",
      status: "状态",
      title: "确认启动 Agent"
    },
    threadWorkflow: {
      add: "添加",
      addLabelDefinition: "添加标签定义",
      addStatus: "添加状态",
      backToAssignments: "返回会话分类",
      closedCategory: "已关闭",
      defaultStatus: "默认状态",
      edit: "编辑会话工作流",
      labelDefinitions: "标签定义",
      labelName: "标签名称",
      labels: "标签",
      manageDefinitions: "管理分类定义",
      noLabels: "暂无标签",
      noParentLabel: "无父标签",
      openCategory: "进行中",
      parentLabel: "父标签",
      removeLabel: (label) => `移除标签 ${label}`,
      selectColor: (color) => `选择颜色 ${color}`,
      setDefaultStatus: (status) => `将 ${status} 设为默认状态`,
      status: "状态",
      statusDefinitions: "状态定义",
      statusName: "状态名称",
      unclassified: "未分类",
      valueType: "值类型",
      valuePlaceholder: (label) => `输入${label}`,
      valueTypes: {
        boolean: "开关",
        date: "日期",
        link: "链接",
        number: "数字",
        string: "文本"
      }
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
      deleteError: "Failed to remove the key. Check the local credential file permissions.",
      removeKey: "Remove Key",
      save: "Save",
      saveError: "Failed to save the key. Check the local credential file permissions.",
      secureStorageHint:
        "Keys are stored in Jingle auth.json and are not written to ~/.jingle/.env.",
      updateTitle: (providerName) => `Update ${providerName} API Key`,
      updateDescription: "Enter a new API key to replace the existing one, or remove it."
    },
    chat: {
      agentError: "Agent Error",
      agentErrorRecovery: "You can send a new message to continue the conversation.",
      agentLabel: "AGENT",
      copyMessage: "Copy message",
      agentThought: "Thought",
      agentStatusThinking: "Thinking",
      agentStatusSteered: "Steered conversation",
      agentStatusWaitingApproval: "Waiting for your confirmation",
      contextCompacted: "Context automatically compressed",
      cancelEditMessage: "Cancel",
      editUserMessage: "Edit user message",
      runCoachTip: {
        iterate_after_first_draft: "After the first draft, follow up to get closer",
        keep_followups_in_thread: "For the same goal, follow up here to keep context",
        start_with_outcome: "Name the outcome and format so I guess less"
      },
      toolActivityChangedFiles: "Changed files",
      toolActivityCompleted: "Handled tools",
      toolActivityCommands: (count) => `${count} command${count === 1 ? "" : "s"}`,
      toolActivityExplored: "Explored",
      toolActivityFileMutations: (count) => `${count} change${count === 1 ? "" : "s"}`,
      toolActivityFiles: (count) => `${count} file${count === 1 ? "" : "s"}`,
      toolActivityLists: (count) => `${count} list${count === 1 ? "" : "s"}`,
      toolActivityRanCommands: "Ran",
      toolActivityRunningCommand: "Running command",
      toolActivityRunningFileMutation: "Editing file",
      toolActivityRunningGeneric: "Using tools",
      toolActivityRunningList: "Listing directory",
      toolActivityRunningRead: "Reading file",
      toolActivityRunningSearch: "Searching",
      toolActivityRunningWebSearch: "Searching web",
      toolActivitySearches: (count) => `${count} search${count === 1 ? "" : "es"}`,
      toolActivitySearchedWeb: "Searched web",
      toolActivityWebSearches: (count) => `${count} time${count === 1 ? "" : "s"}`,
      turnProcessed: "Processed",
      turnProcessSteps: (count) => `${count} step${count === 1 ? "" : "s"}`,
      turnWorkedFor: (time) => `Worked for ${time}`,
      turnWorking: "Working",
      turnWorkingFor: (time) => `Working for ${time}`,
      addSelectionToChat: "Add to chat",
      executedSteps: (count) => `${count} steps completed`,
      describeOutcome: "Describe the outcome you want. The workspace and tools will follow.",
      dismissError: "Dismiss error",
      inputNeedsWorkspace: "Please select a workspace folder before sending messages.",
      messageContentUnavailable: "This message contains content that cannot be displayed.",
      memoryTemporaryOff: "Use memory",
      memoryTemporaryOn: "Temporary",
      pendingWorkspaceMemoryBlocksWorkspaceChange:
        "This conversation has pending workspace memories. Save or ignore them before changing workspace.",
      pendingMemoryAccept: "Save",
      pendingMemoryEvidenceTitle: (count) => `${count} source${count === 1 ? "" : "s"}`,
      pendingMemoryReject: "Ignore",
      pendingMemoryTitle: "Pending Memory",
      includedMemoriesTitle: (count) => `${count} memory reference${count === 1 ? "" : "s"}`,
      contextEvidenceTitle: (count) => `${count} context item${count === 1 ? "" : "s"}`,
      contextEvidenceProvided: "Provided",
      contextEvidenceRetrieved: "Retrieved",
      contextEvidenceCited: "Cited",
      messagePlaceholder: "Message the agent...",
      newThreadEyebrow: "New Thread",
      queuedFollowUpDelete: "Delete queued message",
      queuedFollowUpEdit: "Edit queued message",
      queuedFollowUpMore: (count) => `${count} more queued message${count === 1 ? "" : "s"}`,
      queuedFollowUpSteer: "Steer",
      queuedFollowUpUntitled: "Queued message",
      removeSelectionReference: "Remove reference",
      revealSelectionReference: "Jump to referenced message",
      selectWorkspace: "Select workspace",
      selectWorkspaceHint: "The agent needs a workspace to create and modify files",
      selectWorkspaceTitle: "Select a workspace folder first",
      sendEditedMessage: "Send",
      startConversation: "Start a conversation with the agent",
      retryMessage: "Retry response",
      selectedTextReferences: (count) =>
        `${count} selected text reference${count === 1 ? "" : "s"}`,
      userLabel: "YOU",
      userMessageNavigationJump: (position) => `Jump to user message ${position}`,
      userMessageNavigationLabel: "User messages",
      userMessageNavigationNoContent: "No text content",
      userMessageShowLess: "Show less",
      userMessageShowMore: "Show more"
    },
    common: {
      arguments: "Arguments",
      approval: "Approval",
      close: "Close",
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
    launcher: {
      actionsLabel: "Actions",
      addAutomation: "Add Automation...",
      addClipboardContext: "Add clipboard content",
      aiAddAttachment: "Add image",
      archiveChat: "Archive Chat",
      branchIntoLocal: "Fork into Local",
      branchIntoNewWorktree: "Fork into New Worktree",
      branchIntoSameWorktree: "Fork into Same Worktree",
      branchChat: "Branch Chat",
      branchMenu: "Branch",
      branchChatSwitched: "Switched to branched chat",
      changeModel: "Change Model...",
      aiEmptyEyebrow: "Jingle",
      aiEntryLabel: "Ask AI",
      aiExtensionIntentSubtitle: (handle) => `${handle} · AI Extension`,
      aiExtensionIntentTitle: (name) => `Ask ${name}`,
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
      collapseSidebar: "Collapse Sidebar",
      copyAsMarkdown: "Copy as Markdown",
      copyChat: "Copy",
      copyDeeplink: "Copy Deeplink",
      copySessionId: "Copy Session ID",
      copyWorkingDirectory: "Copy Working Directory",
      enter: "Enter",
      environmentDigest: "Conversation Summary",
      environmentDigestCollapse: "Collapse summary",
      environmentDigestEmpty: "No summary generated",
      environmentDigestError: "Summary unavailable",
      environmentDigestExpand: "Expand summary",
      environmentDigestGenerate: "Generate",
      environmentDigestGenerating: "Generating",
      environmentDigestRegenerate: "Regenerate",
      environmentDigestUpdated: "Updated",
      environmentInfo: "Environment Info",
      environmentModel: "Model",
      environmentNoModel: "No model",
      environmentNoThread: "No session",
      environmentNoWorkspace: "No workspace",
      environmentPermission: "Permission",
      environmentUnknownModel: (modelId) => `Model unavailable (${modelId})`,
      environmentProgress: "Progress",
      environmentProgressMore: (count) => `Show ${count} more`,
      environmentThread: "Session",
      environmentWorkspace: "Workspace",
      expandSidebar: "Expand Sidebar",
      goHome: "Go Home",
      goToNextChat: "Go to Next Chat",
      goToPreviousChat: "Go to Previous Chat",
      jumpToLatest: "Jump to latest",
      addProject: "Add Workspace Project",
      markAsUnread: "Mark as Unread",
      newQuestion: "New Question",
      organizeByProject: "Group by Project",
      organizeByTime: "Group by Time",
      openingThread: "Opening session...",
      openSettings: "Open Settings",
      openAiHistory: "Open AI",
      openMainChat: "Open in Main Window",
      openFolder: "Open Current Folder",
      openMainWindow: "Open in Separate Window",
      openThreadInNewWindow: "Open in New Window",
      openTarget: "Open With",
      openSideChat: "Open Side Chat",
      openApp: "Open App",
      permissionModeAskToEdit: "Default Permission",
      permissionModeAuto: "Full Access",
      permissionModeExplore: "Auto Review",
      permissionModeSection: "Permission Mode",
      pinChat: "Pin Chat",
      pinProject: "Pin Project",
      createPermanentWorktree: "Create Permanent Worktree",
      projectOptions: "Project Options",
      renameChat: "Rename Chat",
      renameProject: "Rename Project",
      removeProject: "Remove Project",
      revealInFinder: "Reveal in Finder",
      restoringThread: "Restoring session...",
      sidebarAutomation: "Automations",
      sidebarArchiveAllChats: "Archive All Chats",
      sidebarChats: "Chats",
      sidebarEmptyPinned: "No pinned chats",
      sidebarEmptyProjects: "No project chats",
      sidebarEmptyRecent: "No recent chats",
      sidebarNewChat: "New Chat",
      sidebarPinned: "Pinned",
      sidebarProjects: "Projects",
      sidebarSearch: "Search",
      sidebarWork: "Work",
      clearWorkFilter: "Clear work filter",
      sidebarSearchLoading: "Loading chats...",
      sidebarSearchNoResults: "No matching chats",
      sortByCreated: "Created Time",
      sortByManual: "Manual Order",
      sortByUpdated: "Recently Updated",
      underDevelopment: "Coming soon",
      unpinChat: "Unpin Chat",
      workFilterError: "Some work classifications are temporarily unavailable.",
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
      catalogError: "The model catalog is incomplete. Check the provider configuration.",
      configureApiKey: "Configure API Key",
      editApiKey: "Edit API Key",
      loadError: "Failed to load models",
      loading: "Loading models...",
      model: "Model",
      modelDiscoveryPending: "Models are not ready. Complete model discovery in provider settings.",
      noModelsAvailable: "No models available",
      openProviderSettings: "Open Provider Settings",
      provider: "Provider",
      providerError: (providerName) => `Failed to load ${providerName} models`,
      retry: "Retry",
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
      accept: "Accept",
      approvalTarget: "Target",
      approve: "Approve",
      approveAndApply: "Approve & Apply",
      approveAndRun: "Approve & Run",
      appliedChanges: "Changes applied",
      compactChangeSummary: (count) => `${count} file${count === 1 ? "" : "s"}`,
      commandCompleted: "Command completed",
      commandCompletedNoOutput: "Command completed (no output)",
      completed: "Completed",
      edit: "Edit",
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
        get_message_context: "Read Message Context",
        get_trace_evidence: "Read Trace Evidence",
        glob: "Find Files",
        grep: "Search Content",
        ls: "List Directory",
        open_application: "Open Application",
        open_desktop_route: "Open Desktop Route",
        present_artifacts: "Present Artifacts",
        press_ax_element: "Press AX Element",
        read_file: "Read File",
        search_history: "Search History",
        task: "Task",
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
      readLines: (count) => `Read ${count} line${count === 1 ? "" : "s"}`,
      decline: "Decline run",
      sendCorrection: "Send correction",
      reject: "Reject",
      rejectAndAdjust: "Reject and tell the agent what to adjust",
      correctionPlaceholder: "Tell the agent what to adjust",
      taskCompleted: "Task completed",
      todoProgress: (completed, total) => `${completed}/${total} done`,
      upcomingChanges: "Upcoming changes",
      writeLinesToFile: (count, fileName) => `Writing ${count} lines to ${fileName}`
    },
    runBotAgent: {
      addProject: "Add project",
      cancel: "Cancel",
      cancelledError: "The Agent launch request was cancelled.",
      concurrentError: "Another Agent launch request is already awaiting confirmation.",
      confirm: "Launch Agent",
      defaultStatus: "Project default",
      invalidLabelTypes: (labels) =>
        `These labels are not text labels and cannot be set by the extension: ${labels}`,
      labels: "Labels",
      missingLabels: (labels) => `The project does not define these labels: ${labels}`,
      missingStatus: (status) => `The project does not define status “${status}”.`,
      noLabels: "None",
      noProjects: "No projects available",
      project: "Project",
      source: "Source",
      status: "Status",
      title: "Confirm Agent launch"
    },
    threadWorkflow: {
      add: "Add",
      addLabelDefinition: "Add label definition",
      addStatus: "Add status",
      backToAssignments: "Back to thread classification",
      closedCategory: "Closed",
      defaultStatus: "Default status",
      edit: "Edit thread workflow",
      labelDefinitions: "Label definitions",
      labelName: "Label name",
      labels: "Labels",
      manageDefinitions: "Manage classification definitions",
      noLabels: "No labels",
      noParentLabel: "No parent label",
      openCategory: "Open",
      parentLabel: "Parent label",
      removeLabel: (label) => `Remove ${label}`,
      selectColor: (color) => `Select color ${color}`,
      setDefaultStatus: (status) => `Set ${status} as default`,
      status: "Status",
      statusDefinitions: "Status definitions",
      statusName: "Status name",
      unclassified: "Unclassified",
      valueType: "Value type",
      valuePlaceholder: (label) => `Enter ${label}`,
      valueTypes: {
        boolean: "Toggle",
        date: "Date",
        link: "Link",
        number: "Number",
        string: "Text"
      }
    }
  }
}
