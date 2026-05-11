# Openwork UI Upgrade Research

Date: 2026-05-11

## Scope

This research targets the agent chat surface, especially assistant markdown density, reasoning/thinking message treatment, tool-adjacent code surfaces, and the token layer that supports those states. The upgrade should keep Openwork quiet and work-focused: dense enough for repeated engineering use, but with clear hierarchy between normal answer text, hidden reasoning, tools, approvals, code, and errors.

## Reference Sources

### Figma Community and Design Systems

- Figma Community search for AI chat UI kits:
  https://www.figma.com/community/search?query=AI%20chat%20UI%20kit
- Figma design systems and variables:
  https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma
- Figma MCP and Dev Mode direction for design-to-code context:
  https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Dev-Mode-MCP-Server
- js.design / 即时设计:
  https://js.design/

Takeaway: useful Figma files increasingly expose design intent as variables rather than one-off pixel values. For Openwork, that means the renderer should keep interaction-specific tokens such as chat block gap, prose gap, reasoning rail, code font, and status colors centralized in `index.css`, then consume them from components.

### UI8 / Marketplace Patterns

- UI8 AI dashboard and SaaS kit search:
  https://ui8.net/search?query=AI%20dashboard
- Astra UI Kit by Orion Studio:
  https://www.astrauikit.com/
- LanguageGUI, an open-source Figma UI kit for LLM interfaces:
  https://languagegui.com/

Takeaway: polished marketplace kits usually sell consistency more than novelty: complete style guides, broad screen coverage, dark/light modes, compact tables, well-defined badges, and strong component rhythm. For Openwork, the useful lesson is not a marketing hero aesthetic; it is disciplined density, repeated state shapes, and a tokenized foundation.

Visual references reviewed:

- Astra AI chat interface screenshot: conversation sidebar, message thread, model selector, and composer.
  Representative image: https://astra-ai-landing.vercel.app/og-image.png
- Astra dashboard screenshot: usage cards, model breakdown, recent activity.
- LanguageGUI assistant panel, conversations dashboard, chat bubbles, prompt boxes, and sidebar screenshots.
  Representative images:
  - https://uploads-ssl.webflow.com/65b28e963bb65bfe7f83d3b1/65ba5e7069588e91d3ed7d91_language-gui.png
  - https://uploads-ssl.webflow.com/65b28e963bb65bfe7f83d3b1/65b934c847a17365cb632156_ctrl-k-windows-languagegui.png
  - https://uploads-ssl.webflow.com/65b28e963bb65bfe7f83d3b1/65bb0ad985732bf0f192ce9a_command-k-mac-languagegui.png
- LanguageGUI explicitly presents variables/styles and Figma Auto Layout as part of the kit, which maps directly to Openwork's token-first implementation.

### Open Source Agent Chat UI

- Vercel AI Elements Reasoning:
  https://elements.ai-sdk.dev/components/reasoning
- AI Elements source:
  https://github.com/vercel/ai-elements/blob/main/packages/elements/src/reasoning.tsx
- assistant-ui Reasoning docs:
  https://www.assistant-ui.com/docs/ui/reasoning
- assistant-ui Reasoning source:
  https://github.com/assistant-ui/assistant-ui/blob/main/packages/ui/src/components/assistant-ui/reasoning.tsx

Takeaway: reasoning is treated as a distinct message part, not as a tool activity row. Common behavior is:

- Open while reasoning is streaming.
- Collapse or become compact after completion.
- Keep a trigger with a status label such as "Reasoning" or "Thought for 4s".
- Let users expand when they need detail.
- Keep tool calls visually separate from reasoning.

## Visual Direction

Openwork should feel like a native engineering console, not a decorative AI chatbot:

- Quiet foundation: low-contrast surfaces, restrained borders, no saturated gradient background.
- High-density rhythm: compact text, tighter markdown paragraph gaps, stable row heights.
- Clear state channels: reasoning muted/secondary, tools procedural, approvals high contrast, final answer primary.
- Token-first implementation: every repeated visual decision should map to a named Openwork token.

## Token Decisions

Add or standardize these token groups:

- Chat prose: `--ow-chat-prose-gap`, `--ow-chat-prose-block-gap`, `--ow-chat-prose-list-gap`.
- Reasoning: `--ow-reasoning-gap`, `--ow-reasoning-content-gap`, `--ow-reasoning-rail`, `--ow-reasoning-bg`.
- Code: keep staged `--ow-font-code`, `--ow-font-inline-code`, `--ow-line-code`.
- State: reuse `--status-info`, `--status-warning`, `--status-critical`, `--status-nominal`; do not add a second semantic palette.

## Current Openwork Gap

The current chat markdown spacing inherits Streamdown's default document-style `space-y-4`. Plain paragraph elements have no meaningful margin or padding, so the visual looseness is from block gap, not `p` margins. The assistant answer wrapper can also add another `space-y-4` layer.

Current reasoning uses `ChainOfThought`, which also powers tool-like process UI. It opens during streaming but does not auto-collapse after completion unless `collapseWhenInactive` is explicitly passed. The completed state still reads like "Agent is thinking..." instead of a compact reasoning summary.

## Upgrade Plan

1. Move chat markdown spacing into Openwork tokens and override Streamdown defaults for chat surfaces.
2. Give reasoning its own visual treatment while keeping the existing component boundary small.
3. Make reasoning collapse when streaming ends and use a neutral completed label.
4. Keep tool activity UI separate from reasoning UI.
5. Verify with typecheck and a real rendered screenshot when feasible.
