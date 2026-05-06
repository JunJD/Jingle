export const ExtensionHostElement = {
  Action: "ow-action",
  ActionPanel: "ow-action-panel",
  ActionPanelSection: "ow-action-panel-section",
  ActionPanelSubmenu: "ow-action-panel-submenu",
  Detail: "ow-detail",
  DetailMetadata: "ow-detail-metadata",
  DetailMetadataLabel: "ow-detail-metadata-label",
  DetailMetadataTagList: "ow-detail-metadata-tag-list",
  Form: "ow-form",
  FormCheckbox: "ow-form-checkbox",
  FormDropdown: "ow-form-dropdown",
  FormDropdownItem: "ow-form-dropdown-item",
  FormMessage: "ow-form-message",
  FormSeparator: "ow-form-separator",
  FormTextArea: "ow-form-text-area",
  FormTextField: "ow-form-text-field",
  List: "ow-list",
  ListDropdown: "ow-list-dropdown",
  ListDropdownItem: "ow-list-dropdown-item",
  ListDropdownSection: "ow-list-dropdown-section",
  ListEmptyView: "ow-list-empty-view",
  ListItem: "ow-list-item",
  ListSection: "ow-list-section",
  MenuBarExtra: "ow-menu-bar-extra",
  MenuBarExtraItem: "ow-menu-bar-extra-item",
  MenuBarExtraSection: "ow-menu-bar-extra-section",
  Visual: "ow-visual"
} as const

export type ExtensionHostElementType =
  | (typeof ExtensionHostElement)[keyof typeof ExtensionHostElement]
  | string

export const ExtensionHostActionKind = {
  CopyToClipboard: "copy-to-clipboard",
  OpenInBrowser: "open-in-browser"
} as const

export type ExtensionHostActionKindType =
  (typeof ExtensionHostActionKind)[keyof typeof ExtensionHostActionKind]
