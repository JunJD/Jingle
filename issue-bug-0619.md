# 0619 非阻塞问题记录

## 旧 Main 历史窗口 BDD 需要重写到新 LauncherAI 入口

- 现象：`tests/bdd/features/app-launch.feature`、`artifact-tabs.feature`、`workspace.feature` 仍有大量 “Main 窗口” 场景和步骤，步骤里还通过旧 `api.mainWindow.openWindow()` 打开历史窗口。
- 当前判断：旧 Main 历史窗口壳正在删除，新的事实入口是 Launcher / pinned AI session。保留 `mainWindow` 兼容 API 会继续扩大旧设计残影，所以不在 renderer/preload 里做 fallback。
- 影响：TypeScript 类型检查不受影响，但对应旧 BDD 场景需要重新定义到 LauncherAI 侧边栏、pinned session 或 artifact 新入口后再恢复执行。
