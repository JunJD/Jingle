import type { CustomProviderConfig } from "./types"

export const DECLARATIVE_PROVIDER_CONFIGS = [
  {
    api_key_env: "DASHSCOPE_API_KEY",
    base_path: null,
    base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    description: "Alibaba Qwen models via DashScope's OpenAI-compatible API.",
    display_name: "Alibaba (Qwen)",
    dynamic_models: true,
    engine: "openai",
    model_doc_link: "https://www.alibabacloud.com/help/en/model-studio/models",
    models: [
      {
        context_limit: 262144,
        name: "qwen3.7-max"
      },
      {
        context_limit: 262144,
        name: "qwen3.7-max-preview"
      },
      {
        context_limit: 262144,
        name: "qwen3.6-max-preview"
      },
      {
        context_limit: 1000000,
        name: "qwen3.6-plus"
      },
      {
        context_limit: 262144,
        name: "qwen3-max"
      },
      {
        context_limit: 1000000,
        name: "qwen-plus"
      },
      {
        context_limit: 1000000,
        name: "qwen-turbo"
      },
      {
        context_limit: 1000000,
        name: "qwen-flash"
      },
      {
        context_limit: 1048576,
        name: "qwen3-coder-plus"
      },
      {
        context_limit: 1000000,
        name: "qwen3-coder-flash"
      }
    ],
    name: "alibaba",
    requires_auth: true,
    setup_steps: [
      "Sign in to https://modelstudio.console.alibabacloud.com (international) or https://bailian.console.aliyun.com (China)",
      "Open API Keys in the left sidebar and create a new key",
      "Copy the key and paste it above"
    ],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    base_path: null,
    base_url: "${ATOMIC_CHAT_HOST}/v1/chat/completions",
    description: "Local models through Atomic Chat’s OpenAI-compatible server",
    display_name: "Atomic Chat",
    dynamic_models: true,
    engine: "openai",
    env_vars: [
      {
        default: "http://localhost:1337",
        description: "Base URL of the Atomic Chat server (default: http://localhost:1337)",
        name: "ATOMIC_CHAT_HOST",
        primary: true,
        required: false,
        secret: false
      }
    ],
    models: [],
    name: "atomic_chat",
    requires_auth: false,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "CEREBRAS_API_KEY",
    base_path: null,
    base_url: "https://api.cerebras.ai/v1/chat/completions",
    description: "Fast inference on Cerebras wafer-scale engines",
    display_name: "Cerebras",
    engine: "openai",
    models: [
      {
        context_limit: 131072,
        name: "llama3.1-8b"
      },
      {
        context_limit: 131072,
        name: "gpt-oss-120b"
      },
      {
        context_limit: 131072,
        name: "qwen-3-235b-a22b-instruct-2507"
      },
      {
        context_limit: 131072,
        name: "zai-glm-4.7"
      }
    ],
    name: "cerebras",
    requires_auth: true,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "DEEPSEEK_API_KEY",
    base_path: null,
    base_url: "https://api.deepseek.com",
    description: "Custom DeepSeek provider",
    display_name: "DeepSeek",
    engine: "openai",
    models: [
      {
        context_limit: 128000,
        name: "deepseek-chat"
      },
      {
        context_limit: 128000,
        name: "deepseek-reasoner"
      }
    ],
    name: "custom_deepseek",
    requires_auth: true,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "FUTURMIX_API_KEY",
    base_path: null,
    base_url: "https://futurmix.ai/v1/chat/completions",
    description:
      "Unified AI gateway with OpenAI-compatible API supporting models from Anthropic, Google, and OpenAI",
    display_name: "FuturMix",
    engine: "openai",
    models: [
      {
        context_limit: 200000,
        name: "claude-sonnet-4-20250514"
      },
      {
        context_limit: 128000,
        name: "gpt-4o"
      },
      {
        context_limit: 1048576,
        name: "gemini-2.5-pro"
      },
      {
        context_limit: 131072,
        name: "deepseek-chat"
      },
      {
        context_limit: 200000,
        name: "claude-haiku-4-20250514"
      }
    ],
    name: "futurmix",
    requires_auth: true,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "GROQ_API_KEY",
    base_path: null,
    base_url: "https://api.groq.com/openai/v1/chat/completions",
    description: "Fast inference with Groq hardware",
    display_name: "Groq (d)",
    engine: "openai",
    models: [
      {
        context_limit: 262144,
        name: "moonshotai/kimi-k2-instruct-0905"
      },
      {
        context_limit: 131072,
        name: "openai/gpt-oss-120b"
      },
      {
        context_limit: 131072,
        name: "openai/gpt-oss-20b"
      },
      {
        context_limit: 131072,
        name: "meta-llama/llama-4-maverick-17b-128e-instruct"
      },
      {
        context_limit: 131072,
        name: "meta-llama/llama-4-scout-17b-16e-instruct"
      },
      {
        context_limit: 131072,
        name: "qwen/qwen3-32b"
      },
      {
        context_limit: 131072,
        name: "llama-3.3-70b-versatile"
      },
      {
        context_limit: 131072,
        name: "llama-3.1-8b-instant"
      },
      {
        context_limit: 131072,
        name: "openai/gpt-oss-safeguard-20b"
      },
      {
        context_limit: 131072,
        name: "meta-llama/llama-guard-4-12b"
      }
    ],
    name: "groq",
    requires_auth: true,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "INCEPTION_API_KEY",
    base_path: null,
    base_url: "https://api.inceptionlabs.ai",
    description: "Mercury models from Inception leveraging diffusion for lightning speeds",
    display_name: "Inception",
    engine: "openai",
    models: [
      {
        context_limit: 128000,
        name: "mercury-coder"
      }
    ],
    name: "inception",
    requires_auth: true,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "LLAMA_SWAP_API_KEY",
    base_path: null,
    base_url: "${LLAMA_SWAP_HOST}/v1/chat/completions",
    description:
      "Local proxy that hot-swaps llama.cpp (and other) inference backends on demand via an OpenAI-compatible API.",
    display_name: "Llama Swap",
    dynamic_models: true,
    engine: "openai",
    env_vars: [
      {
        default: "http://localhost:8080",
        description: "Base URL of the llama-swap proxy (default: http://localhost:8080)",
        name: "LLAMA_SWAP_HOST",
        primary: true,
        required: false,
        secret: false
      }
    ],
    models: [],
    name: "llama_swap",
    requires_auth: false,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "LMSTUDIO_API_KEY",
    base_path: null,
    base_url: "${LMSTUDIO_HOST}/v1/chat/completions",
    description: "Run local models with LM Studio",
    display_name: "LM Studio",
    dynamic_models: true,
    engine: "openai",
    env_vars: [
      {
        default: "http://localhost:1234",
        description: "Base URL of the LMStudio server (default: http://localhost:1234)",
        name: "LMSTUDIO_HOST",
        primary: true,
        required: false,
        secret: false
      }
    ],
    models: [],
    name: "lmstudio",
    requires_auth: false,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "MINIMAX_API_KEY",
    base_path: null,
    base_url: "https://api.minimax.io/anthropic",
    description: "MiniMax AI models with long context support via Anthropic-compatible API",
    display_name: "MiniMax",
    engine: "anthropic",
    models: [
      {
        context_limit: 204800,
        name: "MiniMax-M2.5"
      },
      {
        context_limit: 204800,
        name: "MiniMax-M2.5-highspeed"
      }
    ],
    name: "minimax",
    requires_auth: true,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "MISTRAL_API_KEY",
    base_path: null,
    base_url: "https://api.mistral.ai/v1/chat/completions",
    description: "Frontier models from Mistral AI",
    display_name: "Mistral AI",
    engine: "openai",
    models: [
      {
        context_limit: 128000,
        name: "mistral-medium-latest"
      },
      {
        context_limit: 128000,
        name: "mistral-small-2506"
      },
      {
        context_limit: 128000,
        name: "mistral-medium-2508"
      },
      {
        context_limit: 128000,
        name: "magistral-medium-2509"
      },
      {
        context_limit: 256000,
        name: "codestral-2508"
      },
      {
        context_limit: 262144,
        name: "devstral-2512"
      },
      {
        context_limit: 262144,
        name: "devstral-small-2505"
      },
      {
        context_limit: 128000,
        name: "pixtral-large-2411"
      },
      {
        context_limit: 128000,
        name: "ministral-8b-2410"
      },
      {
        context_limit: 128000,
        name: "mistral-medium-2505"
      },
      {
        context_limit: 128000,
        name: "ministral-3b-2410"
      }
    ],
    name: "mistral",
    requires_auth: true,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "MOONSHOT_API_KEY",
    base_path: null,
    base_url: "https://api.moonshot.cn/v1/chat/completions",
    description: "Moonshot AI (Kimi) models",
    display_name: "Moonshot",
    engine: "openai",
    models: [
      {
        context_limit: 131072,
        name: "kimi-latest"
      },
      {
        context_limit: 131072,
        name: "kimi-thinking-preview"
      },
      {
        context_limit: 131072,
        name: "kimi-k2-0711"
      },
      {
        context_limit: 262144,
        name: "kimi-k2"
      },
      {
        context_limit: 8192,
        name: "moonshot-v1-8k"
      },
      {
        context_limit: 32768,
        name: "moonshot-v1-32k"
      }
    ],
    name: "moonshot",
    requires_auth: true,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "NEARAI_API_KEY",
    base_path: null,
    base_url: "https://cloud-api.near.ai/v1",
    description: "TEE-backed private inference through NEAR AI Cloud's OpenAI-compatible API.",
    display_name: "NEAR AI Cloud",
    dynamic_models: true,
    engine: "openai",
    model_doc_link: "https://docs.near.ai/",
    models: [
      {
        context_limit: 202752,
        name: "zai-org/GLM-5.1-FP8",
        reasoning: true
      },
      {
        context_limit: 262144,
        name: "Qwen/Qwen3.6-35B-A3B-FP8",
        reasoning: true
      },
      {
        context_limit: 131072,
        name: "Qwen/Qwen3.5-122B-A10B",
        reasoning: true
      },
      {
        context_limit: 256000,
        name: "Qwen/Qwen3-VL-30B-A3B-Instruct"
      },
      {
        context_limit: 262144,
        name: "google/gemma-4-31B-it"
      }
    ],
    name: "nearai",
    requires_auth: true,
    setup_steps: [
      "Create or sign in to your NEAR AI Cloud account at https://cloud.near.ai",
      "Create an API key",
      "Copy the key and paste it above"
    ],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "NOVITA_API_KEY",
    base_path: null,
    base_url: "https://api.novita.ai/openai/chat/completions",
    description: "90+ open-source models with OpenAI-compatible API and competitive pricing",
    display_name: "Novita AI",
    engine: "openai",
    models: [
      {
        context_limit: 262144,
        name: "moonshotai/kimi-k2.5"
      },
      {
        context_limit: 204800,
        name: "minimax/minimax-m2.7"
      },
      {
        context_limit: 204800,
        name: "zai-org/glm-5.1"
      },
      {
        context_limit: 163840,
        name: "deepseek/deepseek-v3.2"
      },
      {
        context_limit: 262144,
        name: "google/gemma-4-31b-it"
      }
    ],
    name: "novita",
    requires_auth: true,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "NVIDIA_API_KEY",
    base_path: null,
    base_url: "https://integrate.api.nvidia.com/v1",
    description: "Hosted NVIDIA NIM models through the OpenAI-compatible API.",
    display_name: "NVIDIA",
    dynamic_models: true,
    engine: "openai",
    model_doc_link: "https://build.nvidia.com/models",
    models: [
      {
        context_limit: 131072,
        name: "z-ai/glm-4.7"
      }
    ],
    name: "nvidia",
    requires_auth: true,
    setup_steps: [
      "Sign in to https://build.nvidia.com",
      "Choose a Free Endpoint model from the model catalog",
      "Create an API key",
      "Copy the key and paste it above"
    ],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "OLLAMA_CLOUD_API_KEY",
    base_path: null,
    base_url: "https://ollama.com/v1/chat/completions",
    description: "Access hosted models on ollama.com via OpenAI-compatible API",
    display_name: "Ollama Cloud",
    dynamic_models: true,
    engine: "openai",
    models: [],
    name: "ollama_cloud",
    requires_auth: true,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "OMLX_API_KEY",
    base_path: null,
    base_url: "${OMLX_HOST}/v1/chat/completions",
    description: "Run local models with oMLX",
    display_name: "oMLX",
    dynamic_models: true,
    engine: "openai",
    env_vars: [
      {
        default: "http://localhost:8000",
        description: "Base URL of the oMLX server (default: http://localhost:8000)",
        name: "OMLX_HOST",
        primary: true,
        required: false,
        secret: false
      }
    ],
    models: [],
    name: "omlx",
    requires_auth: false,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "OPENCODE_API_KEY",
    base_path: null,
    base_url: "https://opencode.ai/zen/go/v1",
    description: "OpenCode Go models via OpenAI-compatible API.",
    display_name: "OpenCode Go",
    dynamic_models: true,
    engine: "openai",
    model_doc_link: "https://opencode.ai/docs/zen",
    models: [
      {
        context_limit: 262144,
        name: "kimi-k2.6"
      },
      {
        context_limit: 262144,
        name: "kimi-k2.5"
      },
      {
        context_limit: 1000000,
        name: "deepseek-v4-flash"
      },
      {
        context_limit: 1000000,
        name: "deepseek-v4-pro"
      },
      {
        context_limit: 204800,
        name: "glm-5.1"
      },
      {
        context_limit: 204800,
        name: "glm-5"
      },
      {
        context_limit: 1048576,
        name: "mimo-v2.5-pro"
      },
      {
        context_limit: 262144,
        name: "mimo-v2.5"
      },
      {
        context_limit: 1048576,
        name: "mimo-v2-pro"
      },
      {
        context_limit: 262144,
        name: "mimo-v2-omni"
      },
      {
        context_limit: 204800,
        name: "minimax-m2.7"
      },
      {
        context_limit: 204800,
        name: "minimax-m2.5"
      },
      {
        context_limit: 262144,
        name: "qwen3.6-plus"
      },
      {
        context_limit: 262144,
        name: "qwen3.5-plus"
      }
    ],
    name: "opencode_go",
    requires_auth: true,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "OVHCLOUD_API_KEY",
    base_path: null,
    base_url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
    description:
      "OVHcloud AI-Endpoints is a European cloud provider that offers open-source models",
    display_name: "OVHcloud",
    engine: "openai",
    models: [
      {
        context_limit: 32768,
        name: "Qwen3-32B"
      },
      {
        context_limit: 32768,
        name: "Qwen2.5-VL-72B-Instruct"
      },
      {
        context_limit: 262144,
        name: "Qwen3-Coder-30B-A3B-Instruct"
      },
      {
        context_limit: 65536,
        name: "Mistral-Nemo-Instruct-2407"
      },
      {
        context_limit: 131072,
        name: "gpt-oss-120b"
      },
      {
        context_limit: 131072,
        name: "Meta-Llama-3_1-70B-Instruct"
      },
      {
        context_limit: 131072,
        name: "Llama-3.1-8B-Instruct"
      },
      {
        context_limit: 32768,
        name: "Qwen2.5-Coder-32B-Instruct"
      },
      {
        context_limit: 131072,
        name: "DeepSeek-R1-Distill-Llama-70B"
      },
      {
        context_limit: 131072,
        name: "Meta-Llama-3_3-70B-Instruct"
      },
      {
        context_limit: 32768,
        name: "llava-next-mistral-7b"
      },
      {
        context_limit: 131072,
        name: "Mistral-Small-3.2-24B-Instruct-2506"
      },
      {
        context_limit: 65536,
        name: "Mistral-7B-Instruct-v0.3"
      },
      {
        context_limit: 32768,
        name: "Mixtral-8x7B-Instruct-v0.1"
      },
      {
        context_limit: 131072,
        name: "gpt-oss-20b"
      },
      {
        context_limit: 8192,
        name: "bge-m3"
      },
      {
        context_limit: 512,
        name: "bge-base-en-v1.5"
      },
      {
        context_limit: 8192,
        name: "bge-multilingual-gemma2"
      }
    ],
    name: "ovhcloud",
    requires_auth: true,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "PERPLEXITY_API_KEY",
    base_path: null,
    base_url: "https://api.perplexity.ai",
    description: "Chat models with built-in real-time web search grounding",
    display_name: "Perplexity",
    engine: "openai",
    model_doc_link: "https://docs.perplexity.ai/docs/getting-started",
    models: [
      {
        context_limit: 128000,
        name: "sonar"
      },
      {
        context_limit: 128000,
        name: "sonar-pro"
      },
      {
        context_limit: 128000,
        name: "sonar-reasoning"
      },
      {
        context_limit: 128000,
        name: "sonar-reasoning-pro"
      }
    ],
    name: "perplexity",
    requires_auth: true,
    setup_steps: [
      "Go to https://www.perplexity.ai/account/api/keys",
      "Create or copy an existing API key",
      "Paste the key above as PERPLEXITY_API_KEY"
    ],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "ROUTSTR_API_KEY",
    base_path: null,
    base_url: "${ROUTSTR_HOST}/v1",
    description:
      "OpenAI-compatible aggregator that fronts dozens of upstream providers (OpenAI, Anthropic, Google, DeepSeek, Llama, …) behind a single API. Authenticate with an sk-... bearer issued by a Routstr instance — payment (e.g. Cashu top-up) is handled outside goose.",
    display_name: "Routstr",
    dynamic_models: true,
    engine: "openai",
    env_vars: [
      {
        default: "https://api.routstr.com",
        description: "Base URL of the Routstr proxy (default: https://api.routstr.com)",
        name: "ROUTSTR_HOST",
        primary: true,
        required: false,
        secret: false
      }
    ],
    model_doc_link: "https://routstr.com/docs",
    models: [
      {
        context_limit: 1000000,
        name: "claude-opus-4.7"
      },
      {
        context_limit: 1048576,
        name: "gemini-3.1-pro-preview"
      },
      {
        context_limit: 1048576,
        name: "gemini-3-flash-preview"
      },
      {
        context_limit: 1048576,
        name: "deepseek-v4-pro"
      },
      {
        context_limit: 202752,
        name: "glm-5.1"
      },
      {
        context_limit: 196608,
        name: "minimax-m2.7"
      }
    ],
    name: "routstr",
    requires_auth: true,
    setup_steps: [
      "Pick a Routstr instance (e.g. https://api.routstr.com) and obtain an sk-... API key from its payment flow.",
      "Paste the key above as ROUTSTR_API_KEY.",
      "Optionally override ROUTSTR_HOST to point at a different Routstr proxy."
    ],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "SALAD_CLOUD_API_KEY",
    base_path: null,
    base_url: "https://ai.salad.cloud/v1/chat/completions",
    description: "OpenAI-compatible access to SaladCloud-hosted Qwen and Gemma models",
    display_name: "SaladCloud AI Gateway",
    dynamic_models: true,
    engine: "openai",
    model_doc_link: "https://docs.salad.com/ai-gateway/explanation/overview",
    models: [
      {
        context_limit: 262144,
        name: "qwen3.6-35b-a3b"
      },
      {
        context_limit: 262144,
        name: "qwen3.6-27b"
      },
      {
        context_limit: 262144,
        name: "qwen3.5-9b"
      },
      {
        context_limit: 262144,
        name: "gemma-4-26b-a4b-instruct"
      }
    ],
    name: "saladcloud",
    requires_auth: true,
    setup_steps: [
      "Register at portal.salad.com and enable access to the AI Gateway.",
      "Copy your API key from https://portal.salad.com/api-key and paste it above as SALAD_CLOUD_API_KEY.",
      "Select a supported model such as qwen3.6-35b-a3b."
    ],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "SCW_SECRET_KEY",
    base_path: null,
    base_url: "https://api.scaleway.ai/v1/chat/completions",
    description:
      "Scaleway Generative APIs - European cloud provider offering open-source AI models",
    display_name: "Scaleway",
    engine: "openai",
    models: [
      {
        context_limit: 256000,
        name: "qwen/qwen3.5-397b-a17b"
      },
      {
        context_limit: 256000,
        name: "qwen/qwen3.6-35b-a3b"
      },
      {
        context_limit: 256000,
        name: "qwen/qwen3-235b-a22b-instruct-2507"
      },
      {
        context_limit: 128000,
        name: "qwen/qwen3-coder-30b-a3b-instruct"
      },
      {
        context_limit: 128000,
        name: "meta/llama-3.3-70b-instruct"
      },
      {
        context_limit: 256000,
        name: "mistralai/mistral-medium-2505"
      },
      {
        context_limit: 200000,
        name: "mistralai/devstral-2-123b-instruct-2512"
      },
      {
        context_limit: 128000,
        name: "mistralai/mistral-small-3.2-24b-instruct-2506"
      },
      {
        context_limit: 32000,
        name: "mistralai/voxtral-small-24b-2507"
      },
      {
        context_limit: 128000,
        name: "mistralai/pixtral-12b-2409"
      },
      {
        context_limit: 256000,
        name: "google/gemma-4-26b-a4b-it"
      },
      {
        context_limit: 40000,
        name: "google/gemma-3-27b-it"
      },
      {
        context_limit: 22000,
        name: "hcompany/holo2-30b-a3b"
      },
      {
        context_limit: 128000,
        name: "openai/gpt-oss-120b"
      }
    ],
    name: "scaleway",
    requires_auth: true,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "TANZU_AI_API_KEY",
    base_path: null,
    base_url: "${TANZU_AI_ENDPOINT}/openai/v1/chat/completions",
    description: "Enterprise-managed LLM access through AI Services on VMware Tanzu Platform.",
    display_name: "VMware Tanzu Platform",
    dynamic_models: true,
    engine: "openai",
    env_vars: [
      {
        description: "Your VMware Tanzu Platform AI Services endpoint URL",
        name: "TANZU_AI_ENDPOINT",
        required: true,
        secret: false
      },
      {
        default: "true",
        description: "Enable streaming responses (true/false)",
        name: "TANZU_AI_STREAMING",
        primary: true,
        required: false,
        secret: false
      }
    ],
    models: [
      {
        context_limit: 131072,
        name: "openai/gpt-oss-120b"
      }
    ],
    name: "tanzu_ai",
    requires_auth: true,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "TENSORIX_API_KEY",
    base_path: null,
    base_url: "https://api.tensorix.ai/v1",
    description: "50+ open-source models with EU-hosted inference and zero data retention",
    display_name: "Tensorix",
    engine: "openai",
    models: [
      {
        context_limit: 203000,
        name: "z-ai/glm-5"
      },
      {
        context_limit: 164000,
        name: "deepseek/deepseek-chat-v3.1"
      },
      {
        context_limit: 164000,
        name: "deepseek/deepseek-r1-0528"
      },
      {
        context_limit: 197000,
        name: "minimax/minimax-m2.5"
      },
      {
        context_limit: 262000,
        name: "moonshotai/kimi-k2.5"
      }
    ],
    name: "custom_tensorix",
    requires_auth: true,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "VENICE_API_KEY",
    base_path: null,
    base_url: "https://api.venice.ai/api/v1/chat/completions",
    description: "Venice.ai models (Llama, DeepSeek, Mistral) with function calling",
    display_name: "Venice.ai",
    dynamic_models: true,
    engine: "openai",
    model_doc_link: "https://docs.venice.ai/",
    models: [
      {
        context_limit: 131072,
        name: "llama-3.3-70b"
      },
      {
        context_limit: 131072,
        name: "llama-3.2-3b"
      },
      {
        context_limit: 131072,
        name: "mistral-31-24b"
      }
    ],
    name: "venice",
    requires_auth: true,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "AI_GATEWAY_API_KEY",
    base_path: null,
    base_url: "https://ai-gateway.vercel.sh/v1/chat/completions",
    description:
      "Unified gateway to OpenAI, Anthropic, Google, xAI, and many more frontier models via Vercel AI Gateway",
    display_name: "Vercel AI Gateway",
    engine: "openai",
    headers: {
      "http-referer": "https://goose-docs.ai",
      "x-title": "goose"
    },
    models: [
      {
        context_limit: 1000000,
        name: "anthropic/claude-sonnet-4.6"
      },
      {
        context_limit: 1000000,
        name: "anthropic/claude-sonnet-4.5"
      },
      {
        context_limit: 1000000,
        name: "anthropic/claude-opus-4.6"
      },
      {
        context_limit: 200000,
        name: "anthropic/claude-opus-4.5"
      },
      {
        context_limit: 200000,
        name: "anthropic/claude-haiku-4.5"
      },
      {
        context_limit: 400000,
        name: "openai/gpt-5"
      },
      {
        context_limit: 400000,
        name: "openai/gpt-5-codex"
      },
      {
        context_limit: 400000,
        name: "openai/gpt-5-mini"
      },
      {
        context_limit: 400000,
        name: "openai/gpt-5.1-codex"
      },
      {
        context_limit: 1047576,
        name: "openai/gpt-4.1"
      },
      {
        context_limit: 128000,
        name: "openai/gpt-4o"
      },
      {
        context_limit: 200000,
        name: "openai/o3"
      },
      {
        context_limit: 200000,
        name: "openai/o4-mini"
      },
      {
        context_limit: 1000000,
        name: "google/gemini-3-pro-preview"
      },
      {
        context_limit: 1048576,
        name: "google/gemini-2.5-pro"
      },
      {
        context_limit: 1000000,
        name: "google/gemini-2.5-flash"
      },
      {
        context_limit: 256000,
        name: "xai/grok-4"
      },
      {
        context_limit: 2000000,
        name: "xai/grok-4-fast-reasoning"
      },
      {
        context_limit: 256000,
        name: "xai/grok-code-fast-1"
      },
      {
        context_limit: 163840,
        name: "deepseek/deepseek-v3.1"
      },
      {
        context_limit: 262114,
        name: "moonshotai/kimi-k2-thinking"
      },
      {
        context_limit: 200000,
        name: "zai/glm-4.6"
      }
    ],
    name: "vercel_ai_gateway",
    requires_auth: true,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "ZHIPU_API_KEY",
    base_path: null,
    base_url: "${ZAI_BASE_URL}",
    description: "Z.AI GLM models via Anthropic-compatible API.",
    display_name: "Z.AI",
    engine: "anthropic",
    env_vars: [
      {
        default: "https://api.z.ai/api/anthropic",
        description: "Z.AI Anthropic-compatible API base URL.",
        name: "ZAI_BASE_URL",
        required: false,
        secret: false
      }
    ],
    model_doc_link: "https://docs.z.ai/devpack/tool/goose",
    models: [
      {
        context_limit: 200000,
        name: "glm-5.1"
      },
      {
        context_limit: 204800,
        name: "glm-5"
      },
      {
        context_limit: 200000,
        name: "glm-5-turbo"
      },
      {
        context_limit: 204800,
        name: "glm-4.7"
      },
      {
        context_limit: 200000,
        name: "glm-4.7-flash"
      },
      {
        context_limit: 200000,
        name: "glm-4.7-flashx"
      },
      {
        context_limit: 204800,
        name: "glm-4.6"
      },
      {
        context_limit: 131072,
        name: "glm-4.5"
      },
      {
        context_limit: 131072,
        name: "glm-4.5-air"
      },
      {
        context_limit: 131072,
        name: "glm-4.5-flash"
      }
    ],
    name: "zai",
    requires_auth: true,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  },
  {
    api_key_env: "ZHIPU_API_KEY",
    base_path: null,
    base_url: "${ZHIPU_BASE_URL}",
    description:
      "Zhipu AI GLM models. Set ZHIPU_BASE_URL to override the default endpoint (e.g. https://open.bigmodel.cn/api/coding/paas/v4 for Coding Plan models).",
    display_name: "Zhipu AI",
    dynamic_models: true,
    engine: "openai",
    env_vars: [
      {
        default: "https://open.bigmodel.cn/api/paas/v4",
        description:
          "Zhipu API base URL. Change to https://open.bigmodel.cn/api/coding/paas/v4 for Coding Plan models like GLM-5.1.",
        name: "ZHIPU_BASE_URL",
        required: false,
        secret: false
      }
    ],
    models: [
      {
        context_limit: 131072,
        name: "glm-4.5"
      },
      {
        context_limit: 131072,
        name: "glm-4.5-flash"
      },
      {
        context_limit: 204800,
        name: "glm-4.6"
      },
      {
        context_limit: 204800,
        name: "glm-4.7"
      },
      {
        context_limit: 200000,
        name: "glm-4.7-flash"
      },
      {
        context_limit: 204800,
        name: "glm-5"
      }
    ],
    name: "zhipu",
    requires_auth: true,
    setup_steps: [],
    supports_streaming: true,
    timeout_seconds: null
  }
] satisfies CustomProviderConfig[]
