import { defineLocalizedText as l, defineNativeExtensionManifest } from "@jingle/extension-api"

export const imageGenerationManifest = defineNativeExtensionManifest({
  aiCapability: {
    connectionId: "default",
    description: "Generate and edit images from natural language prompts.",
    guide:
      "Use this capability when the user asks to generate or edit raster images. Successful image generation or edit results are automatically presented in Artifacts.",
    id: "image",
    instructions: [
      "Use Image Generation for raster image generation and image editing requests.",
      "If the Image Generation API key is missing, tell the user to configure it in Settings before generating images.",
      "For a new image, call generateImage with the user's visual prompt.",
      "For edits, call editImage with the user's edit instruction and one or more local reference image paths.",
      "Do not claim an image was created unless the tool returned at least one output path."
    ],
    mention: {
      label: l("Image Generation", "生图"),
      value: "image"
    },
    permissionMode: "auto",
    title: l("Image Generation", "生图"),
    toolDisplays: {
      editImage: {
        description: l("Edit images with a natural language instruction.", "用自然语言指令编辑图片。"),
        title: l("Edit Image", "编辑图片")
      },
      generateImage: {
        description: l("Generate images from a natural language prompt.", "根据自然语言提示生成图片。"),
        title: l("Generate Image", "生成图片")
      }
    },
    toolNames: ["generateImage", "editImage"]
  },
  capabilities: [],
  commands: [],
  connection: {
    auth: {
      secretNames: ["apiKey"],
      type: "apiKey"
    },
    connectGuide:
      "Configure an OpenAI-compatible image generation API key in Jingle Settings. Jingle stores the key locally and passes it to the Image Generation extension at runtime.",
    id: "default",
    provider: "image-generation",
    publicPreferenceNames: ["baseUrl"],
    title: l("Image Generation", "生图")
  },
  description: l("Generate and edit images from AI chat.", "在 AI 对话中生成和编辑图片。"),
  icon: "assets/icon.svg",
  iconName: "image",
  name: "image-generation",
  preferences: [
    {
      default: "https://www.xiongxiongai.online",
      description: l(
        "OpenAI-compatible image API base URL.",
        "OpenAI 兼容生图 API 的 Base URL。"
      ),
      name: "baseUrl",
      placeholder: "https://www.xiongxiongai.online",
      required: false,
      title: l("Base URL", "Base URL"),
      type: "text"
    }
  ],
  title: l("Image Generation", "生图")
})
