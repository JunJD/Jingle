# language: zh-CN
@subagent-read-only-guardrail
功能: Subagent 只读 guardrail
  为了让子代理只做调研和查询
  作为 Openwork 的代理运行时维护者
  我需要子代理拒绝会改世界的工具调用，并继续允许只读工具运行

  场景大纲: 子代理会拒绝变更型工具
    假如子代理只读 guardrail 已启用
    当子代理请求调用 "<工具名>" 工具并传入参数:
      """
      <参数>
      """
    那么该工具调用应被 guardrail 拒绝
    而且拒绝结果应关联 tool call id "subagent-tool-call-1"
    而且拒绝消息应提示交给父代理执行

    例子:
      | 工具名      | 参数                                                           |
      | execute     | {"command":"npm test"}                                         |
      | write_file  | {"file_path":"/workspace/notes.txt","content":"hello"}         |
      | edit_file   | {"file_path":"/workspace/notes.txt","search":"a","replace":"b"} |

  场景: 子代理允许只读工具继续执行
    假如子代理只读 guardrail 已启用
    当子代理请求调用 "read_file" 工具并传入参数:
      """
      {"file_path":"/workspace/README.md"}
      """
    那么该工具调用应继续交给底层处理器
    而且底层处理器收到的工具名应为 "read_file"
