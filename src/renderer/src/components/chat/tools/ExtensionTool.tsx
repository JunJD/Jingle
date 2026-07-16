import { Plug } from "lucide-react"
import { extensionToolCallUiSchema } from "@shared/tool-presentation"
import type { ToolCall } from "@/types"
import { ToolCodeBlock, ToolDetailStack, ToolDetailSection } from "./shared-components"
import { createToolComponentDefinition } from "./registry-core"

function parseExtensionToolCallUi(toolCall: ToolCall) {
  return extensionToolCallUiSchema.parse({
    display: toolCall.display,
    presentation: toolCall.presentation
  })
}

export const extensionToolComponent = createToolComponentDefinition({
  name: "extension",
  icon: Plug,
  project({ rawArgs, rawResult, toolCall }) {
    return {
      rawArgs,
      rawResult,
      ui: parseExtensionToolCallUi(toolCall)
    }
  },
  hasDetail({ viewModel }) {
    return Boolean(viewModel.ui.display.description || viewModel.rawArgs || viewModel.rawResult)
  },
  renderDisplay({ viewModel }) {
    return {
      detail: viewModel.ui.presentation.capabilityDisplayName,
      title: viewModel.ui.display.title
    }
  },
  renderDetail({ copy, viewModel }) {
    return (
      <ToolDetailStack>
        <ToolDetailSection label={viewModel.ui.presentation.capabilityTitle}>
          <div className="[font-size:var(--jingle-font-control)] leading-[var(--jingle-line-chat)] text-muted-foreground">
            {viewModel.ui.display.description}
          </div>
        </ToolDetailSection>
        {viewModel.rawArgs ? (
          <ToolDetailSection label={copy.common.rawArguments}>
            <ToolCodeBlock>{viewModel.rawArgs}</ToolCodeBlock>
          </ToolDetailSection>
        ) : null}
        {viewModel.rawResult ? (
          <ToolDetailSection label={copy.common.rawResult}>
            <ToolCodeBlock>{viewModel.rawResult}</ToolCodeBlock>
          </ToolDetailSection>
        ) : null}
      </ToolDetailStack>
    )
  }
})
