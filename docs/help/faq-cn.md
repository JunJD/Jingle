# FAQ

[English](./faq.md)

## Openwork/Jingle 是 local-first 吗？

桌面 workspace、thread state、memory records、artifacts、settings 和 logs 都是 local-first。外部 model providers 和已连接 extensions 仍会向你配置的 providers 或 services 发送请求。

## Agent 可以读取或更改什么？

Agent 在选中的 workspace 中工作，并使用这个 task 可用的 files、context、extensions 和 tools。Commands、edits 和外部 write actions 是否需要 approval，取决于 permission mode 和 tool policy。

## 模型 keys 存在哪里？

在 Settings -> Models 配置 model providers。请把已保存的 provider credentials 视为敏感的本地应用数据。已配置 providers 和可用模型以 Settings UI 为当前事实源。

## 为什么我需要批准一个 command？

Approvals 保护会影响你的文件、电脑或已连接 accounts 的 actions。请阅读 approval card，并拒绝任何令人意外、范围过大或与任务无关的 action。

## 如何停止或恢复一个 run？

对正在运行的 task，使用 AI surface 中的 stop control。之前的工作会保留在 thread 中。你可以从 history window 或 thread search 回来，然后继续或 fork thread。

## 如何删除或控制 memory？

使用 Settings -> Memory。Memory 是 local-first 且由用户控制。你可以从这个 tab 里 review saved memories、处理 suggestions，并打开或关闭 memory behavior。

## 哪些 extensions 需要 OAuth？

当前 first-party extension set 中，GitHub、Notion 和 Figma Files 使用 OAuth-backed account connections。Apple Reminders 使用本地 macOS Reminders database。Image Generation 需要 API key preference。

## 日志在哪里？

默认情况下，日志在 `~/.openwork/logs/openwork.log`。如果设置了 `OPENWORK_HOME`，日志在 `$OPENWORK_HOME/logs/openwork.log`。

## Launcher 和 history window 有什么区别？

Launcher 是 search、commands、AI tasks 和 extension workflows 的快速入口。History window 用于回到之前的 threads 并查看持久化工作。

## npm package 和 desktop release 有什么区别？

npm package 可以用 `npx openwork` 运行，或全局安装。Desktop release assets 是 GitHub Releases 中针对各个平台附带的 packaged app builds。
