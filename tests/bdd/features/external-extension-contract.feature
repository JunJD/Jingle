# language: zh-CN
@external-extension-contract
功能: External Extension Contract v1 验收
  为了让 bundled extensions 按可外提第三方 extension 的边界运行
  作为 Openwork runtime 维护者
  我需要真实 Electron UI 只通过 manifest、runtime snapshot 和 host capability 完成关键动作

  场景: Translate 走 runtime 表单、AI.ask 和 clipboard capability
    假如 BDD extension runtime AI 返回 "BDD translated text"
    当 Openwork 桌面应用已启动
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
    假如 Openwork 桌面应用已启动
    当 我在 Launcher 中搜索 "todo"
    那么 Launcher 首页展示了名为 "Todo List" 的结果
    当 我打开名为 "Todo List" 的 Launcher 结果
    那么 Launcher 当前命令归属为 "todo-list"
    而且 runtime list 当前标题为 "Todo List"
    当 我在 Todo List 中创建一条新的测试待办
    那么 Todo List 展示刚创建的待办

  场景: Apple Reminders menu bar 由 runtime menu-bar command 驱动
    假如 BDD extension runtime RPC 使用测试数据
    当 Openwork 桌面应用已启动
    那么 native menu bar 测试快照包含命令 "apple-reminders:menu-bar-reminders"
    而且 native menu bar 命令 "apple-reminders:menu-bar-reminders" 的第 1 个项目标题应为 "BDD Reminder"

  场景: GitHub runtime command 可打开并执行设置动作
    假如 Openwork 桌面应用已启动
    当 我在 Launcher 中搜索 "my issues"
    那么 Launcher 首页展示了名为 "My Issues" 的结果
    当 我打开名为 "My Issues" 的 Launcher 结果
    那么 Launcher 当前命令归属为 "github"
    而且 runtime list 空状态标题为 "Connect GitHub"
    当 我点击 runtime list 空状态动作 "Add GitHub Token"
    那么 BDD runtime host 最近请求 capability 应为 "settings"
    那么 Settings 窗口可用
    而且 Settings 当前选中 extension 应为 "github"
