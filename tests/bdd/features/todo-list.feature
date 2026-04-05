@extensions
Feature: Todo List extension
  Scenario: 从 Launcher 打开 Todo List 并创建待办
    Given Openwork 桌面应用已启动
    When 我在 Launcher 中搜索 "todo"
    Then Launcher 首页展示了名为 "Todo List" 的结果
    When 我打开名为 "Todo List" 的 Launcher 结果
    Then Launcher 当前命令归属为 "todo-list"
    When 我在 Todo List 中创建一条新的测试待办
    Then Todo List 展示刚创建的待办
