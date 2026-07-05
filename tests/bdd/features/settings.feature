# language: zh-CN
@settings
功能: Settings 主进程契约
  为了让 settings IPC 读写行为稳定
  作为 Jingle main process 维护者
  我需要 renderer 能稳定读写 agent config 和 launcher settings

  场景: Agent config 语言设置重启后仍然保留
    假如 Jingle 桌面应用已启动
    当 我通过 settings API 将语言设置为 "en-US"
    并且 我重新启动 Jingle 桌面应用
    那么 settings:getAgentConfig 语言应为 "en-US"

  场景: Launcher 窗口模式设置重启后仍然保留
    假如 Jingle 桌面应用已启动
    当 我通过 settings API 将 launcher 窗口模式设置为 "compact"
    并且 我重新启动 Jingle 桌面应用
    那么 settings:getLauncherSettings 窗口模式应为 "compact"
