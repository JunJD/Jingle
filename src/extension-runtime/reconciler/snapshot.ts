import type {
  ExtensionActionNode,
  ExtensionActionStyle,
  ExtensionDetailMetadataNode,
  ExtensionDetailSurfaceSnapshot,
  ExtensionFormFieldNode,
  ExtensionFormSurfaceSnapshot,
  ExtensionHostResponse,
  ExtensionRunBotAgentPayload,
  ExtensionListDropdownItemNode,
  ExtensionListDropdownNode,
  ExtensionListDropdownSectionNode,
  ExtensionListEmptyViewNode,
  ExtensionListItemNode,
  ExtensionListSectionNode,
  ExtensionListSurfaceSnapshot,
  ExtensionMenuBarItemNode,
  ExtensionMenuBarSectionNode,
  ExtensionMenuBarSurfaceSnapshot,
  ExtensionImageVisualNode,
  ExtensionShortcutPlatform,
  ExtensionSurfaceSnapshot,
  ExtensionSvgVisualNode,
  ExtensionVisualNode
} from "../../shared/extension-runtime-protocol"
import { resolveExtensionShortcutPlatform } from "../../shared/extension-runtime-protocol"
import {
  ExtensionHostActionKind,
  ExtensionHostElement,
  resolveColorLike,
  type ColorLike,
  type RuntimeSubmitFormValues
} from "@jingle/extension-api/host-runtime"
import type {
  RuntimeActionHandler,
  RuntimeActionHandlerParams,
  RuntimeHostChild,
  RuntimeHostContainer,
  RuntimeHostElementNode,
  RuntimeHostProps
} from "./host-tree"

interface SnapshotBuildState {
  nextActionId: () => string
}

class ExtensionSurfaceContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExtensionSurfaceContractError"
  }
}

const SVG_TAG_NAMES = new Set([
  "circle",
  "clipPath",
  "defs",
  "ellipse",
  "g",
  "line",
  "linearGradient",
  "mask",
  "path",
  "polygon",
  "polyline",
  "radialGradient",
  "rect",
  "stop",
  "svg",
  "text",
  "tspan"
])

export function createSurfaceSnapshot(container: RuntimeHostContainer): ExtensionSurfaceSnapshot {
  container.actionHandlers.clear()
  container.menuBarActionHandlers.clear()
  const state = createSnapshotBuildState()

  try {
    return createValidatedSurfaceSnapshot(container, state)
  } catch (error) {
    if (!(error instanceof ExtensionSurfaceContractError)) {
      throw error
    }

    container.actionHandlers.clear()
    container.menuBarActionHandlers.clear()
    return {
      commandName: container.context.commandName,
      description: error.message,
      extensionName: container.context.extensionName,
      kind: "error",
      revision: container.revision,
      title: "Invalid extension surface"
    }
  }
}

function createValidatedSurfaceSnapshot(
  container: RuntimeHostContainer,
  state: SnapshotBuildState
): ExtensionSurfaceSnapshot {
  const menuBar = findFirstElement(container.children, ExtensionHostElement.MenuBarExtra)
  if (menuBar) {
    return createMenuBarSnapshot(container, menuBar)
  }

  const detail = findFirstElement(container.children, ExtensionHostElement.Detail)
  if (detail) {
    return createDetailSnapshot(container, state, detail)
  }

  const form = findFirstElement(container.children, ExtensionHostElement.Form)
  if (form) {
    return createFormSnapshot(container, state, form)
  }

  const list = findFirstElement(container.children, ExtensionHostElement.List)
  if (!list) {
    return {
      commandName: container.context.commandName,
      description: "The extension did not render a List, Detail, Form, or Menu Bar surface.",
      extensionName: container.context.extensionName,
      kind: "error",
      revision: container.revision,
      title: "No renderable surface"
    }
  }

  return createListSnapshot(container, state, list)
}

function createMenuBarSnapshot(
  container: RuntimeHostContainer,
  menuBar: RuntimeHostElementNode
): ExtensionMenuBarSurfaceSnapshot {
  return {
    commandName: container.context.commandName,
    extensionName: container.context.extensionName,
    icon: readStringProp(menuBar.props, "icon"),
    iconName: readMenuBarIconNameProp(menuBar.props, "iconName"),
    isLoading: readBooleanProp(menuBar.props, "isLoading", false),
    kind: "menu-bar",
    revision: container.revision,
    sections: collectMenuBarSections(container, menuBar),
    title: readStringProp(menuBar.props, "title"),
    tooltip: readStringProp(menuBar.props, "tooltip")
  }
}

function collectMenuBarSections(
  container: RuntimeHostContainer,
  menuBar: RuntimeHostElementNode
): ExtensionMenuBarSectionNode[] {
  let implicitItemIndex = 0
  const implicitItems: ExtensionMenuBarItemNode[] = []
  for (const item of directChildrenOfType(menuBar, ExtensionHostElement.MenuBarExtraItem)) {
    const menuBarItem = createMenuBarItem(
      container,
      item,
      () => `menu-bar-item-${implicitItemIndex++}`
    )
    if (menuBarItem) {
      implicitItems.push(menuBarItem)
    }
  }

  const sections: ExtensionMenuBarSectionNode[] = []
  for (const [sectionIndex, section] of directChildrenOfType(
    menuBar,
    ExtensionHostElement.MenuBarExtraSection
  ).entries()) {
    const items: ExtensionMenuBarItemNode[] = []
    for (const [itemIndex, item] of directChildrenOfType(
      section,
      ExtensionHostElement.MenuBarExtraItem
    ).entries()) {
      const menuBarItem = createMenuBarItem(
        container,
        item,
        () => `menu-bar-section-${sectionIndex}-item-${itemIndex}`
      )
      if (menuBarItem) {
        items.push(menuBarItem)
      }
    }

    if (items.length > 0) {
      sections.push({
        id: `menu-bar-section-${sectionIndex}`,
        items,
        title: readStringProp(section.props, "title")
      })
    }
  }

  if (implicitItems.length > 0) {
    sections.unshift({
      id: "menu-bar-section-implicit",
      items: implicitItems,
      title: undefined
    })
  }

  return sections
}

