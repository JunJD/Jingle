# 查找本地日志

[English](./find-logs.md)

Openwork/Jingle 会写入本地诊断日志，帮助你理解失败原因，并在不发送整个 workspace 的情况下分享有用的 support 信息。

## 日志位置

默认情况下，日志在：

```text
~/.openwork/logs/openwork.log
```

如果应用启动时设置了 `OPENWORK_HOME`，日志在：

```text
$OPENWORK_HOME/logs/openwork.log
```

日志文件变大后应用会轮转日志，所以你也可能看到 `openwork.log.1` 之类的文件。

## 日志可能包含什么

日志可能包含：

- app startup 和 shutdown；
- Electron 和 platform 信息；
- window load failures；
- renderer errors reported to the main process；
- renderer console warnings 或 errors；
- process crash 或 unresponsive-window events。

日志用于诊断。它们不应该被当作每个 model token 或 workspace file 的完整 audit trail。

## 分享日志前

分享日志前：

1. 移除 API keys、tokens、本地用户名、私有路径或敏感项目名。
2. 附上 app version 和 operating system。
3. 说明问题发生时你正在做什么。
4. 尽可能只提供相关时间范围，而不是整个 log directory。

如果问题涉及 extension，请说明是哪个 extension，以及它是否已在 Settings -> Extensions 中连接。
