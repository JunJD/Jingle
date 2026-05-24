# language: zh-CN
@threads
功能: Threads 主进程契约
  为了让线程相关重构在长期迁移中保持行为稳定
  作为 Openwork main process 维护者
  我需要 threads API 能稳定创建、克隆、读取历史状态并删除线程

  场景: 创建线程会继承全局 workspace、默认模型和自定义 metadata
    假如 Openwork 桌面应用已启动
    当 我把全局 workspace 设置为测试目录 "threads-created-workspace"
    并且 我通过 threads API 创建标题为 "BDD Created Thread" 且来源为 "bdd"
    那么 最新创建线程标题应为 "BDD Created Thread"
    而且 最新创建线程 metadata.source 应为 "bdd"
    而且 最新创建线程 metadata.workspacePath 应为当前全局 workspace
    而且 最新创建线程 metadata.model 应为非空字符串
    而且 threads:list 包含最新创建线程

  场景: 克隆线程会生成新的线程并保留历史消息
    假如 Openwork 桌面应用已启动
    而且 存在标题为 "BDD Clone Source" 且包含历史消息 "BDD Clone Message" 的历史线程
    当 我克隆最后创建的历史线程
    那么 新克隆线程与源线程 ID 不同
    而且 新克隆线程标题应为 "BDD Clone Source"
    而且 新克隆线程的 history 应包含消息 "BDD Clone Message"

  场景: 读取历史状态会返回消息且 runtime state 初始为空
    假如 Openwork 桌面应用已启动
    而且 存在标题为 "BDD History Thread" 且包含历史消息 "BDD History Message" 的历史线程
    那么 最后创建历史线程的 history 应包含消息 "BDD History Message"
    而且 最后创建历史线程的 history 中待审批请求应为空
    而且 最后创建历史线程的 runtime state 中 todos 应为空
    而且 最后创建历史线程的 runtime state 中待审批请求应为空

  场景: 删除线程后 get 和 list 都不会再返回它
    假如 Openwork 桌面应用已启动
    当 我通过 threads API 创建标题为 "BDD Thread To Delete" 且来源为 "bdd-delete"
    并且 我删除最新创建的线程
    那么 threads:get 不再返回最新删除线程
    而且 threads:list 不再包含最新删除线程
