import React from "react";
import { renderToString } from "react-dom/server";
import PrerenderedPublicPageApp from "./components/PrerenderedPublicPageApp";
import {
  canonicalPath as affiliateCanonicalPath,
  canonicalUrl as affiliateCanonicalUrl,
  schemaGraph as affiliateSchemaGraph,
  seoDescription as affiliateSeoDescription,
  seoTitle as affiliateSeoTitle,
} from "./components/AffiliateProgramPage";
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
  [affiliateCanonicalPath]: {
    canonicalPath: affiliateCanonicalPath,
    canonicalUrl: affiliateCanonicalUrl,
    schemaGraph: affiliateSchemaGraph,
    seoDescription: affiliateSeoDescription,
    seoTitle: affiliateSeoTitle,
  },
};

export function render(pathname) {
  if (!routeMetadata[pathname]) {
    throw new Error(`No prerender app configured for ${pathname}`);
  }

  return renderToString(
    <React.StrictMode>
      <PrerenderedPublicPageApp route={pathname} />
    </React.StrictMode>,
  );
}
