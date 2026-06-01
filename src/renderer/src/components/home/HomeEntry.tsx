import { useState } from "react"
import { Plus, Sparkles, MessageSquare, Clock, Zap, BarChart3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { useI18n } from "@/lib/i18n"
import { formatRelativeTime } from "@/lib/utils"
import type { Thread } from "@/types"

interface QuickActionProps {
  icon: React.ReactNode
  title: string
  description: string
  onClick: () => void
}

function QuickAction({ icon, title, description, onClick }: QuickActionProps): React.JSX.Element {
  return (
    <Card
      className="cursor-pointer transition-all hover:shadow-md hover:border-primary/20"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start space-x-3">
          <div className="shrink-0 text-primary">{icon}</div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm font-medium leading-none">{title}</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardContent>
    </Card>
  )
}

function RecentThreadItem({
  thread,
  onSelect
}: {
  thread: Thread
  onSelect: () => void
}): React.JSX.Element {
  return (
    <div
      className="flex items-center space-x-3 p-3 rounded-lg hover:bg-accent/50 cursor-pointer transition-colors"
      onClick={onSelect}
    >
      <MessageSquare className="size-4 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">
          {thread.title || "Untitled conversation"}
        </div>
        <div className="text-xs text-muted-foreground">
          {formatRelativeTime(new Date(thread.updated_at))}
        </div>
      </div>
    </div>
  )
}

export function HomeEntry(): React.JSX.Element {
  const createThread = useHistoryShellStore((state) => state.createThread)
  const selectThread = useHistoryShellStore((state) => state.selectThread)
  const setShowKanbanView = useHistoryShellStore((state) => state.setShowKanbanView)
  const threads = useHistoryShellStore((state) => state.threads)
  const { copy } = useI18n()
  const [isCreating, setIsCreating] = useState(false)

  const recentThreads = [...threads]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 3)

  const handleCreateThread = async () => {
    setIsCreating(true)
    try {
      await createThread()
    } finally {
      setIsCreating(false)
    }
  }

  const handleSelectThread = (threadId: string) => {
    void selectThread(threadId)
  }

  const quickActions = [
    {
      icon: <Sparkles className="size-5" />,
      title: copy.chat.startConversation || "Start New Conversation",
      description: "Create a fresh thread to begin chatting",
      onClick: handleCreateThread
    },
    {
      icon: <BarChart3 className="size-5" />,
      title: "View Kanban Board",
      description: "Organize and track your tasks visually",
      onClick: () => setShowKanbanView(true)
    },
    {
      icon: <Zap className="size-5" />,
      title: "Quick Actions",
      description: "Access common tools and shortcuts",
      onClick: () => {
        // TODO: Implement quick actions modal/palette
      }
    }
  ]

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-4xl space-y-8">
        {/* Welcome Section */}
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="p-3 bg-primary/10 rounded-full">
              <Sparkles className="size-8 text-primary" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Welcome to Jingle</h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Your tactical agent interface for intelligent conversations and task management.
            </p>
          </div>
        </div>

        {/* Quick Actions Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {quickActions.map((action, index) => (
            <QuickAction key={index} {...action} />
          ))}
        </div>

        {/* Recent Threads */}
        {recentThreads.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Clock className="size-4 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Recent Conversations</h2>
            </div>
            <Card>
              <CardHeader>
                <div className="divide-y">
                  {recentThreads.map((thread) => (
                    <RecentThreadItem
                      key={thread.thread_id}
                      thread={thread}
                      onSelect={() => handleSelectThread(thread.thread_id)}
                    />
                  ))}
                </div>
              </CardHeader>
            </Card>
          </div>
        )}

        {/* Call to Action */}
        <div className="text-center pt-4">
          <Button
            size="lg"
            onClick={handleCreateThread}
            disabled={isCreating}
            className="min-w-[200px]"
          >
            {isCreating ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="size-4 mr-2" />
                Start Your First Conversation
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
