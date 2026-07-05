# language: zh-CN
@artifacts-ui
功能: LauncherAI Artifact 展示工作流
  为了在新 LauncherAI 中稳定查看交付物入口
  作为 Jingle 用户
  我需要 artifact 出现在面板和 present_artifacts 消息中，但不再创建 artifact tab

  场景: Pinned AI session 从 artifact 面板展示 summary artifact
    假如 Jingle 桌面应用已启动
    而且 存在标题为 "BDD Artifact Thread" 且包含 summary artifact "BDD Artifact Summary" 的 Launcher AI 历史线程
    当 我通过 API 打开最后创建线程的 pinned AI session
    那么 Pinned AI session artifact 面板展示标题为 "BDD Artifact Summary" 的 artifact
    而且 Pinned AI session artifact 面板中标题为 "BDD Artifact Summary" 的 artifact 不可打开
    而且 Pinned AI session 不存在 artifact tab

  场景: Pinned AI session 的 present_artifacts 消息展示 artifact 且不创建 tab
    假如 Jingle 桌面应用已启动
    而且 存在标题为 "BDD Artifact Thread" 且包含 summary artifact "BDD Artifact Summary" 的 Launcher AI 历史线程
    当 我通过 API 打开最后创建线程的 pinned AI session
    并且 我在 Pinned AI session 展开 present_artifacts 工具消息
    那么 Pinned AI session present_artifacts 消息展示标题为 "BDD Artifact Summary" 的 artifact
    而且 Pinned AI session present_artifacts 消息中标题为 "BDD Artifact Summary" 的 artifact 不可打开
    而且 Pinned AI session 不存在 artifact tab
