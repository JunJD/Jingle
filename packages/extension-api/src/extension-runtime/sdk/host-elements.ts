export const ExtensionHostElement = {
  Action: "ow-action",
  ActionPanel: "ow-action-panel",
  ActionPanelSection: "ow-action-panel-section",
  ActionPanelSubmenu: "ow-action-panel-submenu",
  Detail: "ow-detail",
  DetailMetadata: "ow-detail-metadata",
  DetailMetadataLabel: "ow-detail-metadata-label",
  DetailMetadataLink: "ow-detail-metadata-link",
  DetailMetadataTagList: "ow-detail-metadata-tag-list",
  DetailMetadataTagListItem: "ow-detail-metadata-tag-list-item",
  Form: "ow-form",
  FormCheckbox: "ow-form-checkbox",
  FormDatePicker: "ow-form-date-picker",
  FormDropdown: "ow-form-dropdown",
  FormDropdownItem: "ow-form-dropdown-item",
  FormMessage: "ow-form-message",
  FormSeparator: "ow-form-separator",
  FormTagPicker: "ow-form-tag-picker",
  FormTagPickerItem: "ow-form-tag-picker-item",
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
  Image: "ow-image",
  Visual: "ow-visual"
} as const

export type ExtensionHostElementType =
  | (typeof ExtensionHostElement)[keyof typeof ExtensionHostElement]
  | string

export const ExtensionHostActionKind = {
  CopyToClipboard: "copy-to-clipboard",
  CreateQuicklink: "create-quicklink",
  OpenInBrowser: "open-in-browser",
  Paste: "paste",
  RunBotAgent: "run-bot-agent",
  SubmitForm: "submit-form"
} as const

export type ExtensionHostActionKindType =
  (typeof ExtensionHostActionKind)[keyof typeof ExtensionHostActionKind]
