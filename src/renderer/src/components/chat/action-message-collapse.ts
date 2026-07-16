export function projectActionMessageCollapse(input: {
  approvalRequired: boolean
  defaultExpanded: boolean
  expanded?: boolean
  hasDetail: boolean
}): {
  collapsed: boolean | undefined
  defaultCollapsed: boolean
  interactive: boolean
} {
  const interactive = input.hasDetail && !input.approvalRequired
  return {
    collapsed: !interactive ? false : input.expanded === undefined ? undefined : !input.expanded,
    defaultCollapsed: input.hasDetail ? !(input.approvalRequired || input.defaultExpanded) : false,
    interactive
  }
}
