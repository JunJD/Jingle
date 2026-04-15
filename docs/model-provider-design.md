# Openwork Model Provider 实现说明

这次实现按一个边界落地：

- `main` 层负责 provider catalog、settings、secrets、runtime resolver、SDK adapter。
- `renderer` 层负责复用 Dify `model-provider-page` 的页面结构和交互组织。
- provider secret 只走 `secretsStore + safeStorage`，不再读写 `.env` 做兼容。
- 模型 ID 使用 `provider:model` 格式保存，例如 `dashscope:glm-4.6`；未识别的 model/provider 直接报错，不按模型名前缀猜 provider。
- 默认模型从单字符串改为 `defaultModels.llm`，当前只支持 `llm`。如果调用方传入 `text-embedding`、`rerank` 等类型，会直接报错，不做假实现。

## Dify 参考路径

Renderer 侧主要参考 Dify 的 provider feature：

- `/Users/junjieding/dingjunjie_dev/2026_03/dify/web/app/components/header/account-setting/model-provider-page/index.tsx`
- `/Users/junjieding/dingjunjie_dev/2026_03/dify/web/app/components/header/account-setting/model-provider-page/declarations.ts`
- `/Users/junjieding/dingjunjie_dev/2026_03/dify/web/app/components/header/account-setting/model-provider-page/provider-added-card/index.tsx`
- `/Users/junjieding/dingjunjie_dev/2026_03/dify/web/app/components/header/account-setting/model-provider-page/provider-added-card/credential-panel.tsx`
- `/Users/junjieding/dingjunjie_dev/2026_03/dify/web/app/components/header/account-setting/model-provider-page/provider-added-card/model-list.tsx`
- `/Users/junjieding/dingjunjie_dev/2026_03/dify/web/app/components/header/account-setting/model-provider-page/system-model-selector/index.tsx`

Runtime / SDK 侧主要参考 Dify 的职责切分，不照搬 Python 实现：

- `/Users/junjieding/dingjunjie_dev/2026_03/dify/api/services/entities/model_provider_entities.py`
- `/Users/junjieding/dingjunjie_dev/2026_03/dify/api/core/app/llm/model_access.py`
- `/Users/junjieding/dingjunjie_dev/2026_03/dify/api/core/provider_manager.py`
- `/Users/junjieding/dingjunjie_dev/2026_03/dify/api/core/plugin/impl/model_runtime.py`

Dify 的关键模式是：`ProviderResponse` 只表达 provider 能力、schema、custom/system configuration；models 是单独 endpoint；credential 表单由 schema 驱动；model 状态由 runtime/provider configuration 计算。`ProviderManager` 组装 provider 配置和 credential，`DifyCredentialsProvider` 只负责取当前模型凭证，`DifyModelFactory` / `ModelRuntime` 负责拿模型实例和 provider runtime。Openwork 对应拆成 `service.ts`、`resolver.ts`、`adapters.ts` 和 `sdk.ts`，避免把 provider 推断、密钥读取、远程 model list 和 SDK 构造继续混在调用方。

## Openwork 当前实现路径

Main 层：

- `src/main/model-provider/catalog.ts`：provider/model catalog。
- `src/main/model-provider/settings.ts`：默认模型等非敏感配置。
- `src/main/model-provider/secrets.ts`：通用 provider credential 安全存储代理，不表达 API key 业务语义。
- `src/main/model-provider/resolver.ts`：把 modelId 解析成 provider/model/credential runtime config。
- `src/main/model-provider/adapters.ts`：provider adapter，收口 credential 读写、真实 models list、credential 校验和具体 SDK client 创建。
- `src/main/model-provider/model-list-state.ts`：main 进程内保存 provider 最近一次远程 models list 结果和错误状态，供 `getState`、`models:list`、`models:listByProvider` 共用。
- `src/main/model-provider/sdk.ts`：薄转发层，把 runtime config 交给 provider adapter 创建 SDK client。
- `src/main/model-provider/service.ts`：供 IPC 暴露给 renderer 的 read/write service，只编排 adapter、catalog 和 settings。

模型身份边界在 `catalog.ts` 收口：`toProviderModelId()` 生成持久化 ID，`parseProviderModelId()` 解析运行时 provider 和真实模型名。这样远程 models list 返回的新模型也能保留 provider 归属，不需要通过 `gpt`、`claude`、`gemini` 这类前缀做兼容推断。

