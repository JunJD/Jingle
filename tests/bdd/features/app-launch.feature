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

  Scenario: Launcher 命令页可以返回首页
    Given Openwork 桌面应用已启动
    When 我在 Launcher 中搜索 "整理本周计划"
    Then Launcher 首页展示了可执行结果
    When 我执行当前选中的 Launcher 结果
    Then Launcher 界面切换到 "ai"
    When 我在 Launcher 中按下 Escape
    Then Launcher 界面切换到 "home"
    And Launcher 输入框包含 "整理本周计划"
