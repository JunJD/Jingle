# language: zh-CN
@artifact-tabs
功能: Artifact Tab 工作流
  为了在历史工作区里稳定查看交付物
  作为 Openwork 用户
  我需要能从右侧 Artifacts 面板和聊天消息打开同一个 artifact tab，并在关闭后回到 Agent

  场景: 从右侧 Artifacts 面板打开 artifact 不会重复创建 tab
    假如 Openwork 桌面应用已启动
    而且 存在标题为 "BDD Artifact Thread" 且包含 summary artifact "BDD Artifact Summary" 的历史线程
    当 我直接打开 Main 历史窗口
    并且 我在 Main 窗口选择标题为 "BDD Artifact Thread" 的线程
    并且 我在 Main 窗口从右侧 Artifacts 面板打开标题为 "BDD Artifact Summary" 的 artifact
    那么 Main 窗口顶部存在标题为 "BDD Artifact Summary" 的 artifact tab
    而且 Main 窗口当前激活的主 tab 为标题 "BDD Artifact Summary" 的 artifact
    而且 Main 窗口 artifact viewer 展示标题为 "BDD Artifact Summary"
    当 我在 Main 窗口从右侧 Artifacts 面板打开标题为 "BDD Artifact Summary" 的 artifact
    那么 Main 窗口标题为 "BDD Artifact Summary" 的 artifact tab 只有一个

  场景: 从 present_artifacts 消息打开 artifact 后关闭会回到 Agent
    假如 Openwork 桌面应用已启动
    而且 存在标题为 "BDD Artifact Thread" 且包含 summary artifact "BDD Artifact Summary" 的历史线程
    当 我直接打开 Main 历史窗口
    并且 我在 Main 窗口选择标题为 "BDD Artifact Thread" 的线程
    并且 我在 Main 窗口展开 present_artifacts 工具消息
    并且 我在 Main 窗口从聊天消息打开标题为 "BDD Artifact Summary" 的 artifact
    那么 Main 窗口顶部存在标题为 "BDD Artifact Summary" 的 artifact tab
    而且 Main 窗口当前激活的主 tab 为标题 "BDD Artifact Summary" 的 artifact
    当 我关闭标题为 "BDD Artifact Summary" 的 artifact tab
    那么 Main 窗口当前激活的主 tab 为 Agent
