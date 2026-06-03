import sys
import os

filepath = r"c:\Users\dynast\Desktop\chofi bntk\my project autmation\extension\content-teepublic.js"

# Let's read the file content
with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# The original uncorrupted upload automation code is the first 1434 lines (0-indexed 0 to 1433)
# We know the first 1434 lines are perfect, but wait! Since our previous run of restore_teepublic.py
# might have written back a file, let's check how many lines it has and where runUpload is.
# Wait! Let's look for "ping" or "runUpload" to find where to split the intact code.
# Let's search the file lines to find where the uncorrupted part ends.

full_text = "".join(lines)
split_token = "      runUpload(design).then((result) => {"
if split_token not in full_text:
    # If the file got corrupted/truncated, let's split by tp_fill_and_publish
    split_token = "    if (message.action === 'tp_fill_and_publish') {"

parts = full_text.split(split_token)
intact_code = parts[0] + split_token + "\\n"

# The listener and auto-boot block:
listener_and_autoboot = """        chrome.runtime.sendMessage({
          action: 'upload_result',
          design_id: design.id || design.design_id,
          status: result.status,
          error_message: result.error || '',
          published_url: result.url || '',
        }, () => { void chrome.runtime.lastError; });
        sendResponse(result);
      }).catch((err) => {
        const errorResult = { status: 'error', error: err?.message || String(err) };
        chrome.runtime.sendMessage({
          action: 'upload_result',
          design_id: design.id || design.design_id,
          status: 'error',
          error_message: errorResult.error,
        }, () => { void chrome.runtime.lastError; });
        sendResponse(errorResult);
      });

      return true; // async response
    }

    if (message.action === 'tp_stop') {
      isStopped = true;
      isPaused = false;
      updateOverlayStatus();
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'tp_pause') {
      isPaused = true;
      updateOverlayStatus();
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'tp_resume') {
      isPaused = false;
      updateOverlayStatus();
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'queue_complete') {
      const summary = message.summary;
      if (summary) {
        showCompletionOverlay(summary.success || 0, summary.total || 0);
      }
      sendResponse({ ok: true });
      return;
    }
  });

  // ─── Auto-boot for ?auto=1 ─────────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  if (params.get('auto') === '1') {
    createOverlay();
    updateOverlay('Preparing upload...', 'Waiting for background to send design data', 5);

    // Notify background that the TeePublic page is ready
    setTimeout(() => {
      chrome.runtime.sendMessage(
        { action: 'tp_tab_ready' },
        () => { void chrome.runtime.lastError; }
      );
    }, 1000);
  }
"""

