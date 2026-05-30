import {
  createElement,
  isValidElement,
  type ElementType,
  type ReactElement,
  type ReactNode
} from "react"
import {
  ArrowDownCircle,
  ArrowUpRight,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Circle,
  Dot,
  Eye,
  FileText,
  Globe,
  Hash,
  Link,
  List,
  Mail,
  PanelLeft,
  Paperclip,
  Phone,
  Pilcrow,
  Pin,
  PinOff,
  Plus,
  Search,
  Save,
  Sparkles,
  Trash2,
  Type,
  Upload,
  User,
  type LucideIcon
} from "lucide-react"
import { ExtensionHostElement } from "./host-elements"

export type RuntimeColorScheme = "dark" | "light"

export namespace Color {
  export type ColorLike = import("./visual").ColorLike
}

export namespace Image {
  export type ImageLike = import("./visual").ImageLikeInput
  export type Mask = import("./visual").ImageMask
  export type Source = import("./visual").ImageSource
}

export const Color = {
  Blue: "#0A84FF",
  Green: "#30D158",
  Orange: "#FF9F0A",
  Purple: "#BF5AF2",
  Red: "#FF453A",
  SecondaryText: "currentColor",
  Yellow: "#FFD60A"
} as const

export type ColorLike =
  | (typeof Color)[keyof typeof Color]
  | {
      dark?: string
      light?: string
    }
  | string

export type ResolvedColorLike = string

export const Image = {
  Mask: {
    Circle: "circle"
  }
} as const

export type ImageMask = (typeof Image.Mask)[keyof typeof Image.Mask]
export type ImageSource = ImageLike | ElementType | ReactNode | string
export interface ImageLike {
  mask?: ImageMask
  source: ImageSource
  tintColor?: ColorLike
  tooltip?: string
}

export type ImageLikeInput = ImageLike | ElementType | ReactNode | string | null | undefined
export type IconLike = ImageLikeInput

type RuntimeIconElement = ImageLikeInput
type StringVisualMode = "image" | "node"

const iconClassName = "h-4 w-4"

function createIcon(component: LucideIcon, label: string): RuntimeIconElement {
  const icon = createElement(component, {
    "aria-label": label,
    className: iconClassName
  })

  return createElement(
    ExtensionHostElement.Image,
    {
      value: {
        source: icon
      } satisfies ImageLike
    },
    icon
  )
}

export const Icon = {
  ArrowDownCircle: createIcon(ArrowDownCircle, "Arrow down"),
  ArrowNe: createIcon(ArrowUpRight, "Open"),
  BlankDocument: createIcon(FileText, "Document"),
  BulletPoints: createIcon(List, "List"),
  Calendar: createIcon(Calendar, "Calendar"),
  CheckCircle: createIcon(CheckCircle2, "Checked"),
  Checkmark: createIcon(Check, "Checkmark"),
  ChevronDown: createIcon(ChevronDown, "Down"),
  ChevronUp: createIcon(ChevronUp, "Up"),
  ChevronUpDown: createIcon(ChevronsUpDown, "Reorder"),
  Circle: createIcon(Circle, "Circle"),
  Dot: createIcon(Dot, "Dot"),
  Envelope: createIcon(Mail, "Email"),
  Eye: createIcon(Eye, "Preview"),
  Globe: createIcon(Globe, "Browser"),
  Hashtag: createIcon(Hash, "Number"),
  Link: createIcon(Link, "Link"),
  List: createIcon(List, "List"),
  MagnifyingGlass: createIcon(Search, "Search"),
  Paperclip: createIcon(Paperclip, "Attachment"),
  Paragraph: createIcon(Pilcrow, "Paragraph"),
  Person: createIcon(User, "Person"),
  Phone: createIcon(Phone, "Phone"),
  Pin: createIcon(Pin, "Pin"),
  PinDisabled: createIcon(PinOff, "Unpin"),
  Plus: createIcon(Plus, "Add"),
  QuestionMark: createIcon(Circle, "Question"),
  SaveDocument: createIcon(Save, "Save"),
  Sidebar: createIcon(PanelLeft, "Sidebar"),
  Stars: createIcon(Sparkles, "AI"),
  Text: createIcon(Type, "Text"),
  Trash: createIcon(Trash2, "Trash"),
  Upload: createIcon(Upload, "Upload")
} as const

export function normalizeVisual(
  node: IconLike | undefined,
  stringMode: StringVisualMode = "node"
): ReactNode {
  if (node === undefined || node === null || typeof node === "boolean") {
    return null
  }

  if (typeof node === "function") {
    return createElement(node)
  }

  if (typeof node === "string" && stringMode === "image") {
    return createImageElement({ source: node })
  }

  if (isImageLike(node)) {
    return createImageElement(node)
  }

  return node
}

function createImageElement(image: ImageLike): ReactElement {
  const tintColor = resolveColorLike(image.tintColor)
  const source = normalizeImageSource(image.source)

  return createElement(
    ExtensionHostElement.Image,
    {
      value: {
        ...image,
        source,
        tintColor
      } satisfies ImageLike
    },
    typeof source === "string" ? null : source
  )
}

export function createVisualElement(
  slot: string,
  node: IconLike | undefined,
  key?: string
): ReactElement | null {
  const visual = normalizeVisual(node, slot === "icon" ? "image" : "node")
  if (visual === null) {
    return null
  }

  return createElement(ExtensionHostElement.Visual, { key, slot }, visual)
}

function isImageLike(value: unknown): value is ImageLike {
  return value !== null && typeof value === "object" && !isValidElement(value) && "source" in value
}

export function resolveColorLike(
  color: ColorLike | undefined,
  scheme: RuntimeColorScheme = "light"
): ResolvedColorLike | undefined {
  if (color === undefined || typeof color === "string") {
    return color
  }

  return color[scheme] ?? color.light ?? color.dark
}

function normalizeImageSource(source: ImageSource): ReactNode | string {
  if (typeof source === "function") {
    return createElement(source)
  }

  if (source === undefined || source === null || typeof source === "boolean") {
    return null
  }

  return isImageLike(source) ? createImageElement(source) : source
}
