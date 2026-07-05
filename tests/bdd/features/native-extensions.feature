# language: zh-CN
@native-extensions
功能: Native Extensions 主进程契约
  为了让 native extension schema、偏好和事件行为稳定
  作为 Jingle main process 维护者
  我需要 nativeExtensions API 能列出设置 schema、保存偏好并向所有窗口广播变化

  场景: listSettingsSchemas 返回 first-party extension schema
    假如 Jingle 桌面应用已启动
    当 我读取 native extensions 设置 schema
    那么 native extensions schema 包含 extension "todo-list" 标题为 "Todo List"
    而且 native extensions schema 中 extension "todo-list" 包含 command "index" 标题为 "Todo List"
    而且 native extensions schema 中 command "todo-list:index" 包含 preference "showCompleted"

  场景: Notion 设置保存连接 token
    假如 Jingle 桌面应用已启动
    当 我读取 native extensions 设置 schema
    那么 native extensions schema 包含 extension "notion" 标题为 "Notion"
    而且 native extensions schema 中 extension "notion" 包含 command "search-page" 标题为 "Search Pages"
    而且 native extensions schema 中 extension "notion" 包含 preference "accessToken"
    当 我把 native extension "notion" preferences 设置为:
      | key        | value                     |
      | accessToken | secret_bdd_notion_token   |
      | apiBaseUrl | https://api.notion.com/v1 |
    并且 我读取 native extension "notion" preferences
    那么 native extension preferences 中 "accessToken" 应为 ""
    而且 native extension preferences 中 "apiBaseUrl" 应为 "https://api.notion.com/v1"
    当 我重新启动 Jingle 桌面应用
    并且 我读取 native extension "notion" preferences
    那么 native extension preferences 中 "accessToken" 应为 ""
    而且 native extension preferences 中 "apiBaseUrl" 应为 "https://api.notion.com/v1"

  场景: extension preferences 可以保存后再次读取
    假如 Jingle 桌面应用已启动
    当 我把 native extension "github" preferences 设置为:
      | key                | value                       |
      | apiBaseUrl         | https://github.example.test |
      | defaultSearchTerms | author:@me state:open      |
      | numberOfResults    | 13                          |
    并且 我读取 native extension "github" preferences
    那么 native extension preferences 中 "apiBaseUrl" 应为 "https://github.example.test"
    而且 native extension preferences 中 "defaultSearchTerms" 应为 "author:@me state:open"
    而且 native extension preferences 中 "numberOfResults" 应为 "13"

  场景: command preferences 可以保存后再次读取
    假如 Jingle 桌面应用已启动
    当 我把 native extension "todo-list" command "index" preferences 设置为:
      | key           | value                  |
      | sortOrder     | title_ascending        |
      | showCompleted | false                  |
    并且 我读取 native extension "todo-list" command "index" preferences
    那么 native command preferences 中 "sortOrder" 应为 "title_ascending"
    而且 native command preferences 中 "showCompleted" 应为布尔值 false

  场景: preferencesChanged 事件会广播到 Launcher 和 Settings 窗口
    假如 Jingle 桌面应用已启动
    而且 我通过 API 打开 Settings 窗口
    而且 Settings 窗口可用
    当 我开始在 Launcher 和 Settings 监听 native extension preference 事件
    并且 我把 native extension "todo-list" command "index" preferences 设置为:
      | key           | value                    |
      | sortOrder     | creation_date_ascending  |
      | showCompleted | true                     |
    那么 Launcher 最近一次 native extension preference 事件应为 command "todo-list:index"
    而且 Settings 最近一次 native extension preference 事件应为 command "todo-list:index"

  场景: invoke 会通过主进程 native extension service 返回错误
    假如 Jingle 桌面应用已启动
    当 我调用 native extension "todo-list" RPC method "noop"
    那么 native extension invoke 错误应包含 "does not expose RPC methods"
