import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initExtensionAuthSync } from "./lib/extensionAuthBridge";
import "./index.css";

initExtensionAuthSync();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
