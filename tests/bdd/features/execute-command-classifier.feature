# language: zh-CN
@execute-command-classifier
功能: Execute command classifier 为受控 shell 标记风险等级
  为了让 Jingle 只自动放行明确安全的命令
  作为代理运行时维护者
  我需要把 shell 命令稳定分类为只读、网络读取、可预测变更、可管理进程或直接拒绝

  场景大纲: 明确只读的命令可以直接放行
    当系统分类命令 "<命令>"
    那么分类结果应为 "read_only"
    而且处置应为 "allow"
    而且分类原因应包含 "<原因片段>"

    例子:
      | 命令                         | 原因片段                  |
      | pwd && ls -la                | read-only allowlist       |
      | env FOO=bar rg mutation src  | read-only allowlist       |
      | git -C /tmp/repo status -sb  | read-only allowlist       |
      | npm --version                | version inspection        |
      | pnpm --version               | version inspection        |
      | python3 --version            | version inspection        |
      | node --version               | version inspection        |
      | find src -name '*.ts'        | only reads workspace paths |

  场景: 只读命令链会保留每个命令名
    当系统分类命令 "git status && echo ok"
    那么分类结果应为 "read_only"
    而且处置应为 "allow"
    而且识别出的命令列表应为 "git, echo"

  场景大纲: 公共 HTTP 只读请求可以直接放行
    当系统分类命令 "<命令>"
    那么分类结果应为 "network_read"
    而且处置应为 "allow"
    而且分类原因应包含 "public HTTP GET/HEAD request"
    而且网络目标应为 "<网络目标>"

    例子:
      | 命令                                    | 网络目标                                 |
      | curl -I https://example.com             | https://example.com/                     |
      | curl --request=HEAD https://example.com | https://example.com/                     |
      | curl 'https://example.com'              | https://example.com/                     |
      | curl https://example.com https://example.com/docs | https://example.com/, https://example.com/docs |

  场景: 重复的网络目标只会记录一次
    当系统分类命令 "curl https://example.com && curl -I https://example.com"
    那么分类结果应为 "network_read"
    而且处置应为 "allow"
    而且网络目标应为 "https://example.com/"

  场景大纲: 明确会修改工作区的命令需要审批
    当系统分类命令 "<命令>"
    那么分类结果应为 "predictable_mutation"
    而且处置应为 "require_approval"
    而且分类原因应包含 "<原因片段>"

    例子:
      | 命令                                | 原因片段                    |
      | echo hello > notes.txt              | shell redirection           |
      | sed -i 's/old/new/' src/app.ts      | in-place editing            |
      | echo hello \| tee notes.txt         | explicit file targets       |
      | mkdir dist                          | modifies files or directories |
      | chmod +x script.sh                  | modifies files or directories |
      | python3 scripts/update.py           | mutation prediction and approval |
      | node scripts/update.js              | mutation prediction and approval |
      | find src -delete                    | deletes files with -delete  |

  场景: Python 内联代码写文件需要审批
    当系统分类命令:
      """
      python3 -c "open('notes.txt', 'w').write('hello')"
      """
    那么分类结果应为 "predictable_mutation"
    而且处置应为 "require_approval"
    而且分类原因应包含 "mutation prediction and approval"

  场景: Node 内联代码写文件需要审批
    当系统分类命令:
      """
      node -e "require('fs').writeFileSync('notes.txt', 'hello')"
      """
    那么分类结果应为 "predictable_mutation"
    而且处置应为 "require_approval"
    而且分类原因应包含 "mutation prediction and approval"

  场景: 网络读取后再创建目录仍然需要审批
    当系统分类命令 "curl https://example.com && mkdir dist"
    那么分类结果应为 "predictable_mutation"
    而且处置应为 "require_approval"
    而且分类原因应包含 "modifies files or directories"
    而且网络目标应为 "https://example.com/"

  场景大纲: 明确启动本地服务的命令需要审批并作为可管理进程处理
    当系统分类命令 "<命令>"
    那么分类结果应为 "managed_process"
    而且处置应为 "require_approval"
    而且分类原因应包含 "managed process"

    例子:
      | 命令                   |
      | python3 -m http.server |
      | npm run dev            |
      | pnpm run preview       |

  场景大纲: 未纳入受控 profile 的静态命令需要用户确认
    当系统分类命令 "<命令>"
    那么分类结果应为 "unknown_command"
    而且处置应为 "require_approval"
    而且分类原因应包含 "<原因片段>"

    例子:
      | 命令                          | 原因片段               |
      | npm run build                  | requires user approval |
      | pnpm install                   | requires user approval |
      | python3 -m pip install pytest  | requires user approval |
      | node --inspect scripts/update.js | requires user approval |
      | dir                            | requires user approval |
      | type README.md                 | requires user approval |
      | findstr TODO README.md         | requires user approval |
      | sh scripts/dev.sh             | 未知副作用操作         |
      | sh -c "echo hello" > out.txt  | 未知副作用操作         |
      | bash scripts/dev.sh            | 未知副作用操作         |
      | zsh scripts/dev.sh             | 未知副作用操作         |

  场景大纲: 无法安全表达边界的命令会被直接拒绝
    当系统分类命令 "<命令>"
    那么分类结果应为 "host_unsafe"
    而且处置应为 "deny"
    而且分类原因应包含 "<原因片段>"

    例子:
      | 命令                                      | 原因片段                         |
      | curl -XPOST https://example.com           | request method 'POST'            |
      | curl -o out.txt https://example.com       | output-to-file flags             |
      | find src -name package.json -exec cat {} + | executes nested commands         |
      | $CMD README.md                            | cannot be classified safely      |
      | /bin/ls                                   | outside the controlled shell profile |
      | sleep 1 &                                 | Background shell execution       |

  场景: js-exec 不是宿主命令所以会被拒绝
    当系统分类命令:
      """
      js-exec -c "console.log('hello')"
      """
    那么分类结果应为 "host_unsafe"
    而且处置应为 "deny"
    而且分类原因应包含 "not a host command"

  场景: 命令链里只要出现写入风险就整体需要审批
    当系统分类命令 "echo hello > notes.txt && npm run dev"
    那么分类结果应为 "predictable_mutation"
    而且处置应为 "require_approval"
    而且分类原因应包含 "shell redirection"
    而且识别出的命令列表应为 "echo, npm"

  场景: 命令链里出现未知命令时整体按未知命令等待用户确认
    当系统分类命令 "echo hello > notes.txt && npm run build"
    那么分类结果应为 "unknown_command"
    而且处置应为 "require_approval"
    而且分类原因应包含 "requires user approval"
    而且识别出的命令列表应为 "echo, npm"

  场景: 空命令会被拒绝
    当系统分类命令:
      """
         
      """
    那么分类结果应为 "host_unsafe"
    而且处置应为 "deny"
    而且分类原因应包含 "non-empty string"
    而且识别出的命令列表应为空

  场景: 无法安全解析的 shell 语法会被拒绝
    当系统分类命令 "("
    那么分类结果应为 "host_unsafe"
    而且处置应为 "deny"
    而且分类原因应包含 "could not be parsed safely"
    而且识别出的命令列表应为空

  场景: 只有注释而没有可执行命令时会被拒绝
    当系统分类命令 "# comment only"
    那么分类结果应为 "host_unsafe"
    而且处置应为 "deny"
    而且分类原因应包含 "did not contain any executable commands"
    而且识别出的命令列表应为空
