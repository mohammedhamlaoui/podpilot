import React from "react";
import { renderToString } from "react-dom/server";
import PrerenderedRedbubbleAutomationToolApp from "./components/PrerenderedRedbubbleAutomationToolApp";
import PrerenderedTeePublicAutomationToolApp from "./components/PrerenderedTeePublicAutomationToolApp";
import {
  canonicalPath as redbubbleCanonicalPath,
  canonicalUrl as redbubbleCanonicalUrl,
  schemaGraph as redbubbleSchemaGraph,
  seoDescription as redbubbleSeoDescription,
  seoTitle as redbubbleSeoTitle,
} from "./components/RedbubbleAutomationToolPage";
import {
  canonicalPath as teePublicCanonicalPath,
  canonicalUrl as teePublicCanonicalUrl,
  schemaGraph as teePublicSchemaGraph,
  seoDescription as teePublicSeoDescription,
  seoTitle as teePublicSeoTitle,
} from "./components/TeePublicAutomationToolPage";

export const routeMetadata = {
  [redbubbleCanonicalPath]: {
    canonicalPath: redbubbleCanonicalPath,
    canonicalUrl: redbubbleCanonicalUrl,
    schemaGraph: redbubbleSchemaGraph,
    seoDescription: redbubbleSeoDescription,
    seoTitle: redbubbleSeoTitle,
  },
  [teePublicCanonicalPath]: {
    canonicalPath: teePublicCanonicalPath,
    canonicalUrl: teePublicCanonicalUrl,
    schemaGraph: teePublicSchemaGraph,
    seoDescription: teePublicSeoDescription,
    seoTitle: teePublicSeoTitle,
  },
};

export function render(pathname) {
  const PrerenderedApp = pathname === teePublicCanonicalPath
    ? PrerenderedTeePublicAutomationToolApp
    : pathname === redbubbleCanonicalPath
      ? PrerenderedRedbubbleAutomationToolApp
      : null;

  if (!PrerenderedApp) {
    throw new Error(`No prerender app configured for ${pathname}`);
  }

  return renderToString(
    <React.StrictMode>
      <PrerenderedApp />
    </React.StrictMode>,
  );
}
