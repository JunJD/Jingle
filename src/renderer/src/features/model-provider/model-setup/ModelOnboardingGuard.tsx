import { CircleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ModelSetupSurface } from "./ModelSetupSurface"
import { useModelSetupController } from "./useModelSetupController"

interface ModelOnboardingGuardProps {
  children: React.ReactNode
}

export function ModelOnboardingGuard(props: ModelOnboardingGuardProps): React.JSX.Element {
  const { children } = props
  const controller = useModelSetupController()

  if (controller.error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-[var(--ow-space-5)] text-foreground">
        <div className="flex w-full max-w-[420px] flex-col items-center text-center">
          <div className="mb-[var(--ow-space-4)] flex size-10 items-center justify-center rounded-full bg-status-critical/12 text-status-critical">
            <CircleAlert className="size-[var(--ow-icon-md)]" />
          </div>
          <h1 className="[font-size:var(--ow-font-title)] font-medium leading-[var(--ow-line-tight)]">
            模型配置检查失败
          </h1>
          <p className="mt-[var(--ow-space-2)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-body)] text-muted-foreground">
            无法读取模型提供商状态，请重试或打开开发者日志查看具体错误。
          </p>
          <div className="mt-[var(--ow-space-3)] max-w-full rounded-[var(--ow-radius-md)] bg-muted px-[var(--ow-space-3)] py-[var(--ow-space-2)] font-mono [font-size:var(--ow-font-meta)] leading-[var(--ow-line-meta)] text-muted-foreground">
            {controller.error}
          </div>
          <Button
            className="mt-[var(--ow-space-5)]"
            disabled={controller.loading}
            onClick={() => {
              void controller.reload()
            }}
            type="button"
          >
            重试
          </Button>
        </div>
      </div>
    )
  }

  if (controller.loading || !controller.snapshot) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        <div className="h-[var(--ow-shimmer-track-h)] w-[var(--ow-shimmer-track-w)] overflow-hidden rounded-full bg-muted">
          <div className="h-full w-[var(--ow-shimmer-thumb-w)] animate-[glide_1.2s_ease-in-out_infinite] rounded-full bg-foreground/55" />
        </div>
      </div>
    )
  }

  const snapshot = controller.snapshot
  const defaultProvider = snapshot.providers.find(
    (provider) => provider.id === snapshot.defaultModel.provider
  )
  if (!defaultProvider) {
    throw new Error(
      `Default model provider is missing from the setup snapshot: ${snapshot.defaultModel.provider}`
    )
  }
  if (defaultProvider.customConfiguration.status === "active") {
    return <>{children}</>
  }

  return (
    <ModelSetupSurface
      commands={controller.commands}
      snapshot={snapshot}
      title="欢迎使用金果"
      variant="onboarding"
    />
  )
}
