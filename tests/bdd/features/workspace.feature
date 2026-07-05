# language: zh-CN
@workspace
功能: Workspace 主进程契约
  为了让 workspace 路径和文件访问行为稳定
  作为 Jingle main process 维护者
  我需要 workspace API 能稳定读写全局路径、线程路径和工作区文件

  场景: 设置全局 workspace 后可以再次读取到同一路径
    假如 Jingle 桌面应用已启动
    当 我把全局 workspace 设置为测试目录 "workspace-global-root"
    那么 workspace:get 全局路径应为当前全局 workspace

  场景: 全局 workspace 重新启动后仍然保留
    假如 Jingle 桌面应用已启动
    当 我把全局 workspace 设置为测试目录 "workspace-global-restart-root"
    并且 我重新启动 Jingle 桌面应用
    那么 workspace:get 全局路径应为当前全局 workspace

  场景: 线程 workspace 可以覆盖全局 workspace
    假如 Jingle 桌面应用已启动
    而且 我把全局 workspace 设置为测试目录 "workspace-before-thread-override"
    而且 我通过 threads API 创建标题为 "BDD Workspace Thread" 且来源为 "bdd-workspace"
    当 我把最新创建线程的 workspace 设置为测试目录 "workspace-thread-root"
    那么 workspace:get 最新创建线程路径应为当前线程 workspace
    而且 workspace:get 全局路径应为当前线程 workspace

  场景: 线程 workspace 重新启动后仍然覆盖全局 workspace
    假如 Jingle 桌面应用已启动
    而且 我把全局 workspace 设置为测试目录 "workspace-before-thread-restart"
    而且 我通过 threads API 创建标题为 "BDD Workspace Restart Thread" 且来源为 "bdd-workspace-restart"
    当 我把最新创建线程的 workspace 设置为测试目录 "workspace-thread-restart-root"
    并且 我重新启动 Jingle 桌面应用
    那么 workspace:get 最新创建线程路径应为当前线程 workspace
    而且 workspace:get 全局路径应为当前线程 workspace

  场景: Pinned AI session 切换线程时 workspace 信息跟随当前线程
    假如 Jingle 桌面应用已启动
    而且 我通过 API 创建标题为 "BDD Workspace First UI" 且 workspace 为测试目录 "workspace-ui-first" 的线程
    而且 我通过 API 创建标题为 "BDD Workspace Second UI" 且 workspace 为测试目录 "workspace-ui-second" 的线程
    当 我通过 API 打开最后创建线程的 pinned AI session
    并且 我在 Pinned AI session 选择标题为 "BDD Workspace First UI" 的线程
    那么 Pinned AI session workspace 路径应为标题 "BDD Workspace First UI" 的线程 workspace
    当 我在 Pinned AI session 选择标题为 "BDD Workspace Second UI" 的线程
    那么 Pinned AI session workspace 路径应为标题 "BDD Workspace Second UI" 的线程 workspace

  场景: 读取线程 workspace 内的文本文件会返回内容
    假如 Jingle 桌面应用已启动
    而且 我通过 threads API 创建标题为 "BDD Workspace Reader" 且来源为 "bdd-workspace-read"
    而且 我把最新创建线程的 workspace 设置为测试目录 "workspace-read-root"
    而且 我在最新创建线程的 workspace 中写入文本文件 "notes.txt" 内容为 "hello workspace"
    当 我读取最新创建线程 workspace 中的文本文件 "notes.txt"
    那么 最新 workspace 文本读取结果应成功
    而且 最新 workspace 文本读取内容应为 "hello workspace"

  场景: 读取线程 workspace 外的文本路径会被拒绝
    假如 Jingle 桌面应用已启动
    而且 我通过 threads API 创建标题为 "BDD Workspace Guard" 且来源为 "bdd-workspace-guard"
    而且 我把最新创建线程的 workspace 设置为测试目录 "workspace-guard-root"
    当 我读取最新创建线程 workspace 中的文本文件 "../outside.txt"
    那么 最新 workspace 文本读取结果应失败
    而且 最新 workspace 文本读取错误应包含 "Access denied"

  场景: 读取线程 workspace 内的二进制文件会返回 base64
    假如 Jingle 桌面应用已启动
    而且 我通过 threads API 创建标题为 "BDD Workspace Binary" 且来源为 "bdd-workspace-binary"
    而且 我把最新创建线程的 workspace 设置为测试目录 "workspace-binary-root"
    而且 我在最新创建线程的 workspace 中写入二进制文件 "sample.bin" 字节 "0,1,2,3"
    当 我读取最新创建线程 workspace 中的二进制文件 "sample.bin"
    那么 最新 workspace 二进制读取结果应成功
    而且 最新 workspace 二进制读取内容应为 "AAECAw=="
