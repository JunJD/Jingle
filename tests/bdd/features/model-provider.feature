# language: zh-CN
@model-provider
功能: 模型供应商列表状态
  为了避免用户在聊天中选到不可用模型
  作为 Openwork 用户
  我需要供应商列表状态和全局模型列表都来自 main 层确认过的远程结果

  场景: 远程模型列表失败后错误状态不会被刷新冲掉
    假如 OpenAI 模型供应商已保存有效密钥
    而且 OpenAI 远程模型接口将失败并返回 "401 Unauthorized"
    当 系统刷新 OpenAI 的远程模型列表
    那么 OpenAI 模型列表状态应为 "error"
    而且 OpenAI 模型列表错误应包含 "401 Unauthorized"
    当 系统重新读取模型供应商状态
    那么 OpenAI 模型列表状态应为 "error"
    而且 OpenAI 模型列表错误应包含 "401 Unauthorized"

  场景: 全局模型列表使用供应商真实返回的模型
    假如 OpenAI 模型供应商已保存有效密钥
    而且 OpenAI 远程模型接口返回模型:
      | 模型              |
      | gpt-business-only |
    当 系统刷新 OpenAI 的远程模型列表
    并且 系统读取全局可用模型列表
    那么 全局可用模型应包含 "openai:gpt-business-only"
    而且 全局可用模型不应包含 "openai:gpt-5.2"
