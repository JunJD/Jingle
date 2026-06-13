# Extensions 概览

[English](./overview.md)

Extensions 会给 launcher 和 agent workflow 增加 commands、surfaces、settings 和 AI capabilities。

## Extensions 出现在哪里

Extensions 可能出现在：

- launcher search；
- launcher command pages；
- Settings -> Extensions；
- AI mentions 和 capability loading；
- menu bar items；
- quicklinks。

有些 extensions 是内置的。有些是 bundled installable packages。用户安装的 packages 也可以从本地 Openwork data directory 加载。

## 当前 First-Party Extensions

内置或 bundled capabilities 包括：

- Todo List：本地轻量 task capture 和 organization。
- Translate：基于模型的 selected text 或 free-form input 翻译。
- Image Generation：配置 image API key 后，从 AI chat 生成或编辑图片。
- Apple Reminders：macOS reminders commands、menu bar 和 AI tools。
- GitHub：基于 OAuth 的 issues、pull requests、repositories、notifications 和 workflow runs。
- Notion：已连接 Notion pages、data sources、quick capture 和 AI tools。
- Figma Files：已连接 team file search 和 quick access。

## Connections And Preferences

打开 Settings -> Extensions 配置 extension preferences 或连接 accounts。OAuth-backed extensions 会打开浏览器授权页，并通过 `jingle://` app scheme 回到应用。

Connection tokens 会被本地 app runtime 使用。请把 connected extensions 当成对对应外部 account 的访问权限。

## AI Capabilities

有些 extensions 会暴露 AI tools。Agent 会先看到轻量 capability catalog。当 task 需要某个具体 extension 时，应用会加载该 extension 的 tool details，并通过 extension runtime 运行工具。

如果 extension 未连接或缺少必需 preferences，agent 应该告诉你先配置它，再使用它的 tools。

## Quicklinks

Quicklinks 保存常用 extension commands 或 launch contexts。你可以从 Settings -> Quicklinks 管理它们，也可以从支持的 extension actions 创建。
