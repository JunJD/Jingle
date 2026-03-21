import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import LauncherApp from "./launcher/LauncherApp"
import "./index.css"

const windowKind = new URLSearchParams(window.location.search).get("window")
const RootComponent = windowKind === "launcher" ? LauncherApp : App

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
)
