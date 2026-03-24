import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import LauncherApp from "./launcher/LauncherApp"
import { ThreadProvider } from "./lib/thread-context"
import "./index.css"

const windowKind = new URLSearchParams(window.location.search).get("window")
const resolvedWindowKind = windowKind ?? "main"

document.documentElement.dataset.window = resolvedWindowKind
document.body.dataset.window = resolvedWindowKind

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {windowKind === "launcher" ? (
      <ThreadProvider>
        <LauncherApp />
      </ThreadProvider>
    ) : (
      <App />
    )}
  </React.StrictMode>
)
