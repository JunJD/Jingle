import { Plug } from "lucide-react"
import { extensionToolCallUiSchema } from "@shared/tool-presentation"
import { ToolCodeBlock, ToolDetailStack, ToolDetailSection } from "./shared-components"
import { joinSummaryParts } from "./shared"
import type { ToolComponentDefinition, ToolComponentProps } from "./types"

function parseExtensionToolCallUi(toolCall: ToolComponentProps["toolCall"]) {
  return extensionToolCallUiSchema.parse({
    display: toolCall.display,
    presentation: toolCall.presentation
  })
}

export const extensionToolComponent: ToolComponentDefinition = {
  name: "extension",
  icon: Plug,
  renderSummary(props) {
    const ui = parseExtensionToolCallUi(props.toolCall)
    return joinSummaryParts(ui.display.title, ui.presentation.profileTitle)
  },
  renderDetail(props) {
    const ui = parseExtensionToolCallUi(props.toolCall)

    return (
      <ToolDetailStack>
        <ToolDetailSection label={ui.presentation.sourceTitle}>
          <div className="[font-size:var(--ow-font-control)] leading-[var(--ow-line-chat)] text-muted-foreground">
            {ui.display.description}
          </div>
        </ToolDetailSection>
        {props.rawArgs ? (
          <ToolDetailSection label={props.copy.common.rawArguments}>
            <ToolCodeBlock>{props.rawArgs}</ToolCodeBlock>
          </ToolDetailSection>
        ) : null}
        {props.rawResult ? (
          <ToolDetailSection label={props.copy.common.rawResult}>
            <ToolCodeBlock>{props.rawResult}</ToolCodeBlock>
          </ToolDetailSection>
        ) : null}
      </ToolDetailStack>
    )
  }
}
