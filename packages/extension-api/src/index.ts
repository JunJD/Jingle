import * as extensionRuntimeSdkModule from "../../../src/extension-runtime/sdk"
import * as nativeExtensionContractsModule from "../../../src/shared/native-extensions"
import * as extensionRuntimeContractsModule from "../../../src/extensions/runtime-contract"
import * as extensionRuntimeMetadataContractsModule from "../../../src/extensions/runtime-metadata-contract"

const extensionRuntimeSdk = resolveRuntimeModule(
  extensionRuntimeSdkModule
) as typeof import("../../../src/extension-runtime/sdk")
const nativeExtensionContracts = resolveRuntimeModule(
  nativeExtensionContractsModule
) as typeof import("../../../src/shared/native-extensions")
const extensionRuntimeContracts = resolveRuntimeModule(
  extensionRuntimeContractsModule
) as typeof import("../../../src/extensions/runtime-contract")
const extensionRuntimeMetadataContracts = resolveRuntimeModule(
  extensionRuntimeMetadataContractsModule
) as typeof import("../../../src/extensions/runtime-metadata-contract")

function resolveRuntimeModule<TModule extends object>(module: TModule): TModule {
  const record = module as Record<string, unknown>
  return (record.default ?? record["module.exports"] ?? module) as TModule
}

export const AI = extensionRuntimeSdk.AI
export const Alert = extensionRuntimeSdk.Alert
export const Action = extensionRuntimeSdk.Action
export const ActionPanel = extensionRuntimeSdk.ActionPanel
export const Clipboard = extensionRuntimeSdk.Clipboard
export const Color = extensionRuntimeSdk.Color
export const Detail = extensionRuntimeSdk.Detail
export const Form = extensionRuntimeSdk.Form
export const Icon = extensionRuntimeSdk.Icon
export const Image = extensionRuntimeSdk.Image
export const Keyboard = extensionRuntimeSdk.Keyboard
export const List = extensionRuntimeSdk.List
export const LocalStorage = extensionRuntimeSdk.LocalStorage
export const MenuBarExtra = extensionRuntimeSdk.MenuBarExtra
export const OAuth = extensionRuntimeSdk.OAuth
export const PopToRootType = extensionRuntimeSdk.PopToRootType
export const Toast = extensionRuntimeSdk.Toast
export const closeMainWindow = extensionRuntimeSdk.closeMainWindow
export const confirmAlert = extensionRuntimeSdk.confirmAlert
export const createExtensionRuntimeLaunchProps =
  extensionRuntimeSdk.createExtensionRuntimeLaunchProps
export const createNativeExtensionClient = extensionRuntimeSdk.createNativeExtensionClient
export const createExtensionClient = extensionRuntimeSdk.createNativeExtensionClient
export const defineNativeExtensionClientMethod =
  extensionRuntimeSdk.defineNativeExtensionClientMethod
export const defineExtensionClientMethod = extensionRuntimeSdk.defineNativeExtensionClientMethod
export const getConnectionSecret = extensionRuntimeSdk.getConnectionSecret
export const getSelectedText = extensionRuntimeSdk.getSelectedText
export const getPreferenceValues = extensionRuntimeSdk.getPreferenceValues
export const open = extensionRuntimeSdk.open
export const openExternal = extensionRuntimeSdk.openExternal
export const openNativeExtensionSettings = extensionRuntimeSdk.openNativeExtensionSettings
export const runWithExtensionRuntimeSdk = extensionRuntimeSdk.runWithExtensionRuntimeSdk
export const showToast = extensionRuntimeSdk.showToast
export const useCommandSeedQuery = extensionRuntimeSdk.useCommandSeedQuery
export const useExtensionStorageState = extensionRuntimeSdk.useExtensionStorageState
export const useInterval = extensionRuntimeSdk.useInterval
export const useNavigation = extensionRuntimeSdk.useNavigation
export const useNativeCommandPreferences = extensionRuntimeSdk.useNativeCommandPreferences
export const useNativeExtensionNavigation = extensionRuntimeSdk.useNativeExtensionNavigation
export const useRuntimeAppLocale = extensionRuntimeSdk.useRuntimeAppLocale
export const writeClipboardText = extensionRuntimeSdk.writeClipboardText

export namespace Action {
  export type CopyToClipboard = extensionRuntimeSdkModule.Action.CopyToClipboard
  export type Paste = extensionRuntimeSdkModule.Action.Paste

  export namespace CreateQuicklink {
    export type Props = extensionRuntimeSdkModule.Action.CreateQuicklink.Props
  }
}

export namespace Form {
  export type DatePickerType = extensionRuntimeSdkModule.Form.DatePickerType
  export type ItemProps<TValue = Value> = extensionRuntimeSdkModule.Form.ItemProps<TValue>
  export type Value = extensionRuntimeSdkModule.Form.Value
  export type Values<TValue = Value> = extensionRuntimeSdkModule.Form.Values<TValue>
}

export namespace Color {
  export type ColorLike = extensionRuntimeSdkModule.Color.ColorLike
}

export namespace Image {
  export type ImageLike = extensionRuntimeSdkModule.Image.ImageLike
  export type Mask = extensionRuntimeSdkModule.Image.Mask
  export type Source = extensionRuntimeSdkModule.Image.Source
}

export namespace Keyboard {
  export type Shortcut = extensionRuntimeSdkModule.Keyboard.Shortcut
}

