import { useEffect } from "react";

const BASE_URL = "https://podpilot.space";
const DEFAULT_IMAGE = `${BASE_URL}/brand/podpilot-og-v2.png`;
const SITE_NAME = "PodPilot";

/**
 * useSeo — sets per-page SEO metadata in the document <head>.
 *
 * @param {object} options
 * @param {string}  options.title          - Page title (appended with " | PodPilot")
 * @param {string}  options.description    - Meta description (max ~160 chars)
 * @param {string}  options.canonical      - Canonical URL path e.g. "/pricing"
 * @param {string}  [options.ogImage]      - Full OG image URL (default: OG logo)
 * @param {string}  [options.ogType]       - OG type (default: "website")
 * @param {boolean} [options.noindex]      - Set to true to noindex this page
 * @param {object}  [options.jsonLd]       - JSON-LD schema object or array to inject
 */
export function useSeo({ title, description, canonical, ogImage, ogType = "website", noindex = false, jsonLd } = {}) {
  useEffect(() => {
    const fullTitle = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
    const canonicalUrl = canonical ? `${BASE_URL}${canonical}` : BASE_URL;
    const image = ogImage || DEFAULT_IMAGE;
    const robotsContent = noindex ? "noindex, nofollow" : "index, follow";

    // ── Title ────────────────────────────────────────────────────────────────
    document.title = fullTitle;

    // ── Helpers ───────────────────────────────────────────────────────────────
    function setMeta(selector, attr, value) {
      let el = document.querySelector(selector);
      if (!el) {
        el = document.createElement("meta");
        if (attr === "name") el.setAttribute("name", selector.match(/name="([^"]+)"/)?.[1] || "");
        if (attr === "property") el.setAttribute("property", selector.match(/property="([^"]+)"/)?.[1] || "");
        document.head.appendChild(el);
      }
      el.setAttribute("content", value);
    }

    function setMetaName(name, content) {
      let el = document.querySelector(`meta[name="${name}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("name", name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    }

    function setMetaProp(property, content) {
      let el = document.querySelector(`meta[property="${property}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("property", property);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    }

    function setCanonical(href) {
      let el = document.querySelector("link[rel='canonical']");
      if (!el) {
        el = document.createElement("link");
        el.setAttribute("rel", "canonical");
        document.head.appendChild(el);
      }
      el.setAttribute("href", href);
    }

    // ── Core meta ─────────────────────────────────────────────────────────────
    if (description) setMetaName("description", description);
    setMetaName("robots", robotsContent);
    setCanonical(canonicalUrl);

    // ── Open Graph ────────────────────────────────────────────────────────────
    setMetaProp("og:type", ogType);
    setMetaProp("og:site_name", SITE_NAME);
    setMetaProp("og:url", canonicalUrl);
    if (title) setMetaProp("og:title", fullTitle);
    if (description) setMetaProp("og:description", description);
    setMetaProp("og:image", image);
    setMetaProp("og:image:alt", `${SITE_NAME} - ${title || "Upload Automation for Redbubble & TeePublic"}`);
    setMetaProp("og:image:width", "1200");
    setMetaProp("og:image:height", "630");

    // ── Twitter Card ──────────────────────────────────────────────────────────
    setMetaName("twitter:card", "summary_large_image");
    if (title) setMetaName("twitter:title", fullTitle);
    if (description) setMetaName("twitter:description", description);
    setMetaName("twitter:image", image);
    setMetaName("twitter:image:alt", `${SITE_NAME} - ${title || "Upload Automation"}`);

    // ── JSON-LD ───────────────────────────────────────────────────────────────
    const JSONLD_ID = "seo-jsonld-dynamic";
    let jsonLdEl = document.getElementById(JSONLD_ID);
    if (jsonLd) {
      if (!jsonLdEl) {
        jsonLdEl = document.createElement("script");
        jsonLdEl.id = JSONLD_ID;
        jsonLdEl.type = "application/ld+json";
        document.head.appendChild(jsonLdEl);
      }
      jsonLdEl.textContent = JSON.stringify(
        Array.isArray(jsonLd) ? { "@context": "https://schema.org", "@graph": jsonLd } : jsonLd,
        null,
        2
      );
    } else if (jsonLdEl) {
      jsonLdEl.remove();
    }
  }, [title, description, canonical, ogImage, ogType, noindex, jsonLd]);
}

export default useSeo;
