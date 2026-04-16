import { getArtifactTabId, useCurrentThread } from "@/lib/thread-context"
import { TabBar } from "./TabBar"
import { ArtifactViewer } from "./ArtifactViewer"
import { FileViewer } from "./FileViewer"
import { ChatContainer } from "@/components/chat/ChatContainer"

interface TabbedPanelProps {
  threadId: string
  showTabBar?: boolean
}

export function TabbedPanel({ threadId, showTabBar = true }: TabbedPanelProps): React.JSX.Element {
  const { activeTab, openArtifacts, openFiles } = useCurrentThread(threadId)

  // Determine what to render based on active tab
  const isAgentTab = activeTab === "agent"
  const activeFile = openFiles.find((f) => f.path === activeTab)
  const activeArtifact = openArtifacts.find(
    (artifact) => getArtifactTabId(artifact.artifactId) === activeTab
  )

  return (
    <div className="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden">
      {/* Tab Bar (optional - can be rendered externally in titlebar) */}
      {showTabBar && <TabBar threadId={threadId} />}

      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        {isAgentTab ? (
          <ChatContainer threadId={threadId} />
        ) : activeFile ? (
          // Use key to force remount when file changes, ensuring fresh state
          <FileViewer key={activeFile.path} filePath={activeFile.path} threadId={threadId} />
        ) : activeArtifact ? (
          <ArtifactViewer
            artifactId={activeArtifact.artifactId}
            key={activeArtifact.artifactId}
            threadId={threadId}
          />
        ) : (
          // Fallback - shouldn't happen but just in case
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            Select a tab to view content
          </div>
        )}
      </div>
    </div>
  )
}
