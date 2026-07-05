# language: zh-CN
@tool-approval
功能: 工具审批事项
  为了让人工审批准确理解代理即将做什么
  作为 Jingle 的代理运行时维护者
  我需要审批事项正确描述文件变更，并且与真实工具参数分开保存

  场景: 新建文件时审批事项标记为新增
    假如一个文件审批工作区是空的
    当系统为文件 "notes.txt" 生成内容为 "hello" 的 write_file 审批事项
    那么审批事项中的目标文件应为 "notes.txt"
    而且审批事项中的变更应标记为 "create"

  场景: 覆盖已有文件时审批事项标记为修改
    假如一个文件审批工作区中已有文件 "notes.txt" 内容为 "old content"
    当系统为文件 "notes.txt" 生成内容为 "hello" 的 write_file 审批事项
    那么审批事项中的目标文件应为 "notes.txt"
    而且审批事项中的变更应标记为 "modify"

  场景: 恢复待审批请求时保留真实参数并单独携带审批事项
    假如一个运行时中断里包含 write_file 的真实参数和独立审批事项
    当系统从运行时提取这个待审批请求
    那么待审批请求中的工具参数应为:
      """
      {"content":"hello","path":"/tmp/demo.txt"}
      """
    而且待审批请求中的审批事项应标记 "/tmp/demo.txt" 为 "create"
