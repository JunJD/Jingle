# language: zh-CN
@launcher-history
功能: Launcher history 主进程契约
  为了让 Launcher history 迁移保持用户入口稳定
  作为 Openwork main process 维护者
  我需要 launcher history API 能稳定列出、置顶和删除历史项

  场景: launcher history 列表会把置顶项排在最近项前面
    假如 launcher history 中已有置顶目录 "BDD Pinned Directory" 和最近目录 "BDD Recent Directory"
    而且 Openwork 桌面应用已启动
    当 我读取 launcher history 列表
    那么 launcher history 第 1 项标题应为 "BDD Pinned Directory"
    而且 launcher history 第 2 项标题应为 "BDD Recent Directory"

  场景: launcher history 项可以被置顶
    假如 launcher history 中已有较早目录 "BDD Older Directory" 和最近目录 "BDD Recent Directory"
    而且 Openwork 桌面应用已启动
    当 我读取 launcher history 列表
    并且 我置顶标题为 "BDD Older Directory" 的 launcher history 项
    并且 我读取 launcher history 列表
    那么 launcher history 第 1 项标题应为 "BDD Older Directory"
    而且 launcher history 标题为 "BDD Older Directory" 的项应为置顶

  场景: launcher history 项可以被删除
    假如 launcher history 中已有较早目录 "BDD Remove Directory" 和最近目录 "BDD Keep Directory"
    而且 Openwork 桌面应用已启动
    当 我读取 launcher history 列表
    并且 我删除标题为 "BDD Remove Directory" 的 launcher history 项
    并且 我读取 launcher history 列表
    那么 launcher history 不包含标题为 "BDD Remove Directory" 的项
    而且 launcher history 包含标题为 "BDD Keep Directory" 的项