function createMenuBarItem(
  container: RuntimeHostContainer,
  item: RuntimeHostElementNode,
  fallbackId: () => string
): ExtensionMenuBarItemNode | null {
  const title = readStringProp(item.props, "title")
  if (!title) {
    return null
  }

  const id = fallbackId()
  const onAction = item.props.onAction
  if (typeof onAction === "function") {
    container.menuBarActionHandlers.set(id, {
      disabled: readBooleanProp(item.props, "disabled", false),
      handler: onAction as RuntimeActionHandler["handler"]
    })
  }

  return {
    disabled: readBooleanProp(item.props, "disabled", false),
    icon: readStringProp(item.props, "icon"),
    iconName: readMenuBarIconNameProp(item.props, "iconName"),
    id,
    subtitle: readStringProp(item.props, "subtitle"),
    title
  }
}

function createListSnapshot(
  container: RuntimeHostContainer,
  state: SnapshotBuildState,
  list: RuntimeHostElementNode
): ExtensionListSurfaceSnapshot {
  return {
    actions: collectActions(
      container,
      state,
      directChildrenOfType(list, ExtensionHostElement.ActionPanel)
    ),
    canPop: readBooleanProp(list.props, "navigationCanPop", false),
    commandName: container.context.commandName,
    emptyView: collectEmptyView(container, state, list),
    extensionName: container.context.extensionName,
    filtering: readListFilteringProp(list.props),
    isLoading: readBooleanProp(list.props, "isLoading", false),
    kind: "list",
    navigationTitle: readRequiredNonEmptyStringProp(list.props, "navigationTitle", "List"),
    pagination: collectListPagination(container, list),
    revision: container.revision,
    searchBarAccessory: collectDropdown(list),
    searchBarPlaceholder: readStringProp(list.props, "searchBarPlaceholder"),
    searchText: readStringProp(list.props, "searchText") ?? "",
    sections: collectSections(container, state, list),
    throttle: readBooleanProp(list.props, "throttle", false)
  }
}

function collectListPagination(
  container: RuntimeHostContainer,
  list: RuntimeHostElementNode
): ExtensionListSurfaceSnapshot["pagination"] {
  const pagination = list.props.pagination
  if (!isListPaginationProp(pagination)) {
    return undefined
  }

  const handlerId = "list-pagination.load-more"
  container.actionHandlers.set(handlerId, {
    disabled: !pagination.hasMore || pagination.isLoading === true,
    handler: pagination.onLoadMore
  })

  return {
    hasMore: pagination.hasMore,
    isLoading: pagination.isLoading === true
  }
}

function createDetailSnapshot(
  container: RuntimeHostContainer,
  state: SnapshotBuildState,
  detail: RuntimeHostElementNode
): ExtensionDetailSurfaceSnapshot {
  return {
    actions: collectActions(
      container,
      state,
      directChildrenOfType(detail, ExtensionHostElement.ActionPanel)
    ),
    canPop: readBooleanProp(detail.props, "navigationCanPop", false),
    commandName: container.context.commandName,
    extensionName: container.context.extensionName,
    isLoading: readBooleanProp(detail.props, "isLoading", false),
    kind: "detail",
    markdown: readStringProp(detail.props, "markdown"),
    metadata: collectDetailMetadata(detail),
    navigationTitle: readRequiredNonEmptyStringProp(detail.props, "navigationTitle", "Detail"),
    revision: container.revision
  }
}

function createFormSnapshot(
  container: RuntimeHostContainer,
  state: SnapshotBuildState,
  form: RuntimeHostElementNode
): ExtensionFormSurfaceSnapshot {
  return {
    actions: collectActions(
      container,
      state,
      directChildrenOfType(form, ExtensionHostElement.ActionPanel)
    ),
    canPop: readBooleanProp(form.props, "navigationCanPop", false),
    commandName: container.context.commandName,
    extensionName: container.context.extensionName,
    fields: collectFormFields(form),
    isLoading: readBooleanProp(form.props, "isLoading", false),
    kind: "form",
    navigationTitle: readRequiredNonEmptyStringProp(form.props, "navigationTitle", "Form"),
    revision: container.revision
  }
}

function collectSections(
  container: RuntimeHostContainer,
  state: SnapshotBuildState,
  list: RuntimeHostElementNode
): ExtensionListSectionNode[] {
  let implicitItemIndex = 0
  const implicitItems = directChildrenOfType(list, ExtensionHostElement.ListItem).map((item) =>
    createListItem(container, state, item, () => `list-item-${implicitItemIndex++}`)
  )
  const sections: ExtensionListSectionNode[] = directChildrenOfType(
    list,
    ExtensionHostElement.ListSection
  ).map((section, sectionIndex) => ({
    id: `list-section-${sectionIndex}`,
    items: directChildrenOfType(section, ExtensionHostElement.ListItem).map((item, itemIndex) =>
      createListItem(container, state, item, () => `list-section-${sectionIndex}-item-${itemIndex}`)
    ),
    subtitle: readStringProp(section.props, "subtitle"),
    title: readStringProp(section.props, "title")
  }))

  if (implicitItems.length > 0) {
    sections.unshift({
      id: "list-section-implicit",
      items: implicitItems
    })
  }

  return sections.filter((section) => section.items.length > 0)
}

