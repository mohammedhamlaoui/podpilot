import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build as viteBuild } from "vite";

const frontendRoot = path.resolve(import.meta.dirname, "..");
const distDir = path.join(frontendRoot, "dist");
const temporarySsrDir = path.join(frontendRoot, ".prerender-temp");
const ssrEntry = path.join(frontendRoot, "src", "prerender-entry.jsx");
const ssrBundle = path.join(temporarySsrDir, "prerender-entry.mjs");

function replaceRequired(html, pattern, replacement, label) {
  if (!pattern.test(html)) {
    throw new Error(`Could not find ${label} in the Vite HTML output.`);
  }
  return html.replace(pattern, replacement);
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function createPrerenderedHtml(routeModule, canonicalPath) {
  const {
    canonicalUrl,
    schemaGraph,
    seoDescription,
    seoTitle,
  } = routeModule.routeMetadata[canonicalPath];

  const renderedApp = routeModule.render(canonicalPath);
  const routeSchema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://podpilot.space/#organization",
        name: "PodPilot",
        url: "https://podpilot.space/",
        logo: "https://podpilot.space/brand/podpilot-logo-full.png",
      },
      ...schemaGraph,
    ],
  };
  const serializedSchema = JSON.stringify(routeSchema).replaceAll("<", "\\u003c");

  let html = await readFile(path.join(distDir, "index.html"), "utf8");
  html = replaceRequired(html, /<title>[\s\S]*?<\/title>/i, `<title>${seoTitle}</title>`, "page title");
  html = replaceRequired(
    html,
    /<meta\b(?=[^>]*\bname=["']description["'])[^>]*>/i,
    `<meta name="description" content="${escapeAttribute(seoDescription)}" />`,
    "meta description",
  );
  html = replaceRequired(
    html,
    /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i,
    `<link rel="canonical" href="${canonicalUrl}" />`,
    "canonical link",
  );
  html = replaceRequired(
    html,
    /<meta\b(?=[^>]*\bproperty=["']og:title["'])[^>]*>/i,
    `<meta property="og:title" content="${escapeAttribute(seoTitle)}" />`,
    "Open Graph title",
  );
  html = replaceRequired(
    html,
    /<meta\b(?=[^>]*\bproperty=["']og:description["'])[^>]*>/i,
    `<meta property="og:description" content="${escapeAttribute(seoDescription)}" />`,
    "Open Graph description",
  );
  html = replaceRequired(
    html,
    /<meta\b(?=[^>]*\bproperty=["']og:url["'])[^>]*>/i,
    `<meta property="og:url" content="${canonicalUrl}" />`,
    "Open Graph URL",
  );
  html = replaceRequired(
    html,
    /<meta\b(?=[^>]*\bname=["']twitter:title["'])[^>]*>/i,
    `<meta name="twitter:title" content="${escapeAttribute(seoTitle)}" />`,
    "Twitter title",
  );
  html = replaceRequired(
    html,
    /<meta\b(?=[^>]*\bname=["']twitter:description["'])[^>]*>/i,
    `<meta name="twitter:description" content="${escapeAttribute(seoDescription)}" />`,
    "Twitter description",
  );

  html = html.replace(/\s*<script\s+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>\s*/gi, "\n");
  html = replaceRequired(
    html,
    /<\/head>/i,
    `    <script id="seo-jsonld-dynamic" type="application/ld+json">${serializedSchema}</script>\n  </head>`,
    "closing head tag",
  );
  html = replaceRequired(
    html,
    /<div\s+id=["']root["'][^>]*><\/div>/i,
    `<div id="root" class="notranslate" translate="no" data-prerendered-route="${canonicalPath}">${renderedApp}</div>`,
    "React root element",
  );

  const routeOutputPath = path.join(distDir, `${canonicalPath.slice(1)}.html`);
  await writeFile(routeOutputPath, html, "utf8");
}

await viteBuild({ root: frontendRoot });

try {
  await viteBuild({
    root: frontendRoot,
    publicDir: false,
    build: {
      ssr: ssrEntry,
      outDir: temporarySsrDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: {
        output: {
          entryFileNames: "prerender-entry.mjs",
        },
      },
    },
  });

  const routeModule = await import(`${pathToFileURL(ssrBundle).href}?v=${Date.now()}`);
  for (const canonicalPath of Object.keys(routeModule.routeMetadata)) {
    await createPrerenderedHtml(routeModule, canonicalPath);
    console.log(`Prerendered ${canonicalPath}`);
  }
} finally {
  await rm(temporarySsrDir, { recursive: true, force: true });
}
