# language: zh-CN
@execute-command-classifier
功能: Execute command classifier 在不同平台写法下保持同一受控 shell 规则
  为了避免命令在 Windows 和 macOS 路径写法下被误判
  作为代理运行时维护者
  我需要允许同一策略下的安全只读命令，并继续拒绝平台原生命令和直接可执行路径

  场景大纲: Windows 和 macOS 风格路径不会误伤允许的只读命令
    当系统分类命令 "<命令>"
    那么分类结果应为 "read_only"
    而且处置应为 "allow"

    例子:
      | 命令                                     |
      | git -C /Users/demo/repo status -sb       |
      | git -C C:/Users/demo/repo status -sb     |
      | git -C C:\Users\demo\repo status -sb     |
      | env PATH=C:/Windows/System32 git status -sb |
      | env PATH=C:\Windows\System32 git status -sb |
      | find /Users/demo/repo -name package.json |
      | find C:\Users\demo\repo -name package.json |

  场景大纲: 平台原生命令和直接可执行路径仍然会被拒绝
    当系统分类命令 "<命令>"
    那么分类结果应为 "host_unsafe"
    而且处置应为 "deny"
    而且分类原因应包含 "<原因片段>"

    例子:
      | 命令                                 | 原因片段                         |
      | dir                                  | controlled shell allowlist       |
      | type README.md                       | controlled shell allowlist       |
      | findstr TODO README.md               | controlled shell allowlist       |
      | C:/Windows/System32/cmd.exe /c dir   | outside the controlled shell profile |
      | C:\Windows\System32\cmd.exe /c dir   | controlled shell allowlist       |
      | /bin/ls                              | outside the controlled shell profile |
