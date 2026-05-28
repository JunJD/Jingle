import { ChevronDown } from "lucide-react"

export function NativeExtensionSelect(props: {
  autoFocus?: boolean
  children: React.ReactNode
  className: string
  onChange: (value: string) => void
  ref?: React.Ref<HTMLSelectElement>
  value: string
}): React.JSX.Element {
  const { autoFocus, children, className, onChange, ref, value } = props

  return (
    <div className="relative">
      <select
        autoFocus={autoFocus}
        className={className}
        ref={ref}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      >
        {children}
      </select>

      <div className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-muted-foreground">
        <ChevronDown className="h-3 w-3" />
      </div>
    </div>
  )
}