function createListItem(
  container: RuntimeHostContainer,
  state: SnapshotBuildState,
  item: RuntimeHostElementNode,
  fallbackId: () => string
): ExtensionListItemNode {
  return {
    accessories: collectVisuals(item, "accessory"),
    actions: collectActions(
      container,
      state,
      directChildrenOfType(item, ExtensionHostElement.ActionPanel)
    ),
    icon: collectVisual(item, "icon"),
    id: readStringProp(item.props, "id") ?? fallbackId(),
    keywords: readStringArrayProp(item.props, "keywords"),
    subtitle: readStringProp(item.props, "subtitle"),
    title: readStringProp(item.props, "title") ?? ""
  }
}

function collectEmptyView(
  container: RuntimeHostContainer,
  state: SnapshotBuildState,
  list: RuntimeHostElementNode
): ExtensionListEmptyViewNode | undefined {
  const emptyView = directChildrenOfType(list, ExtensionHostElement.ListEmptyView)[0]
  if (!emptyView) {
    return undefined
  }

  return {
    actions: collectActions(
      container,
      state,
      directChildrenOfType(emptyView, ExtensionHostElement.ActionPanel)
    ),
    description: readStringProp(emptyView.props, "description"),
    title: readRequiredNonEmptyStringProp(emptyView.props, "title", "List.EmptyView")
  }
}

function collectDropdown(list: RuntimeHostElementNode): ExtensionListDropdownNode | undefined {
  const dropdown = directChildrenOfType(list, ExtensionHostElement.ListDropdown)[0]
  if (!dropdown) {
    return undefined
  }

  const sections: ExtensionListDropdownSectionNode[] = []
  const directItems = directChildrenOfType(dropdown, ExtensionHostElement.ListDropdownItem)
  if (directItems.length > 0) {
    sections.push({
      id: "list-dropdown-section-implicit",
      items: directItems.map(createDropdownItem)
    })
  }

  for (const [sectionIndex, section] of directChildrenOfType(
    dropdown,
    ExtensionHostElement.ListDropdownSection
  ).entries()) {
    const items = directChildrenOfType(section, ExtensionHostElement.ListDropdownItem).map(
      createDropdownItem
    )
    if (items.length > 0) {
      sections.push({
        id: `list-dropdown-section-${sectionIndex}`,
        items,
        title: readStringProp(section.props, "title")
      })
    }
  }

  if (sections.length === 0) {
    return undefined
  }

  return {
    id: "list-dropdown",
    sections,
    value: readRequiredStringProp(dropdown.props, "value", "List.Dropdown")
  }
}

function createDropdownItem(item: RuntimeHostElementNode): ExtensionListDropdownItemNode {
  return {
    icon: collectVisual(item, "icon"),
    title: readStringProp(item.props, "title") ?? "",
    value: readStringProp(item.props, "value") ?? ""
  }
}

function collectDetailMetadata(detail: RuntimeHostElementNode): ExtensionDetailMetadataNode[] {
  return directChildrenOfType(detail, ExtensionHostElement.DetailMetadata).flatMap((metadata) =>
    collectDetailMetadataEntries(metadata)
  )
}

function collectDetailMetadataEntries(node: RuntimeHostElementNode): ExtensionDetailMetadataNode[] {
  return directElementChildren(node).flatMap((child) => {
    if (child.type === ExtensionHostElement.DetailMetadataLabel) {
      return [
        {
          icon: collectVisual(child, "icon"),
          text: readStringProp(child.props, "text") ?? "",
          title: readStringProp(child.props, "title") ?? ""
        }
      ]
    }

    if (child.type === ExtensionHostElement.DetailMetadataLink) {
      return [
        {
          target: readStringProp(child.props, "target"),
          text: readStringProp(child.props, "text") ?? "",
          title: readStringProp(child.props, "title") ?? ""
        }
      ]
    }

    if (child.type === ExtensionHostElement.DetailMetadataTagList) {
      return [
        {
          text: collectDetailMetadataTagTexts(child).join(", "),
          title: readStringProp(child.props, "title") ?? ""
        }
      ]
    }

    if (child.type === ExtensionHostElement.DetailMetadata) {
      return collectDetailMetadataEntries(child)
    }

    return []
  })
}

function collectDetailMetadataTagTexts(tagList: RuntimeHostElementNode): string[] {
  const propTags = readStringArrayProp(tagList.props, "tags")
  const childTags = directChildrenOfType(tagList, ExtensionHostElement.DetailMetadataTagListItem)
    .map((item) => readStringProp(item.props, "text"))
    .filter((text): text is string => Boolean(text))

  return [...propTags, ...childTags]
}

function collectFormFields(form: RuntimeHostElementNode): ExtensionFormFieldNode[] {
  let fieldIndex = 0

  return directElementChildren(form).flatMap((child) => {
    if (!isFormFieldElement(child)) {
      return []
    }

    const fallbackId = `form-field-${fieldIndex++}`
    return createFormFieldNode(child, fallbackId)
  })
}