保存 provider credential 时会先调用真实 provider models list 做校验，校验成功后才写入 `safeStorage`。这对应 Dify 保存 provider credential 前先走 provider runtime 校验的语义；校验失败直接把 provider 级错误返回给设置页，不落本地 secret。

Renderer 层：

- `src/renderer/src/features/model-provider/model-provider-page/index.tsx`
- `src/renderer/src/features/model-provider/model-provider-page/declarations.ts`
- `src/renderer/src/features/model-provider/model-provider-page/hooks.ts`
- `src/renderer/src/features/model-provider/model-provider-page/provider-added-card/index.tsx`
- `src/renderer/src/features/model-provider/model-provider-page/provider-added-card/credential-panel.tsx`
- `src/renderer/src/features/model-provider/model-provider-page/provider-added-card/model-list.tsx`
- `src/renderer/src/features/model-provider/model-provider-page/system-model-selector/index.tsx`

`src/renderer/src/settings/ProviderTab.tsx` 现在只是 feature host，负责从 IPC 拉 `providers/defaultModels` 和单独的 `models:list`，以及承接 settings deep-link 后打开对应 provider 的 credential dialog。真正的页面结构放在 `features/model-provider/model-provider-page`，对齐 Dify 的 feature 目录，而不是继续在 settings tab 内部写自定义布局。

Provider 状态不再把 `hasApiKey` 当核心模型，而是对齐 Dify 的概念拆开：

- `customConfiguration.status`：provider credential 是否已配置。
- `providerCredentialSchema.credentialFormSchemas`：设置弹窗按 schema 渲染字段，当前各 provider 只有 `apiKey` 这个 `secret-input`。
- `supportedModelTypes`：当前只声明 `llm`。
- `modelListStatus` / `modelListError`：远程 models list 的状态和错误。
- `ModelConfig.modelType` / `fetchFrom` / `status`：模型本身的类型、来源和可用状态。

Provider 级模型读取对齐 Dify 的：

- `/workspaces/current/model-providers/{provider}/models`

Openwork 对应 IPC 是：

- `models:getState`
- `models:list(modelType)`
- `models:listByProvider`
- `models:getDefault(modelType)`
- `models:setDefault({ modelType, modelId })`
- `models:setCredentials({ provider, credentials })`
- `models:deleteCredentials(provider)`

`models:getState` 只返回 `providers + defaultModels`，对齐 Dify 的 `ProviderResponse` 边界，不把 models 塞进 provider state。这个接口只读 provider catalog、默认模型、provider credential 是否完整，以及 main 进程内最近一次 models list 状态；它不触发任何供应商远程请求，避免设置页首屏被外部网络阻塞。`models:list` 是独立 models endpoint：如果某个 provider 已经有成功的远程 models list，就返回 main 层确认过的远程模型；没有远程结果时才返回本地 catalog 快照。

有 provider API key 时，`models:listByProvider` 会调供应商真实 models list：

- `openai`：`GET https://api.openai.com/v1/models`
- `anthropic`：`GET https://api.anthropic.com/v1/models`
- `google`：`GET https://generativelanguage.googleapis.com/v1beta/models`
- `dashscope`：`GET https://dashscope.aliyuncs.com/compatible-mode/v1/models`

`models:listByProvider` 返回 `{ provider, models }`。没有 provider credential 时，它返回本地预定义 catalog，并标记为 `no-configure`，语义对应 Dify 的 `no_configure` 状态。有 credential 时才调用真实远程接口；远程接口成功时把远程模型写入 `model-list-state`，之后聊天侧 `models:list` 会消费这份真实列表。远程接口失败时由 main 层保存并返回 `provider.modelListStatus = "error"` 和真实 `modelListError`，不回退到本地 catalog，也不让前端猜 provider/model 状态。

## SDK 对接边界

Openwork 当前 provider adapter 在 `src/main/model-provider/adapters.ts`：

- `anthropic` -> `ChatAnthropic`
- `openai` -> `ChatOpenAI`
- `dashscope` -> `ChatOpenAI` + DashScope OpenAI-compatible `baseURL`
- `google` -> `ChatGoogleGenerativeAI`

`src/main/llm/get-chat-model.ts` 不再知道各家 SDK 细节，只做：

1. 调 `resolveModelRuntimeConfig` 拿 runtime config。
2. 调 `createProviderChatModel` 创建具体 SDK client。

这个边界对应 Dify 的 `model_access.py`：先拿 credential 和 provider/model bundle，再交给 runtime/model factory。
