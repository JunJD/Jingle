@extensions
Feature: Todo List extension
  Scenario: 从 Launcher 打开 Todo List 并创建待办
    Given Jingle 桌面应用已启动
    When 我在 Launcher 中搜索 "todo"
    Then Launcher 首页展示了名为 "Todo List" 的结果
    When 我打开名为 "Todo List" 的 Launcher 结果
    Then Launcher 当前命令归属为 "todo-list"
    When 我在 Todo List 中创建一条新的测试待办
    Then Todo List 展示刚创建的待办

  Scenario: Todo List 可以通过 Enter 创建待办
    Given Jingle 桌面应用已启动
    When 我在 Launcher 中搜索 "todo"
    Then Launcher 首页展示了名为 "Todo List" 的结果
    When 我打开名为 "Todo List" 的 Launcher 结果
    Then Launcher 当前命令归属为 "todo-list"
    When 我在 Todo List 输入框中输入新的测试待办标题
    And 我在 Todo List 输入框按下 Enter
    Then Todo List 展示刚创建的待办

  Scenario: Todo List 可以通过动作面板进入搜索模式
    Given Jingle 桌面应用已启动
    When 我在 Launcher 中搜索 "todo"
    Then Launcher 首页展示了名为 "Todo List" 的结果
    When 我打开名为 "Todo List" 的 Launcher 结果
    Then Launcher 当前命令归属为 "todo-list"
    When 我在当前 Launcher surface 打开动作面板
    Then Launcher 原生动作面板可见
    When 我在原生动作面板中向下移动一次
    And 我执行当前选中的原生动作
    Then Todo List 已进入搜索模式

  Scenario: Todo List 动作面板可以通过 Escape 关闭
    Given Jingle 桌面应用已启动
    When 我在 Launcher 中搜索 "todo"
    Then Launcher 首页展示了名为 "Todo List" 的结果
    When 我打开名为 "Todo List" 的 Launcher 结果
    Then Launcher 当前命令归属为 "todo-list"
    When 我在当前 Launcher surface 打开动作面板
    Then Launcher 原生动作面板可见
    When 我关闭原生动作面板
    Then Launcher 原生动作面板已隐藏
