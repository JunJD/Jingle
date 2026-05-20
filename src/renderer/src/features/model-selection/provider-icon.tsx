import { ProviderLogo } from "@/components/model-provider-logo"
import type { ProviderId } from "@/types"

export function ProviderIcon(props: {
  className?: string
  providerId: ProviderId
}): React.JSX.Element {
  const { className, providerId } = props

  return <ProviderLogo className={className} providerId={providerId} />
}
