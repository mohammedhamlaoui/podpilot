import React from "react";
import { renderToString } from "react-dom/server";
import PrerenderedRedbubbleAutomationToolApp from "./components/PrerenderedRedbubbleAutomationToolApp";
export {
  canonicalPath,
  canonicalUrl,
  schemaGraph,
  seoDescription,
  seoTitle,
} from "./components/RedbubbleAutomationToolPage";

export function render() {
  return renderToString(
    <React.StrictMode>
      <PrerenderedRedbubbleAutomationToolApp />
    </React.StrictMode>,
  );
}
