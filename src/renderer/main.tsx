import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { PlayerTimelinePreviewWindow } from "./components/PlayerTimelinePreviewWindow";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {window.videoManager?.windowMode === "timeline-preview" ? <PlayerTimelinePreviewWindow /> : <App />}
  </React.StrictMode>
);