function createFormFieldNode(
  node: RuntimeHostElementNode,
  fallbackId: string
): ExtensionFormFieldNode[] {
  const id = readStringProp(node.props, "id") ?? fallbackId
  const description = readStringProp(node.props, "description")
  const error = readStringProp(node.props, "error")
  const info = readStringProp(node.props, "info")

  if (node.type === ExtensionHostElement.FormTextField) {
    return [
      {
        autoFocus: readBooleanProp(node.props, "autoFocus", false),
        description,
        error,
        focusRequestId: readNumberProp(node.props, "focusRequestId"),
        id,
        info,
        kind: "text-field",
        placeholder: readStringProp(node.props, "placeholder"),
        title: readRequiredNonEmptyStringProp(node.props, "title", "Form.TextField"),
        value: readStringProp(node.props, "value") ?? ""
      }
    ]
  }

  if (node.type === ExtensionHostElement.FormTextArea) {
    return [
      {
        autoFocus: readBooleanProp(node.props, "autoFocus", false),
        description,
        enableMarkdown: readBooleanProp(node.props, "enableMarkdown", false),
        error,
        focusRequestId: readNumberProp(node.props, "focusRequestId"),
        id,
        info,
        kind: "text-area",
        placeholder: readStringProp(node.props, "placeholder"),
        title: readRequiredNonEmptyStringProp(node.props, "title", "Form.TextArea"),
        value: readStringProp(node.props, "value") ?? ""
      }
    ]
  }

  if (node.type === ExtensionHostElement.FormCheckbox) {
    return [
      {
        autoFocus: readBooleanProp(node.props, "autoFocus", false),
        description,
        error,
        focusRequestId: readNumberProp(node.props, "focusRequestId"),
        id,
        info,
        kind: "checkbox",
        label: readRequiredNonEmptyStringProp(node.props, "label", "Form.Checkbox"),
        title: readRequiredNonEmptyStringProp(node.props, "title", "Form.Checkbox"),
        value: readBooleanProp(node.props, "value", false)
      }
    ]
  }

  if (node.type === ExtensionHostElement.FormDatePicker) {
    return [
      {
        autoFocus: readBooleanProp(node.props, "autoFocus", false),
        description,
        error,
        focusRequestId: readNumberProp(node.props, "focusRequestId"),
        id,
        info,
        kind: "date-picker",
        placeholder: readStringProp(node.props, "placeholder"),
        title: readRequiredNonEmptyStringProp(node.props, "title", "Form.DatePicker"),
        type: readDatePickerTypeProp(node.props),
        value: readDatePickerValueProp(node.props)
      }
    ]
  }

  if (node.type === ExtensionHostElement.FormDropdown) {
    const items = directChildrenOfType(node, ExtensionHostElement.FormDropdownItem).map((item) => ({
      icon: collectVisual(item, "icon"),
      title: readStringProp(item.props, "title") ?? "",
      value: readStringProp(item.props, "value") ?? ""
    }))
    const searchable = typeof node.props.onSearchTextChange === "function"

    return [
      {
        autoFocus: readBooleanProp(node.props, "autoFocus", false),
        description,
        error,
        focusRequestId: readNumberProp(node.props, "focusRequestId"),
        id,
        info,
        isLoading: readBooleanProp(node.props, "isLoading", false),
        items,
        kind: "dropdown",
        searchable,
        title: readRequiredNonEmptyStringProp(node.props, "title", "Form.Dropdown"),
        value:
          readStringProp(node.props, "value") ??
          readStringProp(node.props, "defaultValue") ??
          (searchable ? undefined : items[0]?.value) ??
          ""
      }
    ]
  }

  if (node.type === ExtensionHostElement.FormTagPicker) {
    return [
      {
        autoFocus: readBooleanProp(node.props, "autoFocus", false),
        description,
        error,
        focusRequestId: readNumberProp(node.props, "focusRequestId"),
        id,
        info,
        items: directChildrenOfType(node, ExtensionHostElement.FormTagPickerItem).map((item) => ({
          icon: collectVisual(item, "icon"),
          title: readStringProp(item.props, "title") ?? "",
          value: readStringProp(item.props, "value") ?? ""
        })),
        kind: "tag-picker",
        title: readRequiredNonEmptyStringProp(node.props, "title", "Form.TagPicker"),
        value: readStringArrayProp(node.props, "value")
      }
    ]
  }

  if (node.type === ExtensionHostElement.FormMessage) {
    return [
      {
        id,
        kind: "message",
        text: readStringProp(node.props, "text") ?? "",
        tone: node.props.tone === "critical" ? "critical" : "info"
      }
    ]
  }

  if (node.type === ExtensionHostElement.FormSeparator) {
    return [
      {
        id,
        kind: "separator"
      }
    ]
  }

  return []
}

function isFormFieldElement(node: RuntimeHostElementNode): boolean {
  return (
    node.type === ExtensionHostElement.FormCheckbox ||
    node.type === ExtensionHostElement.FormDatePicker ||
    node.type === ExtensionHostElement.FormDropdown ||
    node.type === ExtensionHostElement.FormMessage ||
    node.type === ExtensionHostElement.FormSeparator ||
    node.type === ExtensionHostElement.FormTagPicker ||
    node.type === ExtensionHostElement.FormTextArea ||
    node.type === ExtensionHostElement.FormTextField
  )
}

