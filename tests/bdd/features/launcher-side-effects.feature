# language: zh-CN
@launcher-side-effects
功能: Launcher 动作副作用
  为了让 launcher action 迁移后仍保持副作用稳定
  作为 Openwork main process 维护者
  我需要 launcher:executeAction 在执行 local start 打开动作时稳定记录使用次数和 launcher history

  场景: Launcher 执行 local start 打开动作会同时更新 local start 和 launcher history
    假如 Openwork 桌面应用已启动
    当 我 upsert local start 目录 "BDD Launcher Local Start" 路径为 "projects/bdd-launcher-side-effect"
    并且 我通过 Launcher API 执行标题为 "BDD Launcher Local Start" 的 local start 打开动作
    那么 Launcher API 动作执行成功
    当 我读取 local start 列表
    并且 我读取 launcher history 列表
    那么 local start 标题为 "BDD Launcher Local Start" 的项 useCount 应为 1
    而且 launcher history 第 1 项标题应为 "BDD Launcher Local Start"
    而且 launcher history 标题为 "BDD Launcher Local Start" 的项 historyKey 应等于当前执行 local start 的 historyKey
