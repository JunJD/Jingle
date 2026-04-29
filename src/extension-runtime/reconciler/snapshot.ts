import type {
  ExtensionActionNode,
  ExtensionActionStyle,
  ExtensionDetailMetadataNode,
  ExtensionDetailSurfaceSnapshot,
  ExtensionFormFieldNode,
  ExtensionFormSurfaceSnapshot,
  ExtensionHostResponse,
  ExtensionListDropdownItemNode,
  ExtensionListDropdownNode,
  ExtensionListDropdownSectionNode,
  ExtensionListEmptyViewNode,
  ExtensionListItemNode,
  ExtensionListSectionNode,
  ExtensionListSurfaceSnapshot,
  ExtensionSurfaceSnapshot,
  ExtensionSvgVisualNode,
  ExtensionVisualNode
} from "../../shared/extension-runtime-protocol"
import { ExtensionHostActionKind, ExtensionHostElement } from "../sdk/host-elements"
import type {
  RuntimeActionHandler,
  RuntimeHostChild,
  RuntimeHostContainer,
  RuntimeHostElementNode,
  RuntimeHostProps
} from "./host-tree"

interface SnapshotBuildState {
  nextActionId: () => string
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
  const state = createSnapshotBuildState()

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
      extensionName: container.context.extensionName,
      kind: "error",
      revision: container.revision,
      title: "No renderable surface"
    }
  }

  return createListSnapshot(container, state, list)
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
    filtering: readBooleanProp(list.props, "filtering", true),
    isLoading: readBooleanProp(list.props, "isLoading", false),
    kind: "list",
    navigationTitle: readStringProp(list.props, "navigationTitle"),
    revision: container.revision,
    searchBarAccessory: collectDropdown(list),
    searchBarPlaceholder: readStringProp(list.props, "searchBarPlaceholder"),
    searchText: readStringProp(list.props, "searchText") ?? "",
    sections: collectSections(container, state, list)
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
    navigationTitle: readStringProp(detail.props, "navigationTitle"),
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
    kind: "form",
    navigationTitle: readStringProp(form.props, "navigationTitle"),
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
    title: readStringProp(emptyView.props, "title")
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

  sections.push(
    ...directChildrenOfType(dropdown, ExtensionHostElement.ListDropdownSection)
      .map((section, sectionIndex) => ({
        id: `list-dropdown-section-${sectionIndex}`,
        items: directChildrenOfType(section, ExtensionHostElement.ListDropdownItem).map(
          createDropdownItem
        ),
        title: readStringProp(section.props, "title")
      }))
      .filter((section) => section.items.length > 0)
  )

  if (sections.length === 0) {
    return undefined
  }

  return {
    id: "list-dropdown",
    sections,
    value: readStringProp(dropdown.props, "value")
  }
}

function createDropdownItem(item: RuntimeHostElementNode): ExtensionListDropdownItemNode {
  return {
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
          text: readStringProp(child.props, "text") ?? "",
          title: readStringProp(child.props, "title") ?? ""
        }
      ]
    }

    if (child.type === ExtensionHostElement.DetailMetadataTagList) {
      return [
        {
          text: readStringArrayProp(child.props, "tags").join(", "),
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
  const title = readStringProp(node.props, "title") ?? ""
  const description = readStringProp(node.props, "description")

  if (node.type === ExtensionHostElement.FormTextField) {
    return [
      {
        description,
        id,
        kind: "text-field",
        placeholder: readStringProp(node.props, "placeholder"),
        title,
        value: readStringProp(node.props, "value") ?? ""
      }
    ]
  }

  if (node.type === ExtensionHostElement.FormTextArea) {
    return [
      {
        description,
        id,
        kind: "text-area",
        placeholder: readStringProp(node.props, "placeholder"),
        title,
        value: readStringProp(node.props, "value") ?? ""
      }
    ]
  }

  if (node.type === ExtensionHostElement.FormCheckbox) {
    return [
      {
        description,
        id,
        kind: "checkbox",
        label: readStringProp(node.props, "label"),
        title,
        value: readBooleanProp(node.props, "value", false)
      }
    ]
  }

  if (node.type === ExtensionHostElement.FormDropdown) {
    return [
      {
        description,
        id,
        items: directChildrenOfType(node, ExtensionHostElement.FormDropdownItem).map((item) => ({
          title: readStringProp(item.props, "title") ?? "",
          value: readStringProp(item.props, "value") ?? ""
        })),
        kind: "dropdown",
        title,
        value: readStringProp(node.props, "value") ?? ""
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
    node.type === ExtensionHostElement.FormDropdown ||
    node.type === ExtensionHostElement.FormSeparator ||
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
  if (node.type === ExtensionHostElement.Action) {
    const title = readStringProp(node.props, "title")
    if (!title) {
      return []
    }

    const actionKind = readStringProp(node.props, "actionKind")
    let handler: RuntimeActionHandler["handler"]
    if (actionKind === ExtensionHostActionKind.OpenInBrowser) {
      const url = readStringProp(node.props, "url")
      if (!url) {
        return []
      }

      handler = () => requestOpenExternal(container, url)
    } else {
      const onAction = node.props.onAction
      if (typeof onAction !== "function") {
        return []
      }

      handler = onAction as RuntimeActionHandler["handler"]
    }

    const id = params.nextActionId()
    container.actionHandlers.set(id, { handler })

    return [
      {
        disabled: readBooleanProp(node.props, "disabled", false),
        icon: collectVisual(node, "icon"),
        id,
        sectionTitle: params.sectionTitle,
        style: readActionStyleProp(node.props),
        title
      }
    ]
  }

  const nextSectionTitle =
    node.type === ExtensionHostElement.ActionPanelSection ||
    node.type === ExtensionHostElement.ActionPanelSubmenu
      ? (readStringProp(node.props, "title") ?? params.sectionTitle)
      : params.sectionTitle

  return directElementChildren(node).flatMap((child) =>
    collectActionNodes(container, child, {
      nextActionId: params.nextActionId,
      sectionTitle: nextSectionTitle
    })
  )
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

function readBooleanProp(props: RuntimeHostProps, name: string, fallback: boolean): boolean {
  return typeof props[name] === "boolean" ? props[name] : fallback
}

function readStringProp(props: RuntimeHostProps, name: string): string | undefined {
  return typeof props[name] === "string" ? props[name] : undefined
}

function readStringArrayProp(props: RuntimeHostProps, name: string): string[] {
  return Array.isArray(props[name]) ? props[name].filter((item) => typeof item === "string") : []
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
  return directChildrenOfType(node, ExtensionHostElement.Visual)
    .filter((visual) => readStringProp(visual.props, "slot") === slot)
    .flatMap((visual) => serializeVisualChildren(visual.children))
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

  if (isSvgHostElement(child)) {
    return {
      children: directElementChildren(child)
        .filter(isSvgHostElement)
        .map((svgChild) => serializeSvgVisual(svgChild)),
      kind: "svg",
      props: createSvgProps(child.props),
      tagName: child.type
    }
  }

  return inlineVisual(serializeVisualChildren(child.children))
}

function serializeSvgVisual(node: RuntimeHostElementNode): ExtensionSvgVisualNode {
  return {
    children: directElementChildren(node)
      .filter(isSvgHostElement)
      .map((child) => serializeSvgVisual(child)),
    kind: "svg",
    props: createSvgProps(node.props),
    tagName: node.type
  }
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
