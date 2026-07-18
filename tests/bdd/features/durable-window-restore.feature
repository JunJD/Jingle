# language: zh-CN
@durable-window-restore
功能: Durable 窗口恢复策略
  为了避免已归档或已删除的线程在重启后重新成为活动窗口
  作为 Jingle 桌面用户
  我需要 Main 和 Thread 窗口只恢复仍然有效的线程绑定

  场景: 重启时只恢复 active 线程窗口并修复 stale bindings
    假如 Jingle 桌面应用已启动
    而且 已持久化 active、archived 和 missing 线程的 durable 窗口绑定
    当 我重新启动 Jingle 桌面应用
    那么 只恢复 active 线程的 Thread 窗口
    而且 durable 窗口 stale bindings 已从偏好中修复
