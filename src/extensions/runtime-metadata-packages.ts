import { imageGenerationRuntimeMetadata } from "../../extensions/image-generation/runtime-metadata"
import { todoListRuntimeMetadata } from "./todo-list/runtime-metadata"
import { translateRuntimeMetadata } from "./translate/runtime-metadata"

export const nativeExtensionRuntimeMetadataPackages = [
  imageGenerationRuntimeMetadata,
  todoListRuntimeMetadata,
  translateRuntimeMetadata
]
