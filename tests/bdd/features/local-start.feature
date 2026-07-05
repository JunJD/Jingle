# language: zh-CN
@local-start
功能: Local start 主进程契约
  为了让用户固定的本地启动项稳定可管理
  作为 Jingle main process 维护者
  我需要 local start API 能稳定新增、更新、记录使用并删除项目

  场景: upsert 新项目后 list 可以读取到它
    假如 Jingle 桌面应用已启动
    当 我 upsert local start 目录 "BDD Local Project" 路径为 "projects/bdd-local-project"
    并且 我读取 local start 列表
    那么 local start 列表包含标题为 "BDD Local Project" 的项
    而且 local start 标题为 "BDD Local Project" 的项 useCount 应为 0

  场景: upsert 同一路径会更新已有项目而不是创建重复项
    假如 Jingle 桌面应用已启动
    当 我 upsert local start 目录 "BDD Old Project Title" 路径为 "projects/bdd-upsert-project"
    并且 我 upsert local start 目录 "BDD New Project Title" 路径为 "projects/bdd-upsert-project"
    并且 我读取 local start 列表
    那么 local start 列表中路径为当前 local start 路径的项只有 1 个
    而且 local start 列表包含标题为 "BDD New Project Title" 的项

  场景: recordUse 会增加使用次数并让项目排到前面
    假如 Jingle 桌面应用已启动
    当 我 upsert local start 目录 "BDD Quiet Project" 路径为 "projects/bdd-quiet-project"
    并且 我 upsert local start 目录 "BDD Used Project" 路径为 "projects/bdd-used-project"
    并且 我记录使用标题为 "BDD Used Project" 的 local start 项
    并且 我读取 local start 列表
    那么 local start 第 1 项标题应为 "BDD Used Project"
    而且 local start 标题为 "BDD Used Project" 的项 useCount 应为 1

  场景: remove 会从 list 中删除项目
    假如 Jingle 桌面应用已启动
    当 我 upsert local start 目录 "BDD Remove Project" 路径为 "projects/bdd-remove-project"
    并且 我 upsert local start 目录 "BDD Keep Project" 路径为 "projects/bdd-keep-project"
    并且 我删除标题为 "BDD Remove Project" 的 local start 项
    并且 我读取 local start 列表
    那么 local start 列表不包含标题为 "BDD Remove Project" 的项
    而且 local start 列表包含标题为 "BDD Keep Project" 的项
