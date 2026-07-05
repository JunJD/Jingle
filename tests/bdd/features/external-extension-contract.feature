# language: zh-CN
@external-extension-contract
功能: External Extension Contract v1 验收
  为了让 bundled extensions 按可外提第三方 extension 的边界运行
  作为 Jingle runtime 维护者
  我需要真实 Electron UI 只通过 manifest、runtime snapshot 和 host capability 完成关键动作

  场景: Translate 走 runtime 表单、AI.ask 和 clipboard capability
    假如 BDD extension runtime AI 返回 "BDD translated text"
    当 Jingle 桌面应用已启动
    当 我在 Launcher 中搜索 "translate"
    那么 Launcher 首页展示了名为 "Translate" 的结果
    当 我打开名为 "Translate" 的 Launcher 结果
    那么 Launcher 当前命令归属为 "translate"
    而且 runtime form 当前标题为 "翻译"
    当 我在 runtime 表单文本框 "原文" 输入 "hello runtime"
    并且 我执行当前 runtime primary action
    那么 runtime 表单消息 "translation-result" 包含 "BDD translated text"
    而且 BDD runtime AI 最近一次 prompt 应为 "hello runtime"
    当 我在当前 Launcher surface 打开动作面板
    并且 我在原生动作面板中向下移动一次
    并且 我执行当前选中的原生动作
    那么 系统剪贴板文本应为 "BDD translated text"

  场景: Todo 走 runtime list 并完成创建动作
    假如 Jingle 桌面应用已启动
    当 我在 Launcher 中搜索 "todo"
    那么 Launcher 首页展示了名为 "Todo List" 的结果
    当 我打开名为 "Todo List" 的 Launcher 结果
    那么 Launcher 当前命令归属为 "todo-list"
    而且 runtime list 当前标题为 "Todo List"
    当 我在 Todo List 中创建一条新的测试待办
    那么 Todo List 展示刚创建的待办

  场景: Apple Reminders menu bar 由 runtime menu-bar command 驱动
    假如 BDD extension runtime RPC 使用测试数据
    当 Jingle 桌面应用已启动
    那么 native menu bar 测试快照包含命令 "apple-reminders:menu-bar-reminders"
    而且 native menu bar 命令 "apple-reminders:menu-bar-reminders" 的第 1 个项目标题应为 "BDD Reminder"

  场景: GitHub runtime command 可打开并执行设置动作
    假如 Jingle 桌面应用已启动
    当 我在 Launcher 中搜索 "my issues"
    那么 Launcher 首页展示了名为 "My Issues" 的结果
    当 我打开名为 "My Issues" 的 Launcher 结果
    那么 Launcher 当前命令归属为 "github"
    而且 runtime list 空状态标题为 "Connect GitHub"
    当 我点击 runtime list 空状态动作 "Connect GitHub"
    那么 BDD runtime host 最近请求 capability 应为 "settings"
    那么 Settings 窗口可用
    而且 Settings 当前选中 extension 应为 "github"

  场景: Notion 正式 runtime command 未连接时可进入正式设置页
    假如 Jingle 桌面应用已启动
    当 我在 Launcher 中搜索 "notion"
    那么 Launcher 首页展示了名为 "Search Pages" 的结果
    当 我打开名为 "Search Pages" 的 Launcher 结果
    那么 Launcher 当前命令归属为 "notion"
    而且 runtime list 空状态标题为 "Connection Required"
    当 我点击 runtime list 空状态动作 "Open Extension Settings"
    那么 BDD runtime host 最近请求 capability 应为 "settings"
    那么 Settings 窗口可用
    而且 Settings 当前选中 extension 应为 "notion"

  场景: Notion 正式 runtime command 连接后可通过真实 runtime 链路搜索页面
    假如 BDD Notion API 使用连接后的测试数据
    当 Jingle 桌面应用已启动
    假如 Notion extension 已连接到 BDD Notion API
    当 我在 Launcher 中搜索 "notion"
    那么 Launcher 首页展示了名为 "Search Pages" 的结果
    当 我打开名为 "Search Pages" 的 Launcher 结果
    那么 Launcher 当前命令归属为 "notion"
    而且 runtime list 展示条目 "BDD Connected Notion Page"
    而且 BDD Notion API 收到 search 请求

  场景: Notion 正式 runtime command 连接后可通过真实 runtime 链路追加页面内容
    假如 BDD Notion API 使用连接后的测试数据
    当 Jingle 桌面应用已启动
    假如 Notion extension 已连接到 BDD Notion API
    当 我在 Launcher 中搜索 "notion add text"
    那么 Launcher 首页展示了名为 "Add Text to Page" 的结果
    当 我打开名为 "Add Text to Page" 的 Launcher 结果
    那么 Launcher 当前命令归属为 "notion"
    而且 runtime form 当前标题为 "Add Text to Page"
    当 我在 runtime 表单下拉框 "Notion Page" 选择 "bdd-notion-page-1"
    并且 我在 runtime 表单文本框 "Content" 输入 "BDD appended Notion content"
    并且 我执行当前 runtime primary action
    那么 BDD Notion API 收到向页面 "bdd-notion-page-1" 追加文本 "BDD appended Notion content" 的请求

  场景: Notion 正式 runtime command 连接后可通过真实 runtime 链路创建页面
    假如 BDD Notion API 使用连接后的测试数据
    当 Jingle 桌面应用已启动
    假如 Notion extension 已连接到 BDD Notion API
    当 我在 Launcher 中搜索 "notion create page"
    那么 Launcher 首页展示了名为 "Create Page" 的结果
    当 我打开名为 "Create Page" 的 Launcher 结果
    那么 Launcher 当前命令归属为 "notion"
    而且 runtime form 当前标题为 "Create Database Page"
    当 我在 runtime 表单下拉框 "Database" 选择 "bdd-notion-data-source-1"
    并且 我在 runtime 表单文本框 "Name" 输入 "BDD Created Notion Page"
    并且 我在 runtime 表单文本框 "Page Content" 输入 "BDD created Notion body"
    并且 我执行当前 runtime primary action
    那么 BDD Notion API 收到创建页面 "BDD Created Notion Page" 且正文包含 "BDD created Notion body" 的请求

  场景: Notion 正式 runtime command 连接后可通过真实 runtime 链路快速剪藏 URL
    假如 BDD Notion API 使用连接后的测试数据
    当 Jingle 桌面应用已启动
    假如 Notion extension 已连接到 BDD Notion API
    当 我在 Launcher 中搜索 BDD Notion 快速剪藏 URL
    那么 Launcher 首页展示了名为 "Quick Capture" 的结果
    当 我打开名为 "Quick Capture" 的 Launcher 结果
    那么 Launcher 当前命令归属为 "notion"
    而且 runtime 表单文本框 "URL" 当前值应为 BDD Notion 快速剪藏 URL
    当 我在 runtime 表单下拉框 "Capture As" 选择 "full"
    并且 我在 runtime 表单下拉框 "Notion Page" 选择 "bdd-notion-page-1"
    并且 我执行当前 runtime primary action
    那么 BDD Notion API 收到快速剪藏页面读取请求
    而且 BDD Notion API 收到向页面 "bdd-notion-page-1" 追加文本 "BDD quick capture article body for Electron runtime." 的请求
