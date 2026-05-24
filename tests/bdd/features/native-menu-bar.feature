# language: zh-CN
@native-menu-bar
功能: Native menu bar 主进程契约
  为了让 native menu bar 迁移时保持主进程契约稳定
  作为 Openwork main process 维护者
  我需要 native menu bar API 能稳定设置状态、转发选择事件并清理状态

  场景: native menu bar 可以设置状态、转发 itemSelected 并清理状态
    假如 Openwork 桌面应用已启动
    当 我开始监听 native menu bar itemSelected 事件
    并且 我通过 native menu bar API 设置命令 "bdd-native-menu" 的状态
    那么 native menu bar 测试快照包含命令 "bdd-native-menu"
    而且 native menu bar 命令 "bdd-native-menu" 的第 1 个项目标题应为 "BDD Native Menu Item"
    当 我在主进程触发 native menu bar 命令 "bdd-native-menu" 选择项目 "bdd-native-item"
    那么 native menu bar 最近事件 commandKey 应为 "bdd-native-menu"
    而且 native menu bar 最近事件 itemId 应为 "bdd-native-item"
    当 我通过 native menu bar API 清理命令 "bdd-native-menu" 的状态
    那么 native menu bar 测试快照不包含命令 "bdd-native-menu"
