@smoke
Feature: Openwork 桌面启动
  Scenario: Launcher 窗口作为主入口启动
    Given Openwork 桌面应用已启动
    Then Launcher 窗口可用
    And 渲染进程标识为 Launcher 窗口
    And Launcher React 根节点已完成渲染
    And 默认不会打开 Main 窗口

  Scenario: Launcher 搜索可以打开 AI 界面
    Given Openwork 桌面应用已启动
    When 我在 Launcher 中搜索 "整理本周计划"
    Then Launcher 首页展示了可执行结果
    When 我执行当前选中的 Launcher 结果
    Then Launcher 界面切换到 "ai"
    And Launcher 输入框包含 "整理本周计划"

  Scenario: Launcher 首页可以通过 Tab 进入 AI 界面
    Given Openwork 桌面应用已启动
    When 我在 Launcher 中搜索 "整理本周计划"
    Then Launcher 首页展示了可执行结果
    When 我在 Launcher 首页按下 Tab
    Then Launcher 界面切换到 "ai"
    And Launcher 输入框包含 "整理本周计划"

  Scenario: Launcher 首页可以通过方向键切换结果
    Given Openwork 桌面应用已启动
    When 我在 Launcher 中搜索 "t"
    Then Launcher 首页当前选中结果为 "Todo List"
    When 我在 Launcher 首页按下 ArrowDown
    Then Launcher 首页当前选中结果为 "Translate"
    When 我在 Launcher 首页按下 ArrowUp
    Then Launcher 首页当前选中结果为 "Todo List"

  Scenario: Launcher 命令页可以返回首页
    Given Openwork 桌面应用已启动
    When 我在 Launcher 中搜索 "整理本周计划"
    Then Launcher 首页展示了可执行结果
    When 我执行当前选中的 Launcher 结果
    Then Launcher 界面切换到 "ai"
    When 我在 Launcher 中按下 Escape
    Then Launcher 界面切换到 "home"
    And Launcher 输入框包含 "整理本周计划"

  Scenario: Launcher AI 空输入可以通过 Backspace 返回首页
    Given Openwork 桌面应用已启动
    When 我在 Launcher 首页按下 Tab
    Then Launcher 界面切换到 "ai"
    When 我在 Launcher AI 输入框按下 Backspace
    Then Launcher 界面切换到 "home"

  Scenario: Launcher 首页可以被关闭
    Given Openwork 桌面应用已启动
    Then Launcher 窗口当前可见
    When 我在 Launcher 首页按下 Escape
    Then Launcher 窗口已隐藏

  Scenario: Launcher 可以打开设置窗口
    Given Openwork 桌面应用已启动
    When 我在 Launcher 中搜索 "todo"
    Then Launcher 首页展示了可执行结果
    When 我从 Launcher 打开设置窗口
    Then Settings 窗口可用
    And Launcher 窗口已隐藏

  Scenario: Launcher 线程搜索可以打开 Main 窗口并定位线程
    Given Openwork 桌面应用已启动
    And 存在标题为 "BDD Main Window Thread" 的历史线程
    When 我在 Launcher 中搜索 "BDD Main Window Thread"
    Then Launcher 首页展示了名为 "BDD Main Window Thread" 的结果
    When 我打开名为 "BDD Main Window Thread" 的 Launcher 结果
    Then Main 窗口可用
    And Main 窗口当前选中了标题为 "BDD Main Window Thread" 的线程
    And Launcher 窗口已隐藏

  Scenario: Settings 可以展示可配置快捷键
    Given Openwork 桌面应用已启动
    When 我在 Launcher 中搜索 "todo"
    Then Launcher 首页展示了可执行结果
    When 我从 Launcher 打开设置窗口
    Then Settings 窗口可用
    When 我切换到 Settings 快捷键页
    Then Settings 展示 launcher.toggle 快捷键
    And Settings 将 launcher.toggle 标记为可配置

  Scenario: Settings 修改 Launcher 唤起快捷键会同步菜单提示
    Given Openwork 桌面应用已启动
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
    Given Openwork 桌面应用已启动
    When 我在 Launcher 中搜索 "translate hello to chinese"
    Then Launcher 首页展示了可执行结果
    When 我执行当前选中的 Launcher 结果
    Then Launcher 翻译输入框包含 "hello"
