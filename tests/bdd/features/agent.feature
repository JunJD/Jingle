# language: zh-CN
@agent
功能: Agent 长任务主进程契约
  为了让 agent runtime 最后迁移时不破坏长时间运行流程
  作为 Openwork main process 维护者
  我需要 agent IPC 能稳定执行、暂停、恢复、取消和处理人工审批

  场景: invoke 会流式返回结果并让线程回到 idle
    假如 Openwork 桌面应用已使用脚本化 agent runtime 启动
    当 我通过 agent API 创建可运行测试线程 "BDD Agent Invoke"
    并且 我对最新 agent 线程发送脚本消息 "bdd:success"
    那么 最新 agent stream 应收到 done
    而且 最新 agent stream 应包含文本 "scripted agent completed"
    而且 最新 agent 线程状态应为 "idle"

  场景: cancel 会中断长时间运行的 agent stream
    假如 Openwork 桌面应用已使用脚本化 agent runtime 启动
    当 我通过 agent API 创建可运行测试线程 "BDD Agent Cancel"
    并且 我对最新 agent 线程发送脚本消息 "bdd:long"
    那么 最新 agent stream 应进入长任务
    当 我取消最新 agent 线程
    那么 最新 agent 线程状态应为 "interrupted"
    而且 最新 agent stream 不应收到 done

  场景: HITL 暂停后可以通过 resume 批准并继续
    假如 Openwork 桌面应用已使用脚本化 agent runtime 启动
    当 我通过 agent API 创建可运行测试线程 "BDD Agent Resume"
    并且 我对最新 agent 线程发送脚本消息 "bdd:interrupt"
    那么 最新 agent stream 应收到 done
    而且 最新 agent stream 应收到 HITL 中断
    而且 最新 agent stream HITL 请求 id 应与 runtime state 一致
    而且 最新 agent runtime state 待审批工具应为 "write_file"
    而且 最新 agent 线程状态应为 "interrupted"
    当 我通过 agent resume 批准最新待审批请求
    那么 最新 agent stream 应收到 done
    而且 最新 agent stream 应包含文本 "scripted agent approval resolved"
    而且 最新 agent runtime state 待审批请求应为空
    而且 最新 agent 线程状态应为 "idle"

  场景: HITL 暂停后可以通过 resume 响应拒绝
    假如 Openwork 桌面应用已使用脚本化 agent runtime 启动
    当 我通过 agent API 创建可运行测试线程 "BDD Agent Reject"
    并且 我对最新 agent 线程发送脚本消息 "bdd:interrupt"
    那么 最新 agent stream 应收到 done
    而且 最新 agent runtime state 待审批工具应为 "write_file"
    当 我通过 agent resume 拒绝最新待审批请求
    那么 最新 agent stream 应收到 done
    而且 最新 agent runtime state 待审批请求应为空
    而且 最新 agent 线程状态应为 "idle"
