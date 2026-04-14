# Openwork Model Provider 实现说明

这次实现按一个边界落地：

- `main` 层负责 provider catalog、settings、secrets、runtime resolver、SDK adapter。
- `renderer` 层负责复用 Dify `model-provider-page` 的页面结构和交互组织。
- provider secret 只走 `secretsStore + safeStorage`，不再读写 `.env` 做兼容。
- 模型 ID 使用 `provider:model` 格式保存，例如 `dashscope:glm-4.6`；未识别的 model/provider 直接报错，不按模型名前缀猜 provider。

## Dify 参考路径

Renderer 侧主要参考 Dify 的 provider feature：

- `/Users/junjieding/dingjunjie_dev/2026_03/dify/web/app/components/header/account-setting/model-provider-page/index.tsx`
- `/Users/junjieding/dingjunjie_dev/2026_03/dify/web/app/components/header/account-setting/model-provider-page/declarations.ts`
- `/Users/junjieding/dingjunjie_dev/2026_03/dify/web/app/components/header/account-setting/model-provider-page/provider-added-card/index.tsx`
- `/Users/junjieding/dingjunjie_dev/2026_03/dify/web/app/components/header/account-setting/model-provider-page/provider-added-card/credential-panel.tsx`
- `/Users/junjieding/dingjunjie_dev/2026_03/dify/web/app/components/header/account-setting/model-provider-page/provider-added-card/model-list.tsx`
- `/Users/junjieding/dingjunjie_dev/2026_03/dify/web/app/components/header/account-setting/model-provider-page/system-model-selector/index.tsx`

Runtime / SDK 侧主要参考 Dify 的职责切分，不照搬 Python 实现：

- `/Users/junjieding/dingjunjie_dev/2026_03/dify/api/core/app/llm/model_access.py`
- `/Users/junjieding/dingjunjie_dev/2026_03/dify/api/core/provider_manager.py`
- `/Users/junjieding/dingjunjie_dev/2026_03/dify/api/core/plugin/impl/model_runtime.py`

Dify 的关键模式是：`ProviderManager` 组装 provider 配置和 credential，`DifyCredentialsProvider` 只负责取当前模型凭证，`DifyModelFactory` / `ModelRuntime` 负责拿模型实例和 provider runtime。Openwork 对应拆成 `resolver.ts` 和 `sdk.ts`，避免把 provider 推断、密钥读取和 SDK 构造继续混在 `get-chat-model.ts`。

## Openwork 当前实现路径

Main 层：

- `src/main/model-provider/catalog.ts`：provider/model catalog。
- `src/main/model-provider/settings.ts`：默认模型等非敏感配置。
- `src/main/model-provider/secrets.ts`：provider API key，只代理安全存储。
- `src/main/model-provider/resolver.ts`：把 modelId 解析成 provider/model/credential runtime config。
- `src/main/model-provider/sdk.ts`：各家模型 SDK adapter，当前接入 Anthropic、OpenAI、DashScope、Google。
- `src/main/model-provider/service.ts`：供 IPC 暴露给 renderer 的 read/write service，包括全量模型列表和 provider 级模型列表。

模型身份边界在 `catalog.ts` 收口：`toProviderModelId()` 生成持久化 ID，`parseProviderModelId()` 解析运行时 provider 和真实模型名。这样远程 models list 返回的新模型也能保留 provider 归属，不需要通过 `gpt`、`claude`、`gemini` 这类前缀做兼容推断。

保存 provider API key 时会先调用真实 provider models list 做 credential 校验，校验成功后才写入 `safeStorage`。这对应 Dify 保存 provider credential 前先走 provider runtime 校验的语义；校验失败直接把 provider 级错误返回给设置页，不落本地 secret。

Renderer 层：

- `src/renderer/src/features/model-provider/model-provider-page/index.tsx`
- `src/renderer/src/features/model-provider/model-provider-page/declarations.ts`
- `src/renderer/src/features/model-provider/model-provider-page/hooks.ts`
- `src/renderer/src/features/model-provider/model-provider-page/provider-added-card/index.tsx`
- `src/renderer/src/features/model-provider/model-provider-page/provider-added-card/credential-panel.tsx`
- `src/renderer/src/features/model-provider/model-provider-page/provider-added-card/model-list.tsx`
- `src/renderer/src/features/model-provider/model-provider-page/system-model-selector/index.tsx`

`src/renderer/src/settings/ProviderTab.tsx` 现在只是 feature host，负责从 IPC 拉 `providers/models/defaultModel`，以及承接 settings deep-link 后打开对应 provider 的 credential dialog。真正的页面结构放在 `features/model-provider/model-provider-page`，对齐 Dify 的 feature 目录，而不是继续在 settings tab 内部写自定义布局。

Provider 级模型读取对齐 Dify 的：

- `/workspaces/current/model-providers/{provider}/models`

Openwork 对应 IPC 是：

- `models:getState`
- `models:listByProvider`

`models:getState` 一次返回 `providers + models`，用于 provider 设置页和 model switcher 保持同一份状态。`ProviderAddedCard` 展开模型列表时调用 provider 级接口。全局 `models:list` 也使用同一套远程读取逻辑聚合所有 provider，避免 model switcher 和 provider page 的模型来源不一致。

有 provider API key 时，`models:listByProvider` 会调供应商真实 models list：

- `openai`：`GET https://api.openai.com/v1/models`
- `anthropic`：`GET https://api.anthropic.com/v1/models`
- `google`：`GET https://generativelanguage.googleapis.com/v1beta/models`
- `dashscope`：`GET https://dashscope.aliyuncs.com/compatible-mode/v1/models`

没有 provider API key 时，才返回本地预定义 catalog，并标记为不可用，语义对应 Dify 的 `no_configure` 状态。有 key 但远程接口失败时，provider 状态会变成 `error` 并展示具体 provider 错误，不回退到本地 catalog；直接调用 `models:listByProvider` 时仍然抛真实错误。

## SDK 对接边界

Openwork 当前 SDK adapter 在 `src/main/model-provider/sdk.ts`：

- `anthropic` -> `ChatAnthropic`
- `openai` -> `ChatOpenAI`
- `dashscope` -> `ChatOpenAI` + DashScope OpenAI-compatible `baseURL`
- `google` -> `ChatGoogleGenerativeAI`

`src/main/llm/get-chat-model.ts` 不再知道各家 SDK 细节，只做：

1. 调 `resolveModelRuntimeConfig` 拿 runtime config。
2. 调 `createProviderChatModel` 创建具体 SDK client。

这个边界对应 Dify 的 `model_access.py`：先拿 credential 和 provider/model bundle，再交给 runtime/model factory。
