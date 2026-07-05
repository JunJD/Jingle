import type { MenuTextMatch } from "@lexical/react/LexicalTypeaheadMenuPlugin"

const COMPOSER_MENTION_TRIGGER_PATTERN = /@([^\s@]{0,120})$/
const COMPOSER_EMAIL_LIKE_TRIGGER_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
const MENTION_MENU_INPUT_GAP = 8
const MENTION_MENU_MAX_WIDTH = 560
const MENTION_MENU_VIEWPORT_MARGIN = 20

export type WorkspaceFileSearchMenuStatus =
  | "empty-query"
  | "no-results"
  | "search-disabled"
  | "search-incomplete"
  | "searching"

export function getExtensionSourceTriggerMatch(text: string): MenuTextMatch | null {
  const match = COMPOSER_MENTION_TRIGGER_PATTERN.exec(text)
  if (!match) {
    return null
  }

  if (COMPOSER_EMAIL_LIKE_TRIGGER_PATTERN.test(text)) {
    return null
  }

  const matchingString = match[1] ?? ""
  const replaceableString = `@${matchingString}`
  return {
    leadOffset: match.index,
    matchingString,
    replaceableString
  }
}

export const getComposerMentionTriggerMatch = getExtensionSourceTriggerMatch

function getNormalizedMenuQuery(query: string | null): string {
  if (query === null) {
    return ""
  }

  return query.trim()
}

export function getWorkspaceFileSearchMenuStatus(props: {
  query: string | null
  resultCount: number
  searchEnabled: boolean
  searchIncomplete: boolean
  searchInProgress: boolean
}): WorkspaceFileSearchMenuStatus | null {
  const normalizedQuery = getNormalizedMenuQuery(props.query)
  if (normalizedQuery.length === 0) {
    return "empty-query"
  }

  if (!props.searchEnabled) {
    return "search-disabled"
  }

  if (!props.searchInProgress && props.searchIncomplete) {
    return "search-incomplete"
  }

  if (props.resultCount > 0) {
    return null
  }

  return props.searchInProgress ? "searching" : "no-results"
}

export function hasComposerMentionSelectableOptions(props: {
  isMenuOpen: boolean
  optionCount: number
}): boolean {
  return props.isMenuOpen && props.optionCount > 0
}

function getMentionMenuWidth(props: {
  availableViewportWidth: number
  boundaryWidth: number | null
}): number {
  if (props.boundaryWidth !== null && props.boundaryWidth > 0) {
    return Math.min(MENTION_MENU_MAX_WIDTH, props.boundaryWidth, props.availableViewportWidth)
  }

  return Math.min(MENTION_MENU_MAX_WIDTH, props.availableViewportWidth)
}

function getMentionMenuAnchorValue(boundaryValue: number | null, anchorValue: number): number {
  if (boundaryValue !== null) {
    return boundaryValue
  }

  return anchorValue
}

export function getComposerMentionMenuLayout(props: {
  anchorLeft: number
  anchorTop: number
  boundaryLeft: number | null
  boundaryTop: number | null
  boundaryWidth: number | null
  viewportHeight: number
  viewportWidth: number
}): { bottom: number; left: number; width: number } {
  const availableViewportWidth = Math.max(0, props.viewportWidth - MENTION_MENU_VIEWPORT_MARGIN * 2)
  const boundedWidth = getMentionMenuWidth({
    availableViewportWidth,
    boundaryWidth: props.boundaryWidth
  })
  const preferredLeft = getMentionMenuAnchorValue(props.boundaryLeft, props.anchorLeft)
  const preferredTop = getMentionMenuAnchorValue(props.boundaryTop, props.anchorTop)
  const maxLeft = Math.max(
    MENTION_MENU_VIEWPORT_MARGIN,
    props.viewportWidth - MENTION_MENU_VIEWPORT_MARGIN - boundedWidth
  )
  const maxBottom = Math.max(
    MENTION_MENU_VIEWPORT_MARGIN,
    props.viewportHeight - MENTION_MENU_VIEWPORT_MARGIN
  )
  const left = Math.min(Math.max(preferredLeft, MENTION_MENU_VIEWPORT_MARGIN), maxLeft)
  const bottom = Math.min(
    Math.max(
      props.viewportHeight - preferredTop + MENTION_MENU_INPUT_GAP,
      MENTION_MENU_VIEWPORT_MARGIN
    ),
    maxBottom
  )

  return {
    bottom: Math.round(bottom),
    left: Math.round(left),
    width: Math.round(boundedWidth)
  }
}