function collectFormValues(
  container: RuntimeHostContainer
): Record<string, boolean | Date | null | string | string[]> {
  const form = findFirstElement(container.children, ExtensionHostElement.Form)
  if (!form) {
    return {}
  }

  let fieldIndex = 0
  const values: Record<string, boolean | Date | null | string | string[]> = {}
  for (const field of directElementChildren(form)) {
    if (!isSubmittableFormFieldElement(field)) {
      continue
    }

    const id = readStringProp(field.props, "id") ?? `form-field-${fieldIndex}`
    fieldIndex += 1

    if (field.type === ExtensionHostElement.FormCheckbox) {
      values[id] = readBooleanProp(field.props, "value", false)
    } else if (field.type === ExtensionHostElement.FormDatePicker) {
      values[id] = readDatePickerRawValueProp(field.props)
    } else if (field.type === ExtensionHostElement.FormTagPicker) {
      values[id] = readStringArrayProp(field.props, "value")
    } else if (field.type === ExtensionHostElement.FormDropdown) {
      const firstItem = directChildrenOfType(field, ExtensionHostElement.FormDropdownItem)[0]
      const searchable = typeof field.props.onSearchTextChange === "function"
      values[id] =
        readStringProp(field.props, "value") ??
        readStringProp(field.props, "defaultValue") ??
        (!searchable && firstItem ? readStringProp(firstItem.props, "value") : undefined) ??
        ""
    } else {
      values[id] = readStringProp(field.props, "value") ?? ""
    }
  }

  return values
}

function isSubmittableFormFieldElement(node: RuntimeHostElementNode): boolean {
  return (
    node.type === ExtensionHostElement.FormCheckbox ||
    node.type === ExtensionHostElement.FormDatePicker ||
    node.type === ExtensionHostElement.FormDropdown ||
    node.type === ExtensionHostElement.FormTagPicker ||
    node.type === ExtensionHostElement.FormTextArea ||
    node.type === ExtensionHostElement.FormTextField
  )
}

function collectActions(
  container: RuntimeHostContainer,
  state: SnapshotBuildState,
  panels: RuntimeHostElementNode[]
): ExtensionActionNode[] {
  return panels.flatMap((panel) =>
    collectActionNodes(container, panel, {
      nextActionId: state.nextActionId
    })
  )
}

function collectActionNodes(
  container: RuntimeHostContainer,
  node: RuntimeHostElementNode,
  params: {
    nextActionId: () => string
    sectionTitle?: string
  }
): ExtensionActionNode[] {
  if (node.type === ExtensionHostElement.ActionPanelSubmenu) {
    const title = readStringProp(node.props, "title")
    if (!title) {
      return []
    }

    const id = params.nextActionId()
    const children = directElementChildren(node).flatMap((child) =>
      collectActionNodes(container, child, {
        nextActionId: params.nextActionId
      })
    )
    if (children.length === 0) {
      return []
    }

    return [
      {
        children,
        disabled: readBooleanProp(node.props, "disabled", false),
        icon: collectVisual(node, "icon"),
        id,
        sectionTitle: params.sectionTitle,
        shortcut: readActionShortcutProp(node.props),
        style: readActionStyleProp(node.props),
        title
      }
    ]
  }

  if (node.type === ExtensionHostElement.Action) {
    const title = readStringProp(node.props, "title")
    if (!title) {
      return []
    }

    const actionKind = readStringProp(node.props, "actionKind")
    let handler: RuntimeActionHandler["handler"]
    if (actionKind === ExtensionHostActionKind.CopyToClipboard) {
      const content = readClipboardContentProp(node.props, "content")
      if (content === undefined) {
        return []
      }

      handler = () => requestWriteClipboardText(container, content)
    } else if (actionKind === ExtensionHostActionKind.CreateQuicklink) {
      const quicklink = readQuicklinkProp(node.props, "quicklink")
      if (!quicklink) {
        return []
      }

      handler = () =>
        requestRegisterQuicklink(container, {
          link: quicklink.link,
          name: quicklink.name,
          shortcut: readQuicklinkShortcutProp(node.props)
        })
    } else if (actionKind === ExtensionHostActionKind.Paste) {
      const content = readClipboardContentProp(node.props, "content")
      if (content === undefined) {
        return []
      }

      handler = () => requestPasteClipboardText(container, content)
    } else if (actionKind === ExtensionHostActionKind.OpenInBrowser) {
      const url = readStringProp(node.props, "url")
      if (!url) {
        return []
      }

      handler = () => requestOpenExternal(container, url)
    } else if (actionKind === ExtensionHostActionKind.RunBotAgent) {
      const input = readRunBotAgentInputProp(node.props)
      if (!input) {
        return []
      }

      handler = () => requestRunBotAgent(container, input)
    } else if (actionKind === ExtensionHostActionKind.SubmitForm) {
      const onSubmit = node.props.onSubmit
      if (typeof onSubmit === "function") {
        handler = (params) => onSubmit(readSubmitFormValues(params, container))
      } else {
        const onAction = node.props.onAction
        if (typeof onAction !== "function") {
          return []
        }

        handler = onAction as RuntimeActionHandler["handler"]
      }
    } else {
      const onAction = node.props.onAction
      if (typeof onAction !== "function") {
        return []
      }

      handler = onAction as RuntimeActionHandler["handler"]
    }

    const id = params.nextActionId()
    const disabled = readBooleanProp(node.props, "disabled", false)
    container.actionHandlers.set(id, { disabled, handler })

    return [
      {
        disabled,
        icon: collectVisual(node, "icon"),
        id,
        sectionTitle: params.sectionTitle,
        shortcut: readActionShortcutProp(node.props),
        style: readActionStyleProp(node.props),
        title
      }
    ]
  }

  const nextSectionTitle =
    node.type === ExtensionHostElement.ActionPanelSection
      ? (readStringProp(node.props, "title") ?? params.sectionTitle)
      : params.sectionTitle

  return directElementChildren(node).flatMap((child) =>
    collectActionNodes(container, child, {
      nextActionId: params.nextActionId,
      sectionTitle: nextSectionTitle
    })
  )
}

