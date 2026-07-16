import { artifactRendererCommands } from "@/lib/artifact-renderer-commands"
import { chatRendererCommands } from "../chat-renderer-commands"
import type { ToolRendererCommands } from "./types"

export const toolRendererCommands: ToolRendererCommands = {
  openArtifact: artifactRendererCommands.openArtifact,
  openExternal: chatRendererCommands.openExternal
}
