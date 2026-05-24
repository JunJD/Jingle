# language: zh-CN
@shortcuts
功能: Shortcuts 主进程契约
  为了让快捷键系统在迁移中保持启动和设置行为稳定
  作为 Openwork main process 维护者
  我需要 shortcuts API 能稳定暴露 bootstrap 设置、更新设置、广播变化并返回全局注册状态

  场景: preload bootstrap 设置与 main 当前设置一致
    假如 Openwork 桌面应用已启动
    当 我读取 shortcuts bootstrap 状态
    并且 我读取 shortcuts 当前设置
    那么 shortcuts bootstrap 设置应等于当前设置
    而且 shortcuts resolved bindings 包含命令 "launcher.toggle" 来源为 "default"

  场景: setSettings 会更新当前设置、resolved binding 和 settingsChanged 事件
    假如 Openwork 桌面应用已启动
    当 我开始监听 shortcuts settingsChanged 事件
    并且 我把 launcher.toggle 快捷键设置为 "Ctrl+Alt+K"
    并且 我读取 shortcuts 当前设置
    那么 shortcuts 当前设置中 launcher.toggle 快捷键应为 "ctrl+alt+KeyK"
    而且 shortcuts resolved bindings 包含命令 "launcher.toggle" 来源为 "override"
    而且 shortcuts 最近一次 settingsChanged 事件中 launcher.toggle 快捷键应为 "ctrl+alt+KeyK"

  场景: 重置 settings 后 launcher.toggle 回到默认来源
    假如 Openwork 桌面应用已启动
    当 我把 launcher.toggle 快捷键设置为 "Ctrl+Alt+K"
    并且 我重置 shortcuts 设置
    并且 我读取 shortcuts 当前设置
    那么 shortcuts 当前设置不包含 launcher.toggle override
    而且 shortcuts resolved bindings 包含命令 "launcher.toggle" 来源为 "default"

  场景: 设置后重新启动仍然使用 override
    假如 Openwork 桌面应用已启动
    当 我把 launcher.toggle 快捷键设置为 "Ctrl+Alt+K"
    并且 我重新启动 Openwork 桌面应用
    并且 我读取 shortcuts bootstrap 状态
    并且 我读取 shortcuts 当前设置
    那么 shortcuts bootstrap 设置应等于当前设置
    而且 shortcuts 当前设置中 launcher.toggle 快捷键应为 "ctrl+alt+KeyK"
    而且 shortcuts resolved bindings 包含命令 "launcher.toggle" 来源为 "override"

  场景: global availability 会返回 launcher.toggle 注册记录
    假如 Openwork 桌面应用已启动
    当 我读取 shortcuts global availability
    那么 shortcuts global availability 包含命令 "launcher.toggle"
    而且 shortcuts global availability 中 "launcher.toggle" accelerator 应为非空字符串