function readSubmitFormValues(
  params: RuntimeActionHandlerParams | undefined,
  container: RuntimeHostContainer
): RuntimeSubmitFormValues {
  const values = collectFormValues(container)
  return isRuntimeSubmitFormValues(params?.formValues)
    ? {
        ...values,
        ...params.formValues
      }
    : values
}

function isRuntimeSubmitFormValues(
  value: Record<string, unknown> | undefined
): value is RuntimeSubmitFormValues {
  return value !== undefined
}

function isRunBotAgentSourceRef(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const source = value as Record<string, unknown>
  return (
    typeof source.type === "string" &&
    source.type.trim().length > 0 &&
    typeof source.label === "string" &&
    source.label.trim().length > 0 &&
    (source.id === undefined || typeof source.id === "string") &&
    (source.url === undefined || typeof source.url === "string") &&
    (source.metadata === undefined ||
      (typeof source.metadata === "object" &&
        source.metadata !== null &&
        !Array.isArray(source.metadata)))
  )
}

function readRunBotAgentInputProp(props: RuntimeHostProps): ExtensionRunBotAgentPayload | null {
  const value = props.input
  if (!value || typeof value !== "object") {
    return null
  }

  const input = value as {
    prompt?: { contextRefs?: unknown; objective?: unknown }
    sourceRef?: unknown
    title?: unknown
    workflow?: unknown
  }
  if (
    typeof input.title !== "string" ||
    input.title.trim().length === 0 ||
    !input.prompt ||
    typeof input.prompt !== "object" ||
    typeof input.prompt.objective !== "string" ||
    input.prompt.objective.trim().length === 0
  ) {
    return null
  }

  if (
    (input.sourceRef !== undefined && !isRunBotAgentSourceRef(input.sourceRef)) ||
    (input.prompt.contextRefs !== undefined &&
      (!Array.isArray(input.prompt.contextRefs) ||
        !input.prompt.contextRefs.every(isRunBotAgentSourceRef)))
  ) {
    return null
  }

  if (input.workflow !== undefined) {
    if (!input.workflow || typeof input.workflow !== "object" || Array.isArray(input.workflow)) {
      return null
    }

    const workflow = input.workflow as { labels?: unknown; status?: unknown }
    if (
      (workflow.status !== undefined &&
        (typeof workflow.status !== "string" || workflow.status.trim().length === 0)) ||
      (workflow.labels !== undefined &&
        (!Array.isArray(workflow.labels) ||
          !workflow.labels.every(
            (label) =>
              typeof label === "object" &&
              label !== null &&
              !Array.isArray(label) &&
              "key" in label &&
              typeof label.key === "string" &&
              label.key.trim().length > 0 &&
              (!("value" in label) || label.value === undefined || typeof label.value === "string")
          )))
    ) {
      return null
    }
  }

  return value as ExtensionRunBotAgentPayload
}

function readQuicklinkProp(
  props: RuntimeHostProps,
  name: string
): { link: string; name?: string } | null {
  const value = props[name]
  if (!value || typeof value !== "object") {
    return null
  }

  const record = value as { link?: unknown; name?: unknown }
  if (typeof record.link !== "string" || record.link.length === 0) {
    return null
  }

  return {
    link: record.link,
    ...(typeof record.name === "string" ? { name: record.name } : {})
  }
}

function readQuicklinkShortcutProp(
  props: RuntimeHostProps
): { key: string; modifiers: string[]; platform: ExtensionShortcutPlatform } | undefined {
  const shortcut = props.shortcut
  if (!shortcut || typeof shortcut !== "object") {
    return undefined
  }

  const platform = resolveExtensionShortcutPlatform(process.platform)
  if (!platform) {
    return undefined
  }

  const shortcutRecord = shortcut as Record<string, unknown>
  const platformShortcut = readShortcutPlatform(
    shortcutRecord[platform],
    `Quicklink shortcut.${platform}`
  )
  if (!platformShortcut) {
    return undefined
  }

  return {
    key: platformShortcut.key,
    modifiers: platformShortcut.modifiers.filter(
      (modifier): modifier is string => typeof modifier === "string"
    ),
    platform
  }
}

async function requestWriteClipboardText(
  container: RuntimeHostContainer,
  content: { html?: string; text: string }
): Promise<void> {
  if (!container.requestHost) {
    throw new Error("Extension runtime host request handler is not configured.")
  }

  const response: ExtensionHostResponse = await container.requestHost({
    capability: "clipboard",
    id: container.nextHostRequestId(),
    method: "write-text",
    payload: content
  })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
}

async function requestRegisterQuicklink(
  container: RuntimeHostContainer,
  quicklink: {
    link: string
    name?: string
    shortcut?: { key: string; modifiers: string[]; platform: ExtensionShortcutPlatform }
  }
): Promise<unknown> {
  if (!container.requestHost) {
    throw new Error("Extension runtime host request handler is not configured.")
  }

  const response: ExtensionHostResponse = await container.requestHost({
    capability: "quicklinks",
    id: container.nextHostRequestId(),
    method: "register",
    payload: {
      extensionName: container.context.extensionName,
      link: quicklink.link,
      name: quicklink.name,
      shortcut: quicklink.shortcut
    }
  })
  if (!response.ok) {
    throw new Error(response.error.message)
  }

  return response.result
}

