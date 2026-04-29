import { ChevronDown } from "lucide-react"

export function NativeExtensionSelect(props: {
  children: React.ReactNode
  className: string
  onChange: (value: string) => void
  value: string
}): React.JSX.Element {
  const { children, className, onChange, value } = props

  return (
    <div className="relative">
      <select
        className={className}
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
