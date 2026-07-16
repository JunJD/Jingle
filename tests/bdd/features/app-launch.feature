@smoke
Feature: Jingle 桌面启动
  Scenario: Main 窗口作为 durable desktop 启动
    Given Jingle 桌面应用已启动
    Then Main 窗口可用
    And 默认不会打开 Launcher 窗口

  Scenario: Launcher 通过 Enter 打开 AI 时不会自动提交输入
    Given Jingle 桌面应用已启动
    When 我在 Launcher 中搜索 "整理本周计划"
    Then Launcher 首页展示了可执行结果
    When 我执行当前选中的 Launcher 结果
    Then Launcher 界面切换到 "ai"
    And Launcher 输入框包含 "整理本周计划"
    And 在接下来 700 毫秒内不会提交 Launcher AI 消息 "整理本周计划"

  Scenario: Launcher 首页通过 Tab 进入 AI 时会触发快速提交
    Given Jingle 桌面应用已使用脚本化 agent runtime 启动
    When 我在 Launcher 中搜索 "bdd:success"
    Then Launcher 首页展示了可执行结果
    When 我在 Launcher 首页按下 Tab
    Then Launcher 界面切换到 "ai"
    And Launcher AI 输入状态会进入 pending

  Scenario: Launcher 首页通过 Tab 进入 AI 后首条助手回复只展示一次
    Given Jingle 桌面应用已使用脚本化 agent runtime 启动
    And 我把全局 workspace 设置为测试目录 "launcher-ai-first-send-workspace"
    When 我在 Launcher 中搜索 "bdd:success"
    Then Launcher 首页展示了可执行结果
    When 我在 Launcher 首页按下 Tab
    Then Launcher 界面切换到 "ai"
    And Launcher AI 输入状态会进入 pending
    And Launcher AI 最终只展示 1 条包含 "scripted agent completed" 的助手回复
    And Launcher AI 新线程的 agent thread data 最终包含 1 条用户消息、1 条包含 "scripted agent completed" 的助手消息，且线程状态为 "idle"

  Scenario: Launcher AI 首 token 前在 messages 中显示等待状态
    Given Jingle 桌面应用已使用脚本化 agent runtime 启动
    And 我把全局 workspace 设置为测试目录 "launcher-ai-first-token-waiting-workspace"
    When 我在 Launcher 中搜索 "bdd:delay-first-chunk"
    Then Launcher 首页展示了可执行结果
    When 我在 Launcher 首页按下 Tab
    Then Launcher 界面切换到 "ai"
    And Launcher AI 当前 turn 显示状态 "thinking"
    And Launcher AI 最终只展示 1 条包含 "scripted agent delayed first chunk completed" 的助手回复
    And Launcher AI 新线程的 agent thread data 最终包含 1 条用户消息、1 条包含 "scripted agent delayed first chunk completed" 的助手消息，且线程状态为 "idle"

  Scenario: Launcher AI 会在完成前渲染流式 token
    Given Jingle 桌面应用已使用脚本化 agent runtime 启动
    And 我把全局 workspace 设置为测试目录 "launcher-ai-token-streaming-workspace"
    When 我在 Launcher 中搜索 "bdd:stream"
    Then Launcher 首页展示了可执行结果
    When 我在 Launcher 首页按下 Tab
    Then Launcher 界面切换到 "ai"
    And Launcher AI 输入状态会进入 pending
    And Launcher AI 当前回复在完成前依次显示流式文本
      | scripted |
      | scripted agent |
      | scripted agent streamed |
    And Launcher AI 最终只展示 1 条包含 "scripted agent streamed chunked completion" 的助手回复
    And Launcher AI 新线程的 agent thread data 最终包含 1 条用户消息、1 条包含 "scripted agent streamed chunked completion" 的助手消息，且线程状态为 "idle"

  Scenario: Launcher 首页保留 Enter 与 Tab 分工
    Given Jingle 桌面应用已启动
    When 我在 Launcher 中搜索 "todo"
    Then Launcher 首页展示了可执行结果
    And Launcher 首页当前选中结果为 "待办列表"
    When 我执行当前选中的 Launcher 结果
    Then Launcher 当前命令归属为 "todo-list"
    When 我在 Launcher 中按下 Escape
    Then Launcher 界面切换到 "home"
    And Launcher 输入框包含 "todo"
    When 我在 Launcher 首页按下 Tab
    Then Launcher 界面切换到 "ai"

  Scenario: Launcher 首页可以通过方向键切换结果
    Given Jingle 桌面应用已启动
    When 我在 Launcher 中搜索 "todo"
    Then Launcher 首页当前选中结果为 "待办列表"
    When 我在 Launcher 首页按下 ArrowDown
    Then Launcher 首页当前选中结果不是 "待办列表"
    When 我在 Launcher 首页按下 ArrowUp
    Then Launcher 首页当前选中结果为 "待办列表"

  Scenario: Launcher 命令页可以返回首页
    Given Jingle 桌面应用已启动
    When 我在 Launcher 中搜索 "整理本周计划"
    Then Launcher 首页展示了可执行结果
    When 我执行当前选中的 Launcher 结果
    Then Launcher 界面切换到 "ai"
    When 我在 Launcher 中按下 Escape
    Then Launcher 界面切换到 "home"
    And Launcher 输入框包含 "整理本周计划"

  Scenario: Launcher AI 空输入可以通过 Backspace 返回首页
    Given Jingle 桌面应用已启动
    When 我在 Launcher 首页按下 Tab
    Then Launcher 界面切换到 "ai"
    When 我在 Launcher AI 输入框按下 Backspace
    Then Launcher 界面切换到 "home"

  Scenario: Launcher 首页可以被关闭
    Given Jingle 桌面应用已启动
    Then Launcher 窗口当前可见
    When 我在 Launcher 首页按下 Escape
    Then Launcher 窗口已隐藏

  Scenario: Launcher 可以打开设置窗口
    Given Jingle 桌面应用已启动
    When 我从 Launcher 打开设置窗口
    Then Settings 窗口可用
    And Launcher 窗口已隐藏

  Scenario: Main 窗口可以直接打开指定历史线程
    Given Jingle 桌面应用已启动
    And 存在标题为 "BDD Main Session Thread" 的 Launcher AI 历史线程
    When 我通过 API 打开最后创建线程的 Main 窗口
    Then Main 窗口可用
    And Main 窗口当前选中了标题为 "BDD Main Session Thread" 的线程

  Scenario: Launcher 线程搜索可以打开 Main 窗口 并展示历史消息
    Given Jingle 桌面应用已启动
    And 存在标题为 "BDD Main Search Thread" 且包含历史消息 "BDD Main Search Message" 的 Launcher AI 历史线程
    When 我在 Launcher 中搜索 "BDD Main Search Thread"
    Then Launcher 首页展示了名为 "BDD Main Search Thread" 的结果
    When 我打开名为 "BDD Main Search Thread" 的 Launcher 结果
    Then Main 窗口可用
    And Main 窗口当前选中了标题为 "BDD Main Search Thread" 的线程
    And Main 窗口消息区包含 "BDD Main Search Message"
    And Launcher 窗口已隐藏

  Scenario: Launcher 线程搜索可以通过英文历史消息片段找到线程
    Given Jingle 桌面应用已启动
    And 存在标题为 "BDD English Message Thread" 且包含历史消息 "Jingle remembers cross session agent chats" 的历史线程
    When 我在 Launcher 中搜索 "cross session agent"
    Then Launcher 首页展示了名为 "BDD English Message Thread" 的结果

  Scenario: Launcher 线程搜索应该通过中文历史消息片段找到线程
    Given Jingle 桌面应用已启动
    And 存在标题为 "BDD CJK Message Thread" 且包含历史消息 "昨天我们搞了一天的A2A通信，也整理了和其他Agent的聊天记录。" 的历史线程
    And 数据库消息索引用 LIKE 能找到历史消息片段 "和其他Agent的聊天记录"
    When 我在 Launcher 中搜索 "和其他Agent的聊天记录"
    Then Launcher 首页展示了名为 "BDD CJK Message Thread" 的结果

  Scenario: 从 Launcher 搜索进入 Main 窗口 后仍然可以手动切换线程
    Given Jingle 桌面应用已启动
    And 存在标题为 "BDD Primary Thread" 且包含历史消息 "BDD Primary Message" 的 Launcher AI 历史线程
    And 存在标题为 "BDD Secondary Thread" 的 Launcher AI 历史线程
    When 我在 Launcher 中搜索 "BDD Primary Thread"
    Then Launcher 首页展示了名为 "BDD Primary Thread" 的结果
    When 我打开名为 "BDD Primary Thread" 的 Launcher 结果
    Then Main 窗口可用
    And Main 窗口当前选中了标题为 "BDD Primary Thread" 的线程
    When 我在 Main 窗口选择标题为 "BDD Secondary Thread" 的线程
    Then Main 窗口持续选中了标题为 "BDD Secondary Thread" 的线程

  Scenario: Settings 可以展示可配置快捷键
    Given Jingle 桌面应用已启动
    When 我在 Launcher 中搜索 "todo"
    Then Launcher 首页展示了可执行结果
    When 我从 Launcher 打开设置窗口
    Then Settings 窗口可用
    When 我切换到 Settings 快捷键页
    Then Settings 展示 launcher.toggle 快捷键
    And Settings 将 launcher.toggle 标记为可配置
    And Settings 展示 launcher.search.open-settings 快捷键
    And Settings 将 launcher.search.open-settings 标记为可配置

  Scenario: Settings 修改 Launcher 唤起快捷键会同步菜单提示
    Given Jingle 桌面应用已启动
    When 我在 Launcher 中搜索 "todo"
    Then Launcher 首页展示了可执行结果
    When 我从 Launcher 打开设置窗口
    Then Settings 窗口可用
    When 我切换到 Settings 快捷键页
    And 我开始编辑 launcher.toggle 快捷键
    And 我录制新的 launcher.toggle 快捷键
    And 我保存 launcher.toggle 快捷键
    Then Settings 将 launcher.toggle 显示为自定义快捷键
    And Settings 为 launcher.toggle 显示可用的全局注册状态
    And 应用菜单使用与 launcher.toggle 相同的快捷键 accelerator

  Scenario: 自然语言翻译请求会把原文带入翻译页
    Given Jingle 桌面应用已启动
    When 我在 Launcher 中搜索 "translate hello to chinese"
    Then Launcher 首页展示了可执行结果
    When 我执行当前选中的 Launcher 结果
    Then Launcher 翻译输入框包含 "hello"