async function requestPasteClipboardText(
  container: RuntimeHostContainer,
  content: { html?: string; text: string }
): Promise<void> {
  if (!container.requestHost) {
    throw new Error("Extension runtime host request handler is not configured.")
  }

  const response: ExtensionHostResponse = await container.requestHost({
    capability: "clipboard",
    id: container.nextHostRequestId(),
    method: "paste-text",
    payload: content
  })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
}

async function requestOpenExternal(container: RuntimeHostContainer, url: string): Promise<void> {
  if (!container.requestHost) {
    throw new Error("Extension runtime host request handler is not configured.")
  }

  const response: ExtensionHostResponse = await container.requestHost({
    capability: "shell",
    id: container.nextHostRequestId(),
    method: "open-external",
    payload: {
      url
    }
  })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
}

async function requestRunBotAgent(
  container: RuntimeHostContainer,
  input: ExtensionRunBotAgentPayload
): Promise<unknown> {
  if (!container.requestHost) {
    throw new Error("Extension runtime host request handler is not configured.")
  }

  const response: ExtensionHostResponse = await container.requestHost({
    capability: "agent",
    id: container.nextHostRequestId(),
    method: "run-bot-agent",
    payload: input
  })
  if (!response.ok) {
    throw new Error(response.error.message)
  }

  return response.result
}

function createSnapshotBuildState(): SnapshotBuildState {
  let actionIndex = 0
  return {
    nextActionId: () => `action-${actionIndex++}`
  }
}

function findFirstElement(
  children: RuntimeHostChild[],
  type: RuntimeHostElementNode["type"]
): RuntimeHostElementNode | null {
  for (const child of children) {
    if (child.kind !== "element") {
      continue
    }

    if (child.type === type) {
      return child
    }

    const nested = findFirstElement(child.children, type)
    if (nested) {
      return nested
    }
  }

  return null
}

function directChildrenOfType(
  node: RuntimeHostElementNode,
  type: RuntimeHostElementNode["type"]
): RuntimeHostElementNode[] {
  return directElementChildren(node).filter((child) => child.type === type)
}

function directElementChildren(node: RuntimeHostElementNode): RuntimeHostElementNode[] {
  return node.children.filter((child): child is RuntimeHostElementNode => child.kind === "element")
}

function readActionStyleProp(props: RuntimeHostProps): ExtensionActionStyle {
  return props.style === "destructive" ? "destructive" : "regular"
}

function readActionShortcutProp(props: RuntimeHostProps): ExtensionActionNode["shortcut"] {
  const shortcut = props.shortcut
  if (!shortcut || typeof shortcut !== "object") {
    return undefined
  }

  const shortcutRecord = shortcut as Record<string, unknown>
  const platform = resolveExtensionShortcutPlatform(process.platform)
  if (!platform) {
    return undefined
  }

  const platformShortcut = readShortcutPlatform(
    shortcutRecord[platform],
    `Action shortcut.${platform}`
  )
  if (!platformShortcut) {
    return undefined
  }

  return {
    key: platformShortcut.key,
    modifiers: platformShortcut.modifiers.filter(
      (modifier): modifier is string => typeof modifier === "string"
    )
  }
}

function readShortcutPlatform(
  value: unknown,
  owner: string
): { key: string; modifiers: unknown[] } | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!value || typeof value !== "object") {
    throw new ExtensionSurfaceContractError(`${owner} must be an object.`)
  }

  const record = value as Record<string, unknown>
  if (
    typeof record.key !== "string" ||
    record.key.trim().length === 0 ||
    !Array.isArray(record.modifiers) ||
    !record.modifiers.every(isRuntimeKeyboardModifier)
  ) {
    throw new ExtensionSurfaceContractError(
      `${owner} requires a non-empty key and valid keyboard modifiers.`
    )
  }

  return {
    key: record.key,
    modifiers: record.modifiers
  }
}

function isRuntimeKeyboardModifier(value: unknown): value is string {
  return value === "cmd" || value === "ctrl" || value === "opt" || value === "shift"
}

function readBooleanProp(props: RuntimeHostProps, name: string, fallback: boolean): boolean {
  return typeof props[name] === "boolean" ? props[name] : fallback
}

function readNumberProp(props: RuntimeHostProps, name: string): number | undefined {
  return typeof props[name] === "number" ? props[name] : undefined
}

function readListFilteringProp(props: RuntimeHostProps): boolean {
  const value = props.filtering
  if (typeof value === "boolean") {
    return value
  }

  return value === undefined
}

function isListPaginationProp(value: unknown): value is {
  hasMore: boolean
  isLoading?: boolean
  onLoadMore: () => Promise<void> | void
} {
  return (
    value !== null &&
    typeof value === "object" &&
    "hasMore" in value &&
    typeof value.hasMore === "boolean" &&
    "onLoadMore" in value &&
    typeof value.onLoadMore === "function"
  )
}

function readStringProp(props: RuntimeHostProps, name: string): string | undefined {
  return typeof props[name] === "string" ? props[name] : undefined
}

function readRequiredStringProp(props: RuntimeHostProps, name: string, owner: string): string {
  const value = readStringProp(props, name)
  if (value === undefined) {
    throw new ExtensionSurfaceContractError(`${owner} requires a string ${name} prop.`)
  }

  return value
}

function readRequiredNonEmptyStringProp(
  props: RuntimeHostProps,
  name: string,
  owner: string
): string {
  const value = readRequiredStringProp(props, name, owner)
  if (value.trim().length === 0) {
    throw new ExtensionSurfaceContractError(`${owner} requires a non-empty ${name} prop.`)
  }

  return value
}

