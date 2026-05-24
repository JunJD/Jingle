# language: zh-CN
@recording-fs
功能: RecordingFs 只输出最终需要进入影子仓库的文件变更
  为了只把 AI 真正留下来的文件提交到影子 git
  作为命令预演和审计链路的实现者
  我需要 RecordingFs 把中间态折叠成最终变更文件集合

  场景: 新建文件会被记录为创建
    假如一个 RecordingFs 工作目录是空的
    当我在该工作目录执行 Bash 命令:
      """
      printf 'alpha' > note.txt
      """
    那么 Bash 退出码应为 0
    而且最终变更文件应为:
      | 路径     | 变更类型 |
      | note.txt | create   |

  场景: 同尺寸内容替换仍然会被记录为修改
    假如一个 RecordingFs 工作目录包含这些文件:
      | 路径        | 内容  |
      | profile.txt | alpha |
    当我在该工作目录执行 Bash 命令:
      """
      printf 'gamma' > profile.txt
      """
    那么 Bash 退出码应为 0
    而且最终变更文件应为:
      | 路径        | 变更类型 |
      | profile.txt | modify   |

  场景: 创建后又删除的文件不会进入最终变更集合
    假如一个 RecordingFs 工作目录是空的
    当我在该工作目录执行 Bash 命令:
      """
      printf 'temp' > draft.txt && rm draft.txt
      """
    那么 Bash 退出码应为 0
    而且最终变更文件应为空

  场景: 删除已有目录时会展开成被删除的文件列表
    假如一个 RecordingFs 工作目录包含这些文件:
      | 路径              | 内容 |
      | docs/intro.md     | one  |
      | docs/nested/a.txt | two  |
    当我在该工作目录执行 Bash 命令:
      """
      rm -rf docs
      """
    那么 Bash 退出码应为 0
    而且最终变更文件应为:
      | 路径              | 变更类型 |
      | docs/intro.md     | delete   |
      | docs/nested/a.txt | delete   |

  场景: 重命名到新路径会折叠成删除旧文件并创建新文件
    假如一个 RecordingFs 工作目录包含这些文件:
      | 路径      | 内容      |
      | draft.txt | published |
    当我在该工作目录执行 Bash 命令:
      """
      mv draft.txt published.txt
      """
    那么 Bash 退出码应为 0
    而且最终变更文件应为:
      | 路径          | 变更类型 |
      | draft.txt     | delete   |
      | published.txt | create   |

  场景: 重命名覆盖已有目标时会记录目标修改和来源删除
    假如一个 RecordingFs 工作目录包含这些文件:
      | 路径          | 内容  |
      | old-name.txt  | alpha |
      | stable-name.txt | beta  |
    当我在该工作目录执行 Bash 命令:
      """
      mv old-name.txt stable-name.txt
      """
    那么 Bash 退出码应为 0
    而且最终变更文件应为:
      | 路径            | 变更类型 |
      | old-name.txt    | delete   |
      | stable-name.txt | modify   |

  场景: 递归复制目录时会记录新目录下的文件创建
    假如一个 RecordingFs 工作目录包含这些文件:
      | 路径              | 内容 |
      | source/a.txt      | one  |
      | source/nested/b.txt | two  |
    当我在该工作目录执行 Bash 命令:
      """
      cp -r source copied
      """
    那么 Bash 退出码应为 0
    而且最终变更文件应为:
      | 路径                | 变更类型 |
      | copied/a.txt        | create   |
      | copied/nested/b.txt | create   |

  场景: 命令失败前已经落下的文件仍会被记录
    假如一个 RecordingFs 工作目录是空的
    当我在该工作目录执行 Bash 命令:
      """
      printf 'done' > done.txt && missing-command
      """
    那么 Bash 退出码应为 127
    而且最终变更文件应为:
      | 路径     | 变更类型 |
      | done.txt | create   |

  场景: 忽略 .git 目录时只记录业务文件
    假如一个 RecordingFs 工作目录是空的
    而且 RecordingFs 会忽略 Git 元数据目录
    当我在该工作目录执行 Bash 命令:
      """
      mkdir -p .git && printf 'index' > .git/index && printf 'note' > note.txt
      """
    那么 Bash 退出码应为 0
    而且最终变更文件应为:
      | 路径     | 变更类型 |
      | note.txt | create   |

  场景: 只改权限也会被记录为修改
    假如一个 RecordingFs 工作目录包含这些文件:
      | 路径      | 内容           |
      | script.sh | echo 'hello'   |
    当我在该工作目录执行 Bash 命令:
      """
      chmod 755 script.sh
      """
    那么 Bash 退出码应为 0
    而且最终变更文件应为:
      | 路径      | 变更类型 |
      | script.sh | modify   |

  场景: 先修改再删除整个目录时只保留最终删除结果
    假如一个 RecordingFs 工作目录包含这些文件:
      | 路径          | 内容  |
      | project/a.txt | alpha |
    当我在该工作目录执行 Bash 命令:
      """
      printf 'gamma' > project/a.txt && rm -rf project
      """
    那么 Bash 退出码应为 0
    而且最终变更文件应为:
      | 路径          | 变更类型 |
      | project/a.txt | delete   |