export namespace List {
  export namespace Item {
    export type Accessory = extensionRuntimeSdkModule.List.Item.Accessory
  }
}

export type {
  ExtensionRuntimeHostRequestInput,
  ExtensionRuntimeNavigation,
  ExtensionRuntimeSdkContextValue,
  RuntimeAiAskInput,
  RuntimeAlertAction,
  RuntimeAlertActionStyle,
  RuntimeConfirmAlertOptions,
  CloseMainWindowOptions,
  LaunchProps,
  RuntimeKeyboardModifier,
  RuntimeKeyboardShortcut,
  RuntimeKeyboardShortcutPlatform,
  RuntimeActionPanelProps,
  RuntimeActionPanelSectionProps,
  RuntimeActionProps,
  RuntimeActionStyle,
  RuntimeCreateQuicklinkActionProps,
  RuntimeCreateQuicklinkActionQuicklink,
  RuntimeCreateQuicklinkActionShortcut,
  RuntimeCopyToClipboardActionProps,
  RuntimeClipboardContent,
  RuntimePasteActionProps,
  RuntimePushActionProps,
  RuntimeSubmitFormActionProps,
  RuntimeSubmitFormValues,
  RuntimeDetailMetadataLabelProps,
  RuntimeDetailMetadataLinkProps,
  RuntimeDetailMetadataProps,
  RuntimeDetailMetadataTagListItemProps,
  RuntimeDetailMetadataTagListProps,
  RuntimeDetailProps,
  RuntimeFormCheckboxProps,
  RuntimeFormDatePickerProps,
  RuntimeFormDescriptionProps,
  RuntimeFormDropdownItemProps,
  RuntimeFormDropdownProps,
  RuntimeFormFieldProps,
  RuntimeFormMessageProps,
  RuntimeFormProps,
  RuntimeFormTagPickerItemProps,
  RuntimeFormTagPickerProps,
  RuntimeFormTextAreaProps,
  RuntimeFormTextFieldProps,
  RuntimeToastAction,
  RuntimeToastOptions,
  RuntimeToastStyle,
  ColorLike,
  IconLike,
  ImageLike,
  ImageLikeInput,
  ImageMask,
  ImageSource,
  ResolvedColorLike,
  RuntimeColorScheme,
  RuntimeListDropdownItemProps,
  RuntimeListDropdownProps,
  RuntimeListDropdownSectionProps,
  RuntimeListEmptyViewProps,
  RuntimeListItemAccessory,
  RuntimeListItemIcon,
  RuntimeListItemProps,
  RuntimeListPagination,
  RuntimeListProps,
  RuntimeListSectionProps,
  RuntimeMenuBarExtraItemProps,
  RuntimeMenuBarExtraProps,
  RuntimeMenuBarExtraSectionProps,
  RuntimeOAuthPKCEClientOptions,
  LocalStorageValue,
  RuntimeOpenInBrowserActionProps,
  RuntimeOpenApplication
} from "../../../src/extension-runtime/sdk"

export const defineNativeExtensionManifest = nativeExtensionContracts.defineNativeExtensionManifest
export const defineNativeExtensionMain = nativeExtensionContracts.defineNativeExtensionMain
export { defineNativeExtensionService } from "./main"

export type {
  NativeExtensionAiCapability,
  NativeExtensionCommandManifest,
  NativeExtensionCommandMode,
  NativeExtensionCommandSettingsSchema,
  NativeExtensionConnectionManifest,
  NativeExtensionConnectionStatus,
  NativeExtensionExecutionContext,
  NativeExtensionIcon,
  NativeExtensionInvokeContext,
  NativeExtensionInvokeRequest,
  NativeExtensionMainDefinition,
  NativeExtensionOAuthRedirectManifest,
  NativeExtensionPackageManifest,
  NativeExtensionPreferenceSchema,
  NativeExtensionResolvedConnection,
  NativeExtensionRuntimeCommandManifest,
  NativeExtensionService,
  NativeExtensionSupportedPlatform
} from "../../../src/shared/native-extensions"

export type { IpcErrorCode, IpcErrorPayload } from "../../../src/shared/ipc-error"

export type {
  ExtensionToolApprovalDefinition,
  ExtensionToolAccess,
  ExtensionToolConfirmation,
  ExtensionToolConfirmationBuilder,
  ExtensionToolConfirmationContext,
  ExtensionToolConfirmationFact,
  ExtensionToolConfirmationInfoFact,
  ExtensionToolContext,
  ExtensionToolDefinition
} from "../../../src/shared/extension-sources"

export const defineNativeExtensionRuntime = extensionRuntimeContracts.defineNativeExtensionRuntime

export type {
  NativeExtensionRuntimeCommandEntry,
  NativeExtensionRuntimeCommandDefinition,
  NativeExtensionRuntimeMenuBarCommandDefinition,
  NativeExtensionRuntimeNoViewCommandDefinition,
  NativeExtensionRuntimeNoViewRunContext,
  NativeExtensionRuntimePackage,
  NativeExtensionRuntimeViewCommandDefinition
} from "../../../src/extensions/runtime-contract"

export const defineNativeExtensionRuntimeMetadata =
  extensionRuntimeMetadataContracts.defineNativeExtensionRuntimeMetadata

export type {
  NativeExtensionRuntimeCommandMetadata,
  NativeExtensionRuntimePackageMetadata
} from "../../../src/extensions/runtime-metadata-contract"
