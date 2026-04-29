import { createElement, type ReactElement, type ReactNode } from "react"
import { ExtensionHostElement } from "./host-elements"
import { useRuntimeSurfaceNavigationProps } from "./context"

export interface RuntimeDetailProps {
  actions?: ReactNode
  isLoading?: boolean
  markdown?: string
  metadata?: ReactNode
  navigationTitle?: string
}

export interface RuntimeDetailMetadataProps {
  children?: ReactNode
}

export interface RuntimeDetailMetadataLabelProps {
  text: string
  title: string
}

export interface RuntimeDetailMetadataTagListProps {
  tags: string[]
  title: string
}

type RuntimeDetailComponent = ((props: RuntimeDetailProps) => ReactElement) & {
  Metadata: ((props: RuntimeDetailMetadataProps) => ReactElement) & {
    Label: (props: RuntimeDetailMetadataLabelProps) => ReactElement
    TagList: (props: RuntimeDetailMetadataTagListProps) => ReactElement
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
  return createElement(ExtensionHostElement.DetailMetadataLabel, props)
}

function DetailMetadataTagList(props: RuntimeDetailMetadataTagListProps): ReactElement {
  return createElement(ExtensionHostElement.DetailMetadataTagList, props)
}

export const Detail: RuntimeDetailComponent = Object.assign(DetailRoot, {
  Metadata: Object.assign(DetailMetadata, {
    Label: DetailMetadataLabel,
    TagList: DetailMetadataTagList
  })
})