# The rebranding block containing all the premium features in purple PodPilot theme:
rebranding_block = """
  // ─── TeePublic Date Badge, Tags Copy, Circular Buttons & Client-Side Age Sorting (PodPilot Purple Style) ───
  let f = "none";
  let b = [];

  function h() {
    let e = window.location.href;
    return e.includes("/user/") || e.includes("/account/");
  }

  function c(e) {
    for (let t of [/\/v(\d{10,})\/production\/designs\//, /\/designs\/\d+_\d+\/(\d{10,})\//, /\/designs\/\d+\/(\d{10,})\//, /\/(\d{10,})$/, /_(\d{10,})_/, /_(\d{10,})$/, /(\d{10,})/]) {
      let o = e.match(t);
      if (o) {
        let e = parseInt(o[1]);
        if (e > 946684800) return e;
      }
    }
    return null;
  }

  function d(e) {
    let t = e.querySelector('a[href*="/designs/"]');
    if (t && t.href) {
      let e = c(t.href);
      if (e) return e;
    }
    let o = [
      e.querySelector('a[href*="/mug/"]'),
      e.querySelector('a[href*="/t-shirt/"]'),
      e.querySelector('a[href*="/hoodie/"]'),
      e.querySelector('a[href*="/hat/"]'),
      e.querySelector('a[href*="/sticker/"]'),
      e.querySelector('a[data-action*="product-clicked"]')
    ];
    for (let e of o) {
      if (e && e.href) {
        let t = c(e.href);
        if (t) return t;
      }
    }
    let a = e.querySelector(".tp-design-tile__image");
    if (a && a.src) {
      let t = c(a.src);
      if (t && t > 1e9) return t;
      let o = u(a.src);
      if (o) {
        let t = document.querySelectorAll(".tp-design-tile");
        for (let a of t) {
          if (a === e) continue;
          let t = a.querySelector(".tp-design-tile__image");
          if (t && t.src) {
            let e = u(t.src);
            if (e === o) {
              let e = c(t.src);
              if (e && e > 1e9) return e;
            }
          }
        }
      }
    }
    return null;
  }

  function u(e) {
    let t = e.match(/\/designs\/(\d+)_\d+/);
    if (t) return t[1];
    let o = e.match(/\/designs\/(\d+)/);
    return o ? o[1] : null;
  }

  function p(e) {
    let t = new Date(1e3 * e);
    let o = t.getUTCFullYear();
    let a = String(t.getUTCMonth() + 1).padStart(2, "0");
    let r = String(t.getUTCDate()).padStart(2, "0");
    let n = String(t.getUTCHours()).padStart(2, "0");
    let s = String(t.getUTCMinutes()).padStart(2, "0");
    let i = String(t.getUTCSeconds()).padStart(2, "0");
    return `${o}/${a}/${r} ${n}:${s}:${i} GMT`;
  }

  function m() {
    try {
      let e = window.scrollY || window.pageYOffset;
      let t = document.querySelectorAll(".tp-design-tile");
      if (0 === b.length && t.length > 0) {
        b = Array.from(t);
      }
      
      let o = document.querySelector(".podpilot-best-keywords");
      if (!o) {
        (function(e = false) {
          if (h()) return;
          let t = document.querySelector(".podpilot-keywords-container");
          if (!t) return;
          let o = t.querySelector(".podpilot-best-keywords");
          if (o && !e) return;
          let a = window.scrollY || window.pageYOffset;
          if (o) o.remove();
          w(t);
          requestAnimationFrame(() => {
            window.scrollTo(0, a);
          });
        })(true);
      }

      t.forEach((e) => {
        try {
          if (e.hasAttribute("data-podpilot-processed")) return;
          if (e.closest(".m-also-available-products") || e.closest(".m-recently-viewed-designs__contain") || e.closest(".jsRecentlyViewedDesigns")) {
            e.setAttribute("data-podpilot-processed", "true");
            return;
          }
          e.setAttribute("data-podpilot-processed", "true");
          let t = e.querySelector(".tp-design-tile__image");
          if (t && t.src || (t = e.querySelector('img[src*="images.teepublic.com"]')),
              t && t.src || (t = e.querySelector('img[src*="/designs/"]')),
              !t || !t.src) {
            let o = e.querySelectorAll("img");
            for (let e of o) {
              let o = e.src;
              if (o && o.includes("images.teepublic.com") && o.includes("/designs/")) {
                t = e;
                break;
              }
            }
          }
          if (!t || !t.src) return;
          let o = d(e);
          if (!o) return;
          let a = p(o);
          (function(e, t) {
            if (e.querySelector(".podpilot-publish-date")) return;
            let o = document.createElement("div");
            o.className = "podpilot-publish-date";
            o.textContent = t;
            let a = e.querySelector(".tp-design-tile__image-wrap");
            if (a) {
              if (!a.style.position || "static" === a.style.position || "" === a.style.position) {
                a.style.position = "relative";
              }
              if (!a.style.overflow || "hidden" === a.style.overflow) {
                a.style.overflow = "visible";
              }
              a.appendChild(o);
            }
          })(e, a);
        } catch (_) {}
      });
      requestAnimationFrame(() => {
        window.scrollTo(0, e);
      });
    } catch (_) {}
  }

  function g() {
    try {
      if (document.querySelector(".podpilot-product-date-badge") || document.querySelector(".podpilot-product-circular-btns")) return;
      let e = document.querySelector(".glide__slide--active") || document.querySelector('.glide__slide[data-default="active"]');
      if (!e) return;
      let t = window.location.href;
      let o = c(t);
      if (!o) {
        let e = document.querySelector(".jsProductMainImage");
        if (e && e.src) {
          o = c(e.src);
        }
        if (!o) return;
      }
      let a = p(o);
      let r = document.createElement("div");
      r.className = "podpilot-product-date-badge";
      r.textContent = a;
      Object.assign(r.style, {
        position: "absolute",
        top: "12px",
        left: "12px",
        background: "#EDE9FE",
        color: "#4C1D95",
        padding: "6px 12px",
        borderRadius: "6px",
        fontSize: "11px",
        fontWeight: "600",
        zIndex: "10",
        boxShadow: "0 2px 8px rgba(139, 92, 246, 0.4)",
        border: "1px solid #8B5CF6",
        letterSpacing: "0.3px"
      });
      if (!e.style.position || "static" === e.style.position) {
        e.style.position = "relative";
      }
      e.appendChild(r);

      // Add tag copying circular buttons on product page next to Favorite button
      let nBtn = document.querySelector(".tp-social-button--favorite") || document.querySelector('[data-action*="favorite"]') || document.querySelector(".m-product-actions__favorite") || document.querySelector('[class*="favorite"]');
      if (!nBtn) return;

      let sContainer = document.createElement("div");
      sContainer.className = "podpilot-product-circular-btns";
      sContainer.style.cssText = `
        display: flex;
        gap: 8px;
        margin-left: 8px;
      `;

      let iBtn = document.createElement("button");
      iBtn.className = "podpilot-circular-btn podpilot-copy-tags-btn";
      iBtn.innerHTML = '<span class="podpilot-btn-icon">📋</span>';
      iBtn.title = "Copy Tags";
      iBtn.style.cssText = `
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: none;
        background: linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 2px 6px rgba(124, 58, 237, 0.3);
      `;

      iBtn.onclick = async ev => {
        ev.preventDefault();
        ev.stopPropagation();
        iBtn.disabled = true;
        let originalHtml = iBtn.innerHTML;
        iBtn.innerHTML = '<span class="podpilot-btn-icon">⏳</span>';
        
        let meta = (function() {
          let h1 = document.querySelector("h1.h__h1--sm");
          let h2 = document.querySelector("h2.m-design-details__primary-tag");
          let pDesc = document.querySelector("p.m-design-details__description-text");
          let tags = document.querySelectorAll(".gtmDesignersAppliedTag");
          return {
            title: h1?.textContent?.trim() || "",
            mainTag: h2?.textContent?.trim() || "",
            description: pDesc?.textContent?.trim() || "",
            tags: Array.from(tags).map(el => el.textContent?.trim() || "").filter(Boolean),
            url: window.location.href
          };
        })();

        let ok = await k(meta.tags);
        if (ok) {
          iBtn.innerHTML = '<span class="podpilot-btn-icon">✓</span>';
          iBtn.style.background = "linear-gradient(135deg, #10b981 0%, #059669 100%)";
          setTimeout(() => {
            iBtn.innerHTML = originalHtml;
            iBtn.style.background = "linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)";
            iBtn.disabled = false;
          }, 1500);
        } else {
          iBtn.innerHTML = '<span class="podpilot-btn-icon">✗</span>';
          setTimeout(() => {
            iBtn.innerHTML = originalHtml;
            iBtn.disabled = false;
          }, 1500);
        }
      };

      iBtn.onmouseover = () => {
        iBtn.style.transform = "scale(1.1)";
        iBtn.style.boxShadow = "0 4px 12px rgba(124, 58, 237, 0.5)";
      };
      iBtn.onmouseout = () => {
        iBtn.style.transform = "scale(1)";
        iBtn.style.boxShadow = "0 2px 6px rgba(124, 58, 237, 0.3)";
      };

      sContainer.appendChild(iBtn);
      let pNode = nBtn.parentElement;
      if (pNode) {
        let act = pNode.querySelector(".m-product-preview__actions-container") || pNode;
        if (act) {
          act.style.display = "flex";
          act.style.alignItems = "center";
          act.style.gap = "8px";
          nBtn.parentNode?.insertBefore(sContainer, nBtn.nextSibling);
        }
      }
    } catch (_) {}
  }

  let _ = ["Kids Long Sleeve T-Shirt", "Long Sleeve T-Shirt", "Baseball Tee", "Kids Hoodie", "Kids T-Shirt", "Wall Art", "Tapestries", "Stickers", "Crewneck", "Pillows", "Magnets", "Apparel", "Shorts", "Totes", "Mugs", "Cases", "Pins", "Socks", "Bags", "Hats", "T-Shirt", "Hoodie", "Tank", "Kids"].sort((e, t) => t.length - e.length);
  
  function x(e) {
    if (!e || "string" != typeof e) return e;
    let t = e.trim();
    let o = e => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (let e of _) {
      let a = RegExp(`(?:^|[\\s,\\-])${o(e)}(?=[\\s,\\-]|$)`, "gi");
      t = t.replace(a, "").trim();
    }
    return t.replace(/\s\s+/g, " ").replace(/^[\s,\-]+|[\s,\-]+$/g, "").trim();
  }

  async function k(e) {
    try {
      let t = (Array.isArray(e) ? e : []).map(e => x(e)).filter(e => e.length > 0);
      let o = t.join(", ");
      await navigator.clipboard.writeText(o);
      return true;
    } catch (e) {
      console.error("Error copying tags:", e);
      return false;
    }
  }

  async function P(e) {
    try {
      let t = await fetch(e);
      let o = await t.text();
      let a = new DOMParser();
      let r = a.parseFromString(o, "text/html");
      let n = r.querySelector(".m-search__related-results");
      let s = n ? n.querySelectorAll(".gtmDesignersAppliedTag") : r.querySelectorAll(".gtmDesignersAppliedTag");
      let i = Array.from(s).map(e => e.textContent?.trim() || "").filter(Boolean);
      return i;
    } catch (e) {
      return [];
    }
  }

  function w(e) {
    try {
      if (h()) return;
      let t = document.querySelectorAll(".tp-design-tile");
      let o = Array.from(t).filter(e => !e.closest(".m-recently-viewed-designs__contain") && !e.closest(".jsRecentlyViewedDesigns"));
      if (0 === o.length) return;
      let a = {};
      let r = 0;
      o.forEach(e => {
        let t = e.querySelector(".tp-design-tile__seo-secondary-tags");
        if (t) {
          let e = t.textContent || "";
          let o = e.replace(/^Tags:\s*/i, "").split(",").map(e => e.trim().toLowerCase().replace(/^tags:\s*/i, "").replace(/\btags:\s*/gi, "").trim()).filter(e => e.length > 0 && "tags" !== e && "tags:" !== e && "tag" !== e && !e.startsWith("tags"));
          o.forEach(e => {
            let t = x(e);
            if (t && t.length > 2) {
              a[t] = (a[t] || 0) + 1;
              r++;
            }
          });
        }
      });
      let n = Object.entries(a).sort((e, t) => t[1] !== e[1] ? t[1] - e[1] : e[0].localeCompare(t[0])).slice(0, 13);
      if (0 === n.length) return;
      let s = document.createElement("div");
      s.className = "podpilot-best-keywords";
      s.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        min-width: 0;
      `;
      let i = document.createElement("div");
      i.style.cssText = `
        font-size: 13px;
        font-weight: 700;
        color: #374151;
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      `;
      i.innerHTML = '<span style="font-size: 16px;">🔥</span> Best Tags';
      let l = document.createElement("div");
      l.style.cssText = `
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        max-height: 80px;
        overflow-y: auto;
        overflow-x: hidden;
        padding-right: 4px;
      `;
      let cStyle = document.createElement("style");
      cStyle.textContent = `
        .podpilot-best-keywords div::-webkit-scrollbar {
          width: 6px;
        }
        .podpilot-best-keywords div::-webkit-scrollbar-track {
          background: #f3f4f6;
          border-radius: 3px;
        }
        .podpilot-best-keywords div::-webkit-scrollbar-thumb {
          background: #d1d5db;
          border-radius: 3px;
        }
        .podpilot-best-keywords div::-webkit-scrollbar-thumb:hover {
          background: #9ca3af;
        }
      `;
      document.head.appendChild(cStyle);
      
      n.forEach(([e, tCount], idx) => {
        let btn = document.createElement("button");
        btn.textContent = e;
        btn.title = `Click to copy "${e}"`;
        btn.style.cssText = `
          padding: 6px 12px;
          background: ${idx < 3 ? "#EDE9FE" : "#f3f4f6"};
          color: ${idx < 3 ? "#4C1D95" : "#374151"};
          border: 1px solid ${idx < 3 ? "#8B5CF6" : "#d1d5db"};
          border-radius: 6px;
          font-size: 12px;
          font-weight: ${idx < 3 ? "600" : "500"};
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
          flex-shrink: 0;
        `;
        btn.onclick = async () => {
          await navigator.clipboard.writeText(e);
          let txt = btn.textContent;
          btn.textContent = "✓ Copied!";
          btn.style.background = "#dcfce7";
          btn.style.borderColor = "#86efac";
          btn.style.color = "#15803d";
          setTimeout(() => {
            btn.textContent = txt;
            btn.style.background = idx < 3 ? "#EDE9FE" : "#f3f4f6";
            btn.style.borderColor = idx < 3 ? "#8B5CF6" : "#d1d5db";
            btn.style.color = idx < 3 ? "#4C1D95" : "#374151";
          }, 1000);
        };
        btn.onmouseover = () => {
          btn.style.transform = "translateY(-2px)";
          btn.style.boxShadow = "0 4px 8px rgba(139, 92, 246, 0.15)";
        };
        btn.onmouseout = () => {
          btn.style.transform = "translateY(0)";
          btn.style.boxShadow = "none";
        };
        l.appendChild(btn);
      });

      let copyAllBtn = document.createElement("button");
      copyAllBtn.textContent = "Copy All";
      copyAllBtn.title = "Copy all tags";
      copyAllBtn.style.cssText = `
        padding: 6px 12px;
        background: #7C3AED;
        color: white;
        border: 1px solid #6D28D9;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
        flex-shrink: 0;
      `;
      copyAllBtn.onclick = async () => {
        let tagStr = n.map(([e]) => e).join(", ");
        await navigator.clipboard.writeText(tagStr);
        let txt = copyAllBtn.textContent;
        copyAllBtn.textContent = "✓ Copied!";
        copyAllBtn.style.background = "#10b981";
        copyAllBtn.style.borderColor = "#059669";
        setTimeout(() => {
          copyAllBtn.textContent = txt;
          copyAllBtn.style.background = "#7C3AED";
          copyAllBtn.style.borderColor = "#6D28D9";
        }, 1000);
      };
      copyAllBtn.onmouseover = () => {
        copyAllBtn.style.transform = "translateY(-2px)";
        copyAllBtn.style.boxShadow = "0 4px 8px rgba(124, 58, 237, 0.3)";
        copyAllBtn.style.background = "#6D28D9";
      };
      copyAllBtn.onmouseout = () => {
        copyAllBtn.style.transform = "translateY(0)";
        copyAllBtn.style.boxShadow = "none";
        copyAllBtn.style.background = "#7C3AED";
      };
      l.appendChild(copyAllBtn);
      
      s.appendChild(i);
      s.appendChild(l);
      e.appendChild(s);
    } catch (e) {
      console.error("Error adding best keywords:", e);
    }
  }

  function y() {
    try {
      if (h()) return;
      (function() {
        try {
          if (h()) {
            let e = document.querySelector(".podpilot-custom-toolbar");
            if (e) e.remove();
            return;
          }
          if (document.querySelector(".podpilot-custom-toolbar")) return;
          let e = document.querySelector(".m-search__browse-results, .cards__designs-redesign, .jsTilesDesigns");
          if (!e) return;
          let t = document.createElement("div");
          t.className = "podpilot-custom-toolbar";
          t.style.cssText = `
            background: white;
            padding: 16px 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            border: 1px solid #e5e7eb;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 20px;
            align-items: start;
          `;
          let o = document.createElement("div");
          o.className = "podpilot-keywords-container";
          o.style.cssText = `
            min-width: 0;
            max-width: 100%;
            overflow: hidden;
          `;
          let a = document.createElement("div");
          a.className = "podpilot-filters-container";
          a.style.cssText = `
            display: flex;
            gap: 8px;
            align-items: center;
            flex-shrink: 0;
            flex-wrap: wrap;
            justify-content: flex-end;
          `;
          t.appendChild(o);
          t.appendChild(a);
          e.parentElement?.insertBefore(t, e);
          w(o);
        } catch (e) {
          console.error("Error creating custom toolbar:", e);
        }
      })();

      let e = document.querySelector(".podpilot-filters-container");
      if (!e || e.querySelector(".podpilot-age-filter")) return;
      let t = document.createElement("div");
      t.className = "podpilot-age-filter";
      t.innerHTML = `
        <div class="m-search__sort-btn-container">
          <div class="m-search__sort-menu" data-controller="search--sort-and-filter" data-search--sort-and-filter-container-selector-value=".podpilot-age-filter">
            <button type="button" class="btn m-search__sort-btn btn--no-space tp-btn--medium" data-action="click->search--sort-and-filter#toggleSortFilterList" data-search--sort-and-filter-target="triggerButton">
              <span class="teepublicon teepublicon--dark-default teepublicon-background--transparent teepublicon-spacing--right">
                <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" width="16" height="16" focusable="false" aria-hidden="true">
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M14.504 4c.754 0 1.361.26 1.648.395.35.165.677.367.954.554.56.378 1.164.868 1.756 1.381 2.448 2.123 3.146 3.01 5.333 5.404l.001.002c1.131 1.242 1.067 3.19-.145 4.35a2.947 2.947 0 0 1-4.24-.148c-1.887-2.066-2.307-2.554-2.307-2.554v27.538c0 1.7-1.343 3.078-3 3.078s-3-1.378-3-3.078V13.385s-1.112 1.241-2.306 2.551-3.03 1.31-4.241.15a3.134 3.134 0 0 1-.153-4.35C6.986 9.34 7.697 8.455 10.147 6.33c.591-.513 1.196-1.003 1.755-1.38.277-.188.604-.39.954-.555.287-.135.894-.395 1.648-.395Zm18.992 40c-.754 0-1.361-.26-1.648-.395a7.178 7.178 0 0 1-.954-.554c-.56-.378-1.164-.868-1.756-1.381-2.448-2.123-3.146-3.01-5.333-5.404l-.001-.002c-1.131-1.242-1.067-3.19.145-4.35a2.947 2.947 0 0 1 4.24.148c1.887 2.066 2.307 2.553 2.307 2.553V7.078c0-1.7 1.343-3.078 3-3.078s3 1.378 3 3.078v27.537s1.112-1.241 2.306-2.551 3.03-1.31 4.241-.15a3.134 3.134 0 0 1 .153 4.35c-2.182 2.397-2.893 3.282-5.343 5.406-.591.513-1.196 1.003-1.755 1.38-.277.188-.604.39-.954.555-.287.135-.894.395-1.648.395Z"></path>
                </svg>
              </span>
              <div class="button__content">
                Age: <span class="podpilot-age-sort-label">Default</span>
              </div>
            </button>
            
            <div class="link-collection m-search__sort-dropdown hidden podpilot-age-dropdown" style="position: fixed; top: auto; bottom: calc(100vh - var(--button-bottom, 0px) + 8px); left: var(--button-left, 0px); z-index: 99999; background: white; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08); min-width: 160px; overflow: hidden; transform: translateY(0); transition: all 0.2s ease;">
              <div class="link-collection__body" style="padding: 8px 0;">
                <div class="link-collection__content">
                  <a href="#" class="link m-search__sort-dropdown__link link-collection__link link--1 link--default podpilot-age-option active" data-sort="none" style="display: block; padding: 12px 16px; text-decoration: none; color: #374151; font-weight: 500; transition: background-color 0.2s;">
                    <span class="link__content">Default</span>
                  </a>
                  <a href="#" class="link m-search__sort-dropdown__link link-collection__link link--1 link--default podpilot-age-option" data-sort="oldest" style="display: block; padding: 12px 16px; text-decoration: none; color: #374151; font-weight: 500; transition: background-color 0.2s;">
                    <span class="link__content">Oldest First</span>
                  </a>
                  <a href="#" class="link m-search__sort-dropdown__link link-collection__link link--1 link--default podpilot-age-option" data-sort="newest" style="display: block; padding: 12px 16px; text-decoration: none; color: #374151; font-weight: 500; transition: background-color 0.2s;">
                    <span class="link__content">Newest First</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
      t.style.cssText = `
        display: inline-block;
        position: relative;
      `;
      e.appendChild(t);

      let styleEl = document.createElement("style");
      styleEl.textContent = `
        .podpilot-age-filter .m-search__sort-btn {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: flex-start !important;
          height: 38px !important;
          padding: 0 14px !important;
          background: #f9fafb !important;
          border: 1px solid #d1d5db !important;
          border-radius: 6px !important;
          font-size: 14px !important;
          font-weight: 500 !important;
          color: #374151 !important;
          text-decoration: none !important;
          transition: all 0.15s ease !important;
          cursor: pointer !important;
          white-space: nowrap !important;
          min-width: 130px !important;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04) !important;
          font-family: inherit !important;
          line-height: 1.5 !important;
          vertical-align: middle;
        }
        
        .podpilot-age-filter .m-search__sort-btn:hover {
          background: white !important;
          border-color: #9ca3af !important;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08) !important;
        }
        
        .podpilot-age-filter .m-search__sort-btn:active {
          background: #f3f4f6 !important;
        }
        
        .podpilot-age-filter .m-search__sort-btn:focus {
          outline: none !important;
          border-color: #8B5CF6 !important;
        }
        
        .podpilot-age-filter .teepublicon {
          margin-right: 8px !important;
          flex-shrink: 0 !important;
          display: inline-flex !important;
          align-items: center !important;
          width: 16px !important;
          height: 16px !important;
        }
        
        .podpilot-age-filter .button__content {
          display: flex !important;
          align-items: center !important;
          gap: 4px !important;
          flex: 1 !important;
          font-weight: 500 !important;
          min-width: 0 !important;
        }
        
        .podpilot-age-option:hover {
          background-color: #f8fafc !important;
          color: #4C1D95 !important;
        }
        .podpilot-age-option.active {
          background-color: #8B5CF6 !important;
          color: white !important;
        }
        .podpilot-age-dropdown {
          backdrop-filter: blur(12px);
          border: 1px solid rgba(0,0,0,0.08) !important;
        }
        .podpilot-age-dropdown.hidden {
          opacity: 0;
          transform: translateY(-8px) scale(0.95);
          pointer-events: none;
        }
        .podpilot-age-dropdown:not(.hidden) {
          opacity: 1;
          transform: translateY(0) scale(1);
          pointer-events: auto;
        }
        
        .podpilot-age-filter .m-search__sort-btn-container {
          display: inline-block !important;
          vertical-align: top !important;
        }
        
        .podpilot-age-filter .m-search__sort-menu {
          display: inline-block !important;
          position: relative !important;
        }
        
        .podpilot-age-filter .btn {
          all: unset !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: flex-start !important;
          height: 40px !important;
          padding: 0 16px !important;
          background: #ffffff !important;
          border: 1px solid #e5e7eb !important;
          border-radius: 8px !important;
          font-size: 14px !important;
          font-weight: 500 !important;
          color: #374151 !important;
          text-decoration: none !important;
          transition: all 0.2s ease !important;
          cursor: pointer !important;
          white-space: nowrap !important;
          min-width: 120px !important;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05) !important;
          font-family: inherit !important;
          line-height: 1.5 !important;
          vertical-align: middle !important;
          position: relative !important;
          overflow: visible !important;
          box-sizing: border-box !important;
        }
        
        .podpilot-age-filter .btn:hover {
          background: #f9fafb !important;
          border-color: #d1d5db !important;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1) !important;
        }
        
        .podpilot-age-filter .btn:active {
          background: #f3f4f6 !important;
          transform: translateY(1px) !important;
        }
        
        .podpilot-age-filter .btn:focus {
          outline: none !important;
          border-color: #8B5CF6 !important;
          box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1) !important;
        }
        
        .podpilot-age-filter svg {
          width: 16px !important;
          height: 16px !important;
          flex-shrink: 0 !important;
        }
        
        .podpilot-age-filter .podpilot-age-sort-label {
          font-weight: 500 !important;
          color: inherit !important;
        }
        
        .podpilot-age-filter * {
          box-sizing: border-box !important;
        }
      `;
      document.head.appendChild(styleEl);

      let aBtn = t.querySelector(".m-search__sort-btn");
      let rDropdown = t.querySelector(".podpilot-age-dropdown");
      let nLabel = t.querySelector(".podpilot-age-sort-label");
      let sOptions = t.querySelectorAll(".podpilot-age-option");

      aBtn?.addEventListener("click", e => {
        try {
          if (e.preventDefault(), e.stopPropagation(), rDropdown) {
            let e = aBtn.getBoundingClientRect();
            let t = e.bottom;
            let o = e.left;
            document.documentElement.style.setProperty("--button-bottom", `${t}px`);
            document.documentElement.style.setProperty("--button-left", `${o}px`);
            rDropdown.classList.toggle("hidden");
          }
        } catch (_) {}
      });

      document.addEventListener("click", e => {
        try {
          if (t && !t.contains(e.target)) {
            rDropdown?.classList.add("hidden");
          }
        } catch (_) {}
      });

      sOptions.forEach(e => {
        e.addEventListener("click", t => {
          try {
            t.preventDefault();
            t.stopPropagation();
            let o = e.getAttribute("data-sort");
            f = o;
            sOptions.forEach(e => e.classList.remove("active"));
            e.classList.add("active");
            let aVal = e.querySelector(".link__content")?.textContent || "Default";
            if (nLabel) nLabel.textContent = aVal;
            rDropdown?.classList.add("hidden");
            v(o);
          } catch (_) {}
        });
      });
    } catch (_) {}
  }

  function v(e) {
    try {
      let t;
      let o = Array.from(document.querySelectorAll(".tp-design-tile"));
      let a = o.filter(e => !e.closest(".m-recently-viewed-designs__contain") && !e.closest(".jsRecentlyViewedDesigns"));
      if (0 === a.length) return;
      let r = a[0].parentElement;
      let n = [
        document.querySelector(".jsTilesDesigns"),
        document.querySelector(".cards__designs-redesign"),
        document.querySelector(".m-search__browse-results"),
        document.querySelector('[class*="jsTilesDesigns"]'),
        document.querySelector('[class*="cards__designs"]'),
        a[0].parentElement,
        a[0].parentElement?.parentElement
      ].filter(Boolean);
      for (let e of n) {
        if (e && e.querySelectorAll(".tp-design-tile").length === a.length) {
          r = e;
          break;
        }
      }
      if (!r) return;
      if (0 === b.length) {
        b = Array.from(a);
      }
      if ("oldest" === e) {
        let e = a.map(e => {
          try {
            let t = d(e);
            return { element: e, timestamp: t || 0 };
          } catch (_) {
            return { element: e, timestamp: 0 };
          }
        });
        e.sort((e, t) => e.timestamp - t.timestamp);
        t = e.map(e => e.element);
      } else if ("newest" === e) {
        let e = a.map(e => {
          try {
            let t = d(e);
            return { element: e, timestamp: t || 0 };
          } catch (_) {
            return { element: e, timestamp: 0 };
          }
        });
        e.sort((e, t) => t.timestamp - e.timestamp);
        t = e.map(e => e.element);
      } else {
        t = [...b];
      }
      let s = document.createDocumentFragment();
      t.forEach(e => {
        try {
          if (e.parentNode) e.parentNode.removeChild(e);
          s.appendChild(e);
        } catch (_) {}
      });
      let i = window.scrollY || window.pageYOffset;
      let l = r.querySelectorAll(".tp-design-tile");
      l.forEach(e => {
        try {
          e.remove();
        } catch (_) {}
      });
      t.forEach((e) => {
        try {
          r.appendChild(e);
        } catch (_) {}
      });
      requestAnimationFrame(() => {
        window.scrollTo(0, i);
      });
    } catch (_) {}
  }

  function S() {
    try {
      let e;
      if (h()) {
        let e = document.querySelector(".podpilot-custom-toolbar");
        if (e) e.remove();
      }
      m();
      g();
      let t = new MutationObserver(e => {
        try {
          e.forEach(e => {
            if ("childList" === e.type) {
              e.addedNodes.forEach(e => {
                try {
                  if (e.nodeType === Node.ELEMENT_NODE) {
                    if (e.classList?.contains("tp-design-tile")) {
                      setTimeout(() => { try { m(); } catch (_) {} }, 100);
                    }
                    if (e.querySelector && e.querySelector(".tp-design-tile")) {
                      setTimeout(() => { try { m(); } catch (_) {} }, 100);
                    }
                    if (e.classList?.contains("jsProductMainImage") || (e.querySelector && e.querySelector(".jsProductMainImage"))) {
                      setTimeout(() => { try { g(); } catch (_) {} }, 100);
                    }
                    if (e.classList?.contains("m-search__sort-and-filter-options") || (e.querySelector && e.querySelector(".m-search__sort-and-filter-options"))) {
                      setTimeout(() => { try { y(); } catch (_) {} }, 100);
                    }
                  }
                } catch (_) {}
              });
            }
          });
        } catch (_) {}
      });
      t.observe(document.body, { childList: true, subtree: true });

      let o = false;
      let a = 0;
      window.addEventListener("scroll", () => {
        try {
          if (o) return;
          clearTimeout(e);
          e = setTimeout(() => {
            try {
              o = true;
              m();
              g();
              y();
              if ("none" !== f) {
                let e = document.querySelectorAll(".tp-design-tile").length;
                if (e > a) {
                  a = e;
                  v(f);
                }
              }
              o = false;
            } catch (_) {
              o = false;
            }
          }, 800);
        } catch (_) {}
      }, { passive: true });

      y();

      let r = window.location.href;
      let n = new MutationObserver(() => {
        let e = window.location.href;
        if (e !== r) {
          r = e;
          if (h()) {
            let e = document.querySelector(".podpilot-custom-toolbar");
            if (e) e.remove();
          } else {
            setTimeout(() => { try { y(); } catch (_) {} }, 500);
          }
        }
      });
      n.observe(document, { subtree: true, childList: true });
    } catch (_) {}
  }

  function T() {
    if (document.getElementById("podpilot-listing-styles")) return;
    let e = document.createElement("style");
    e.id = "podpilot-listing-styles";
    e.textContent = `
      .podpilot-publish-date {
        position: absolute;
        top: 8px;
        left: 8px;
        background: #EDE9FE;
        color: #4C1D95;
        padding: 5px 10px;
        border-radius: 6px;
        font-size: 10px;
        font-weight: 600;
        z-index: 9;
        pointer-events: none;
        border: 1px solid #8B5CF6;
        white-space: nowrap;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        text-align: center;
        letter-spacing: 0.5px;
        line-height: 1.3;
        box-shadow: 0 2px 8px rgba(139, 92, 246, 0.4);
        will-change: auto;
      }

      .podpilot-listing-buttons-container {
        position: absolute !important;
        top: 88px !important;
        right: 6px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 6px !important;
        z-index: 5 !important;
        pointer-events: auto !important;
      }
      
      .podpilot-circular-btn {
        width: 32px !important;
        height: 32px !important;
        border-radius: 50% !important;
        border: none !important;
        background: #fff !important;
        box-shadow: 0 2px 6px rgba(0,0,0,0.12) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        cursor: pointer !important;
        transition: all 0.2s ease !important;
        position: relative !important;
        pointer-events: auto !important;
      }
      
      .podpilot-circular-btn:hover {
        transform: scale(1.1);
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      }
      
      .podpilot-circular-btn:active {
        transform: scale(0.95);
      }
      
      .podpilot-copy-tags-btn {
        background: linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%) !important;
      }
      
      .podpilot-copy-tags-btn:hover {
        background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%) !important;
      }
      
      .podpilot-copy-tags-btn.copied {
        background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
      }
      
      .podpilot-btn-icon {
        font-size: 14px;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.2));
      }
      
      .podpilot-circular-btn::after {
        content: attr(data-tooltip);
        position: absolute;
        right: 38px;
        top: 50%;
        transform: translateY(-50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
        font-weight: 500;
      }
      
      .podpilot-circular-btn:hover::after {
        opacity: 1;
      }
    `;
    document.head.appendChild(e);

    // Dynamic processing for copy-tags buttons on listing cards
    let tiles = document.querySelectorAll(".tp-design-tile.jsDesignContainer");
    tiles.forEach(tile => {
      if (tile.hasAttribute("data-listing-processed")) return;
      if (tile.closest(".m-also-available-products") || tile.closest(".m-recently-viewed-designs__contain") || tile.closest(".jsRecentlyViewedDesigns")) {
        tile.setAttribute("data-listing-processed", "true");
        return;
      }
      tile.setAttribute("data-listing-processed", "true");
      let dUrl = tile.dataset.url || tile.querySelector('a[href*="/t-shirt/"]')?.getAttribute("href");
      let fullUrl = dUrl ? new URL(dUrl, window.location.origin).href : null;
      if (!fullUrl || !fullUrl.includes("/t-shirt/")) return;

      let wrap = tile.querySelector(".tp-design-tile__image-wrap");
      if (!wrap) return;

      if (!wrap.style.position || wrap.style.position === "static") {
        wrap.style.position = "relative";
      }
      if (!wrap.style.overflow) {
        wrap.style.overflow = "visible";
      }

      let btnContainer = document.createElement("div");
      btnContainer.className = "podpilot-listing-buttons-container";

      let copyBtn = document.createElement("button");
      copyBtn.className = "podpilot-circular-btn podpilot-copy-tags-btn";
      copyBtn.setAttribute("data-tooltip", "Copy Tags");
      copyBtn.innerHTML = '<span class="podpilot-btn-icon">📋</span>';

      copyBtn.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        copyBtn.disabled = true;
        copyBtn.classList.add("loading");
        let origHtml = copyBtn.innerHTML;
        copyBtn.innerHTML = '<span class="podpilot-btn-icon">⏳</span>';
        
        let tagsFetched = await P(fullUrl);
        if (tagsFetched.length > 0 && await k(tagsFetched)) {
          copyBtn.innerHTML = '<span class="podpilot-btn-icon">✓</span>';
          copyBtn.classList.remove("loading");
          copyBtn.classList.add("copied");
          setTimeout(() => {
            copyBtn.innerHTML = origHtml;
            copyBtn.classList.remove("copied");
            copyBtn.disabled = false;
          }, 1500);
        } else {
          copyBtn.innerHTML = '<span class="podpilot-btn-icon">✗</span>';
          copyBtn.classList.remove("loading");
          setTimeout(() => {
            copyBtn.innerHTML = origHtml;
            copyBtn.disabled = false;
          }, 1500);
        }
      });

      btnContainer.appendChild(copyBtn);
      wrap.appendChild(btnContainer);
    });
  }

  function C() {
    let e = 0;
    let t = null;
    let observer = new MutationObserver(mutations => {
      let added = false;
      for (let mut of mutations) {
        if (mut.addedNodes.length > 0) {
          for (let node of mut.addedNodes) {
            if (1 === node.nodeType && (node.classList?.contains("tp-design-tile") || node.querySelector?.(".tp-design-tile"))) {
              added = true;
              break;
            }
          }
        }
        if (added) break;
      }
      if (added) {
        if (t) clearTimeout(t);
        t = setTimeout(() => {
          let currentCount = document.querySelectorAll(".tp-design-tile").length;
          if (currentCount !== e) {
            e = currentCount;
            let o = window.scrollY || window.pageYOffset;
            T();
            requestAnimationFrame(() => {
              window.scrollTo(0, o);
            });
          }
        }, 150);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    e = document.querySelectorAll(".tp-design-tile").length;
    T();
  }

  // DOM Bootstrapper
  T();
  if ("loading" === document.readyState) {
    document.addEventListener("DOMContentLoaded", () => {
      S();
      C();
    });
  } else {
    S();
    C();
  }

})();
"""

# Let's save the clean reconstructed file content
clean_content = intact_code + listener_and_autoboot + rebranding_block

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(clean_content)

print("SUCCESSFULLY RESTORED AND REBRANDED!")
