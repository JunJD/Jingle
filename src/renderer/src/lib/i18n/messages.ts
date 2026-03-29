import type { AppLocale } from "../../../../shared/i18n"

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
    envVar: string
    removeKey: string
    save: string
    updateTitle: (providerName: string) => string
    updateDescription: string
  }
  chat: {
    agentError: string
    agentErrorRecovery: string
    agentLabel: string
    copyMessage: string
    agentTasks: string
    agentThinking: string
    describeOutcome: string
    dismissError: string
    inputNeedsWorkspace: string
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
    aiAddAttachment: string
    askAiWithTab: string
    aiEmptyEyebrow: string
    aiEntryLabel: string
    aiIntentSubtitle: (query: string) => string
    aiFooterLeading: string
    aiHeroDescription: string
    aiHeroTitle: string
    aiInputPlaceholder: string
    aiPrimaryLabel: string
    aiThreadTitle: string
    clearClipboardContext: string
    clipboardFiles: (count: number) => string
    clipboardImage: string
    enter: string
    jumpToLatest: string
    openApp: string
    openGeneric: string
    openResult: string
    pinHistoryItem: string
    planned: string
    removeAttachment: string
    removeHistoryItem: string
    resultKindAgent: string
    resultKindApp: string
    resultKindDirectory: string
    resultKindFile: string
    resultKindThread: string
    searchPlaceholder: string
    searchResults: string
    unpinHistoryItem: string
  }
  modelSwitcher: {
    apiKeyRequired: (providerName: string) => string
    configureApiKey: string
    editApiKey: string
    model: string
    noModelsAvailable: string
    provider: string
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
    approveAndRun: string
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
    reject: string
    taskCompleted: string
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
      envVar: "环境变量",
      removeKey: "移除 Key",
      save: "保存",
      updateTitle: (providerName) => `更新 ${providerName} API Key`,
      updateDescription: "输入新的 API Key 覆盖已有值，或直接移除。"
    },
    chat: {
      agentError: "Agent 错误",
      agentErrorRecovery: "你可以继续发送新消息，恢复这段对话。",
      agentLabel: "AGENT",
      copyMessage: "复制消息",
      agentTasks: "Agent 任务",
      agentThinking: "Agent 正在思考...",
      describeOutcome: "描述你想达成的结果。workspace 和 tools 会随后接上。",
      dismissError: "关闭错误",
      inputNeedsWorkspace: "请先选择一个 workspace 文件夹，再发送消息。",
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
      aiAddAttachment: "添加附件",
      askAiWithTab: "按 Tab 问 AI",
      aiEmptyEyebrow: "桌面 Agent",
      aiEntryLabel: "问 AI",
      aiIntentSubtitle: (query) => `带着“${query}”进入 AI`,
      aiFooterLeading: "快速 AI",
      aiHeroDescription: "从意图开始。Agent 会自行判断需要哪些工具、文件和下一步动作。",
      aiHeroTitle: "想做什么，直接说",
      aiInputPlaceholder: "描述你要完成的事情...",
      aiPrimaryLabel: "发给 AI",
      aiThreadTitle: "快速提问",
      clearClipboardContext: "清除剪贴板上下文",
      clipboardFiles: (count) => `${count} 个文件`,
      clipboardImage: "剪贴板图片",
      enter: "回车",
      jumpToLatest: "跳到最新",
      openApp: "打开应用",
      openGeneric: "打开",
      openResult: "打开结果",
      pinHistoryItem: "固定到搜索面板",
      planned: "规划中",
      removeAttachment: "移除附件",
      removeHistoryItem: "从使用记录中删除",
      resultKindAgent: "Agent",
      resultKindApp: "应用",
      resultKindDirectory: "文件夹",
      resultKindFile: "文件",
      resultKindThread: "对话",
      searchPlaceholder: "你想处理什么工作？",
      searchResults: "搜索结果",
      unpinHistoryItem: "取消固定"
    },
    modelSwitcher: {
      apiKeyRequired: (providerName) => `${providerName} 需要 API Key`,
      configureApiKey: "配置 API Key",
      editApiKey: "编辑 API Key",
      model: "模型",
      noModelsAvailable: "没有可用模型",
      provider: "提供商",
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
      approveAndRun: "批准并执行",
      commandCompleted: "命令已完成",
      commandCompletedNoOutput: "命令已完成，无输出",
      completed: "已完成",
      edit: "编辑",
      fileSaved: "文件已保存",
      filesAndFolders: (files, dirs) =>
        dirs > 0 ? `${files} 个文件，${dirs} 个文件夹` : `${files} 个文件`,
      foundMatches: (count) => `找到 ${count} 个匹配`,
      labels: {
        edit_file: "编辑文件",
        execute: "执行命令",
        glob: "查找文件",
        grep: "搜索内容",
        ls: "列出目录",
        read_file: "读取文件",
        task: "子代理任务",
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
      taskCompleted: "任务已完成",
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
      envVar: "Environment variable",
      removeKey: "Remove Key",
      save: "Save",
      updateTitle: (providerName) => `Update ${providerName} API Key`,
      updateDescription: "Enter a new API key to replace the existing one, or remove it."
    },
    chat: {
      agentError: "Agent Error",
      agentErrorRecovery: "You can send a new message to continue the conversation.",
      agentLabel: "AGENT",
      copyMessage: "Copy message",
      agentTasks: "Agent Tasks",
      agentThinking: "Agent is thinking...",
      describeOutcome: "Describe the outcome you want. The workspace and tools will follow.",
      dismissError: "Dismiss error",
      inputNeedsWorkspace: "Please select a workspace folder before sending messages.",
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
      aiAddAttachment: "Add attachment",
      askAiWithTab: "Tab to ask AI",
      aiEmptyEyebrow: "Launcher AI",
      aiEntryLabel: "Ask AI",
      aiIntentSubtitle: (query) => `Open AI with “${query}”`,
      aiFooterLeading: "Quick AI",
      aiHeroDescription:
        "Start from intent. The agent will figure out tools, files, and next actions from there.",
      aiHeroTitle: "Ask anything",
      aiInputPlaceholder: "Ask AI anything...",
      aiPrimaryLabel: "Ask AI",
      aiThreadTitle: "Ask Anything",
      clearClipboardContext: "Clear clipboard context",
      clipboardFiles: (count) => `${count} file${count === 1 ? "" : "s"}`,
      clipboardImage: "Clipboard image",
      enter: "Enter",
      jumpToLatest: "Jump to latest",
      openApp: "Open App",
      openGeneric: "Open",
      openResult: "Open Result",
      pinHistoryItem: "Pin to launcher",
      planned: "Planned",
      removeAttachment: "Remove attachment",
      removeHistoryItem: "Remove from history",
      resultKindAgent: "Agent",
      resultKindApp: "App",
      resultKindDirectory: "Folder",
      resultKindFile: "File",
      resultKindThread: "Thread",
      searchPlaceholder: "What do you want to get done?",
      searchResults: "Search Results",
      unpinHistoryItem: "Unpin"
    },
    modelSwitcher: {
      apiKeyRequired: (providerName) => `API key required for ${providerName}`,
      configureApiKey: "Configure API Key",
      editApiKey: "Edit API Key",
      model: "Model",
      noModelsAvailable: "No models available",
      provider: "Provider",
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
      approveAndRun: "Approve & Run",
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
        edit_file: "Edit File",
        execute: "Execute Command",
        glob: "Find Files",
        grep: "Search Content",
        ls: "List Directory",
        read_file: "Read File",
        task: "Subagent Task",
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
      taskCompleted: "Task completed",
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