function readClipboardContentProp(
  props: RuntimeHostProps,
  name: string
): { html?: string; text: string } | undefined {
  const value = props[name]
  if (typeof value === "string") {
    return { text: value }
  }

  if (!value || typeof value !== "object") {
    return undefined
  }

  const content = value as { html?: unknown; text?: unknown }
  const html = typeof content.html === "string" ? content.html : undefined
  const text = typeof content.text === "string" ? content.text : html
  return text ? { ...(html !== undefined ? { html } : {}), text } : undefined
}

function readDatePickerValueProp(props: RuntimeHostProps): string {
  const value = props.value
  const type = readDatePickerTypeProp(props)
  if (value instanceof Date) {
    return type === "datetime" ? toDateTimeLocalInputValue(value) : value.toISOString().slice(0, 10)
  }

  return typeof value === "string" ? value : ""
}

function readDatePickerRawValueProp(props: RuntimeHostProps): Date | null | string {
  const value = props.value
  return value instanceof Date || value === null || typeof value === "string" ? value : ""
}

function readDatePickerTypeProp(props: RuntimeHostProps): "date" | "datetime" {
  return props.type === "datetime" ? "datetime" : "date"
}

function toDateTimeLocalInputValue(value: Date): string {
  const timezoneOffset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - timezoneOffset).toISOString().slice(0, 16)
}

function readMenuBarIconNameProp(
  props: RuntimeHostProps,
  name: string
): ExtensionMenuBarItemNode["iconName"] {
  return readStringProp(props, name) as ExtensionMenuBarItemNode["iconName"]
}

function readStringArrayProp(props: RuntimeHostProps, name: string): string[] {
  return Array.isArray(props[name]) ? props[name].filter((item) => typeof item === "string") : []
}

function readImageMask(value: object): ExtensionImageVisualNode["mask"] {
  return "mask" in value && value.mask === "circle" ? "circle" : undefined
}

function readImageTintColor(value: object): string | undefined {
  return "tintColor" in value ? resolveColorLike(value.tintColor as ColorLike) : undefined
}

function collectVisual(
  node: RuntimeHostElementNode,
  slot: string
): ExtensionVisualNode | undefined {
  const visuals = collectVisuals(node, slot)
  if (visuals.length === 0) {
    return undefined
  }

  if (visuals.length === 1) {
    return visuals[0]
  }

  return {
    children: visuals,
    kind: "inline"
  }
}

function collectVisuals(node: RuntimeHostElementNode, slot: string): ExtensionVisualNode[] {
  const visuals: ExtensionVisualNode[] = []
  for (const visual of directChildrenOfType(node, ExtensionHostElement.Visual)) {
    if (readStringProp(visual.props, "slot") !== slot) {
      continue
    }

    visuals.push(...serializeVisualChildren(visual.children))
  }

  return visuals
}

function serializeVisualChildren(children: RuntimeHostChild[]): ExtensionVisualNode[] {
  return children.flatMap((child) => {
    const visual = serializeVisualChild(child)
    return visual ? [visual] : []
  })
}

function serializeVisualChild(child: RuntimeHostChild): ExtensionVisualNode | undefined {
  if (child.kind === "text") {
    return child.text
      ? {
          kind: "text",
          text: child.text
        }
      : undefined
  }

  if (child.type === ExtensionHostElement.Visual) {
    return inlineVisual(serializeVisualChildren(child.children))
  }

  if (child.type === ExtensionHostElement.Image) {
    return serializeImageVisual(child)
  }

  if (isSvgHostElement(child)) {
    const children: ExtensionSvgVisualNode[] = []
    for (const svgChild of directElementChildren(child)) {
      if (isSvgHostElement(svgChild)) {
        children.push(serializeSvgVisual(svgChild))
      }
    }

    return {
      children,
      kind: "svg",
      props: createSvgProps(child.props),
      tagName: child.type
    }
  }

  return inlineVisual(serializeVisualChildren(child.children))
}

function serializeSvgVisual(node: RuntimeHostElementNode): ExtensionSvgVisualNode {
  const children: ExtensionSvgVisualNode[] = []
  for (const child of directElementChildren(node)) {
    if (isSvgHostElement(child)) {
      children.push(serializeSvgVisual(child))
    }
  }

  return {
    children,
    kind: "svg",
    props: createSvgProps(node.props),
    tagName: node.type
  }
}

function serializeImageVisual(node: RuntimeHostElementNode): ExtensionVisualNode | undefined {
  const value = node.props.value
  if (!value || typeof value !== "object" || !("source" in value)) {
    return undefined
  }

  const source = (value as { source?: unknown }).source
  if (typeof source === "string") {
    return {
      kind: "image",
      mask: readImageMask(value),
      source,
      tintColor: readImageTintColor(value)
    }
  }

  return inlineVisual(serializeVisualChildren(node.children))
}

function inlineVisual(children: ExtensionVisualNode[]): ExtensionVisualNode | undefined {
  if (children.length === 0) {
    return undefined
  }

  if (children.length === 1) {
    return children[0]
  }

  return {
    children,
    kind: "inline"
  }
}

function isSvgHostElement(node: RuntimeHostElementNode): boolean {
  return SVG_TAG_NAMES.has(node.type)
}

function createSvgProps(props: RuntimeHostProps): ExtensionSvgVisualNode["props"] {
  const svgProps: ExtensionSvgVisualNode["props"] = {}
  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || key === "dangerouslySetInnerHTML" || key === "ref") {
      continue
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      svgProps[key] = value
    }
  }

  return svgProps
}
