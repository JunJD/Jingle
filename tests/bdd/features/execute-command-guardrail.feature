# language: zh-CN
@execute-command-guardrail
功能: Execute command guardrail 收口受控 shell 的真实执行边界
  为了让 Openwork 只在可解释的边界内执行 shell 命令
  作为 Openwork 的代理运行时维护者
  我需要根据命令分类和预测结果决定命令是直接放行、进入后续审批流程，还是被立即拒绝

  场景: 只读命令不会触发预测器
    当系统使用受控 shell 守卫评估命令 "pwd"
    那么守卫结果应为 "allow"
    而且守卫记录的分类应为 "read_only"
    而且预测器调用次数应为 0

  场景: 预测成功的 Python 改写命令可以继续进入后续审批流程
    假如预测器会返回 "predicted" 状态
    当系统使用受控 shell 守卫评估命令 "python3 -c 'open(\"notes.txt\", \"w\").write(\"hello\")'"
    那么守卫结果应为 "allow"
    而且守卫记录的分类应为 "predictable_mutation"
    而且守卫记录的处置应为 "require_approval"
    而且守卫记录的预测状态应为 "predicted"
    而且预测器调用次数应为 1

  场景: 预测器不支持时系统拒绝这个编辑命令
    假如预测器会返回 "unsupported_command" 状态
    当系统使用受控 shell 守卫评估命令 "python3 -c 'open(\"notes.txt\", \"w\").write(\"hello\")'"
    那么守卫结果应为 "deny"
    而且守卫记录的分类应为 "predictable_mutation"
    而且守卫记录的处置应为 "require_approval"
    而且守卫记录的预测状态应为 "unsupported_command"
    而且守卫拒绝原因应包含 "target files could not be predicted"
    而且预测器调用次数应为 1

  场景: 可管理进程不触发文件预测但会进入后续审批流程
    当系统使用受控 shell 守卫评估命令 "python3 -m http.server"
    那么守卫结果应为 "allow"
    而且守卫记录的分类应为 "managed_process"
    而且守卫记录的处置应为 "require_approval"
    而且预测器调用次数应为 0

  场景: js-exec 因为不是宿主命令而被立即拒绝
    当系统使用受控 shell 守卫评估命令 "js-exec -c 'console.log(\"hello\")'"
    那么守卫结果应为 "deny"
    而且守卫记录的分类应为 "host_unsafe"
    而且守卫记录的处置应为 "deny"
    而且守卫拒绝原因应包含 "not a host command"
    而且预测器调用次数应为 0
