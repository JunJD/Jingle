import * as React from "react"
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"

const Collapsible = CollapsiblePrimitive.Root

const CollapsibleTrigger = CollapsiblePrimitive.Trigger

type CollapsibleContentProps = React.ComponentPropsWithRef<typeof CollapsiblePrimitive.Content>

function CollapsibleContent(props: CollapsibleContentProps): React.JSX.Element {
  return <CollapsiblePrimitive.Content {...props} />
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
