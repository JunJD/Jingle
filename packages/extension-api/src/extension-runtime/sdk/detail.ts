import { createElement, type ReactElement, type ReactNode } from "react"
import { ExtensionHostElement } from "./host-elements"
import { useRuntimeSurfaceNavigationProps } from "./context"
import { createVisualElement, type ColorLike, type IconLike } from "./visual"

export interface RuntimeDetailProps {
  actions?: ReactNode
  isLoading?: boolean
  markdown?: string
  metadata?: ReactNode
  navigationTitle: string
}

export interface RuntimeDetailMetadataProps {
  children?: ReactNode
}

export interface RuntimeDetailMetadataLabelProps {
  icon?: IconLike
  text: string
  title: string
}

export interface RuntimeDetailMetadataTagListProps {
  children?: ReactNode
  tags?: string[]
  title: string
}

export interface RuntimeDetailMetadataTagListItemProps {
  color?: ColorLike
  icon?: IconLike
  text: string
}

export interface RuntimeDetailMetadataLinkProps {
  target: string
  text: string
  title: string
}

type RuntimeDetailComponent = ((props: RuntimeDetailProps) => ReactElement) & {
  Metadata: ((props: RuntimeDetailMetadataProps) => ReactElement) & {
    Label: (props: RuntimeDetailMetadataLabelProps) => ReactElement
    Link: (props: RuntimeDetailMetadataLinkProps) => ReactElement
    TagList: ((props: RuntimeDetailMetadataTagListProps) => ReactElement) & {
      Item: (props: RuntimeDetailMetadataTagListItemProps) => ReactElement
    }
  }
}

function DetailRoot(props: RuntimeDetailProps): ReactElement {
  const { actions, metadata, ...hostProps } = props
  const navigationProps = useRuntimeSurfaceNavigationProps()

  return createElement(
    ExtensionHostElement.Detail,
    {
      ...hostProps,
      ...navigationProps
    },
    actions,
    metadata
  )
}

function DetailMetadata(props: RuntimeDetailMetadataProps): ReactElement {
  return createElement(ExtensionHostElement.DetailMetadata, null, props.children)
}

function DetailMetadataLabel(props: RuntimeDetailMetadataLabelProps): ReactElement {
  const { icon, ...hostProps } = props
  return createElement(
    ExtensionHostElement.DetailMetadataLabel,
    hostProps,
    createVisualElement("icon", icon)
  )
}

function DetailMetadataTagList(props: RuntimeDetailMetadataTagListProps): ReactElement {
  const { children, tags, ...hostProps } = props
  return createElement(
    ExtensionHostElement.DetailMetadataTagList,
    {
      ...hostProps,
      tags: tags ?? []
    },
    children
  )
}

function DetailMetadataTagListItem(props: RuntimeDetailMetadataTagListItemProps): ReactElement {
  const { icon, ...hostProps } = props
  return createElement(
    ExtensionHostElement.DetailMetadataTagListItem,
    hostProps,
    createVisualElement("icon", icon)
  )
}

function DetailMetadataLink(props: RuntimeDetailMetadataLinkProps): ReactElement {
  return createElement(ExtensionHostElement.DetailMetadataLink, props)
}

export const Detail: RuntimeDetailComponent = Object.assign(DetailRoot, {
  Metadata: Object.assign(DetailMetadata, {
    Label: DetailMetadataLabel,
    Link: DetailMetadataLink,
    TagList: Object.assign(DetailMetadataTagList, {
      Item: DetailMetadataTagListItem
    })
  })
})
