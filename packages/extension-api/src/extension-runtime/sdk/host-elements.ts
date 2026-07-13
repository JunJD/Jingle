export const ExtensionHostElement = {
  Action: "jingle-action",
  ActionPanel: "jingle-action-panel",
  ActionPanelSection: "jingle-action-panel-section",
  ActionPanelSubmenu: "jingle-action-panel-submenu",
  Detail: "jingle-detail",
  DetailMetadata: "jingle-detail-metadata",
  DetailMetadataLabel: "jingle-detail-metadata-label",
  DetailMetadataLink: "jingle-detail-metadata-link",
  DetailMetadataTagList: "jingle-detail-metadata-tag-list",
  DetailMetadataTagListItem: "jingle-detail-metadata-tag-list-item",
  Form: "jingle-form",
  FormCheckbox: "jingle-form-checkbox",
  FormDatePicker: "jingle-form-date-picker",
  FormDropdown: "jingle-form-dropdown",
  FormDropdownItem: "jingle-form-dropdown-item",
  FormMessage: "jingle-form-message",
  FormSeparator: "jingle-form-separator",
  FormTagPicker: "jingle-form-tag-picker",
  FormTagPickerItem: "jingle-form-tag-picker-item",
  FormTextArea: "jingle-form-text-area",
  FormTextField: "jingle-form-text-field",
  List: "jingle-list",
  ListDropdown: "jingle-list-dropdown",
  ListDropdownItem: "jingle-list-dropdown-item",
  ListDropdownSection: "jingle-list-dropdown-section",
  ListEmptyView: "jingle-list-empty-view",
  ListItem: "jingle-list-item",
  ListSection: "jingle-list-section",
  MenuBarExtra: "jingle-menu-bar-extra",
  MenuBarExtraItem: "jingle-menu-bar-extra-item",
  MenuBarExtraSection: "jingle-menu-bar-extra-section",
  Image: "jingle-image",
  Visual: "jingle-visual"
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
