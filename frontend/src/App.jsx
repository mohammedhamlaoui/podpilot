import { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard, HandCoins, ShieldCheck, UsersRound } from "lucide-react";
import { useAuth } from "./auth/AuthContext";
import Dashboard from "./components/Dashboard";
import DesignManager from "./components/DesignManager";
import TeePublicDesignManager from "./components/TeePublicDesignManager";
import TeePublicEditor from "./components/TeePublicEditor";
import BillingSubscriptionsPage from "./components/BillingSubscriptionsPage";
import AffiliatePage from "./components/AffiliatePage";
import AdminAffiliatePage from "./components/AdminAffiliatePage";
import Icon from "./components/Icon";
import ImageGrid from "./components/ImageGrid";
import ImportDesigns from "./components/ImportDesigns";
import TeePublicImport from "./components/TeePublicImport";
import LoginPage from "./components/LoginPage";
import LandingPage from "./components/LandingPage";
import PricingPage from "./components/PricingPage";
import CheckoutPage from "./components/CheckoutPage";
import ComparisonPage from "./components/ComparisonPage";
import RedbubbleAutomationToolPage from "./components/RedbubbleAutomationToolPage";
import TeePublicAutomationToolPage from "./components/TeePublicAutomationToolPage";
import BlogPage from "./components/BlogPage";
import ContactPage from "./components/ContactPage";
import PrivacyPolicyPage from "./components/PrivacyPolicyPage";
import FounderPage from "./components/FounderPage";
import TermsOfServicePage from "./components/TermsOfServicePage";
import RefundPolicyPage from "./components/RefundPolicyPage";
import HelpCenterPage from "./components/HelpCenterPage";
import SecurityPage from "./components/SecurityPage";
import ProfilePage from "./components/ProfilePage";
import ResetPasswordPage from "./components/ResetPasswordPage";
import EmailConfirmedPage from "./components/EmailConfirmedPage";
import ExtensionAuthSuccess from "./components/ExtensionAuthSuccess";
import NotFoundPage from "./components/NotFoundPage";
import ThankYouPage from "./components/ThankYouPage";
import PreviewModeBanner from "./components/PreviewModeBanner";
import PaymentRecoveryBanner from "./components/PaymentRecoveryBanner";
import DesignRetentionNotice, {
  acknowledgeDesignRetentionNotice,
} from "./components/DesignRetentionNotice";
import UnsavedChangesModal from "./components/UnsavedChangesModal";
import { EXTENSION_ID } from "./config";
import { AUTH_MESSAGES, supabase } from "./lib/supabaseClient";
import {
  getMyPlatformAccess,
  getMySubscription,
  getTrialEligibility,
  createBillingPortalSession,
  switchDevice,
  listDesigns,
  updateDesignStatus,
} from "./api/client";
import { getPendingCheckoutPlan, clearPendingCheckoutPlan } from "./lib/pendingCheckout";
import { debugSubscriptionLog, getSubscriptionFlags, openPricing } from "./lib/subscriptionAccess";
import {
  DEVICE_SWITCH_MESSAGE,
  parseDeviceError,
} from "./lib/deviceSession";
import {
  clearDesignCacheForUser,
  DESIGN_CACHE_TTL_MS,
  getCachedDesigns,
  invalidateDesignCache,
  isCacheFresh,
  mergeCachedDesigns,
  prependCachedDesigns,
  setCachedDesigns,
} from "./lib/designCache";

function deriveImagesFromDesigns(designs) {
  return (designs || [])
    .filter((d) => d.image_url || d.image_r2_key)
    .map((d) => ({
      id: `design-${d.id}`,
      name: d.filename,
      size: 0,
      previewUrl: d.cdn_image_url || d.image_url || "",
      previewDataUrl: "",
      matched: true,
      storedName: d.filename,
      imagePath: d.image_r2_key || "",
      imageUrl: d.cdn_image_url || d.image_url || "",
      thumbnail_r2_key: d.thumbnail_r2_key || "",
      thumbnailUrl: d.cdn_image_url || d.thumbnail_url || d.image_url || "",
    }));
}

function normalizeDesignForExtension(design) {
  return {
    id: design.id,
    filename: design.filename,
    image_url: design.image_url || "",
    cdn_image_url: design.cdn_image_url || "",
    image_r2_key: design.image_r2_key || "",
    image_path: design.image_r2_key || "",
    thumbnail_url: design.thumbnail_url || "",
    thumbnail_r2_key: design.thumbnail_r2_key || "",
    title: design.title,
    description: design.description,
    main_tag: design.main_tag || design.primary_tag || "",
    primary_tag: design.primary_tag || design.main_tag || "",
    supporting_tags: design.supporting_tags,
    copy_link: design.copy_link,
    marketplace: design.marketplace || "redbubble",
  };
}

function syncDesignsToExtension(designs, accessToken) {
  if (!EXTENSION_ID.trim() || !window.chrome?.runtime?.sendMessage) return;
  const message = {
    action: "save_designs",
    designs: (designs || []).map(normalizeDesignForExtension),
  };
  if (accessToken) message.access_token = accessToken;
  window.chrome.runtime.sendMessage(EXTENSION_ID, message, () => {
    if (window.chrome?.runtime?.lastError) {
      console.warn("Extension sync skipped:", window.chrome.runtime.lastError.message);
    }
  });
}

// ── Sidebar ─────────────────────────────────────────────────────────────────
// MerchGhost-style: slim icon rail by default, expands on hover with labels.

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "designs" },
  { id: "redbubble", label: "Redbubble Upload", icon: "redbubble" },
  { id: "teepublic", label: "TeePublic Upload", icon: "teepublic" },
  { id: "billing", label: "Billing & Subscriptions", iconComponent: CreditCard },
  { id: "affiliate", label: "Affiliate Program", iconComponent: HandCoins },
];

const ADMIN_NAV_ITEMS = [
  { id: "admin", label: "Admin Dashboard", iconComponent: ShieldCheck },
  { id: "admin-affiliates", label: "Affiliates", iconComponent: UsersRound },
];
const DEFAULT_PLATFORM_ACCESS = {
  has_active_plan: false,
  plan: null,
  redbubble: false,
  teepublic: false,
};

function normalizePlatformAccess(access) {
  return {
    has_active_plan: Boolean(access?.has_active_plan),
    plan: access?.plan || null,
    redbubble: Boolean(access?.redbubble),
    teepublic: Boolean(access?.teepublic),
    status: access?.status || access?.subscription_status || "inactive",
    subscription_status: access?.subscription_status || access?.status || "inactive",
    payment_status: access?.payment_status || access?.status || "inactive",
    is_past_due: access?.is_past_due === true,
    past_due_grace_active: access?.past_due_grace_active === true,
    past_due_grace_days: Number(access?.past_due_grace_days ?? 3),
    past_due_lock_after: access?.past_due_lock_after || null,
    payment_recovery_required: access?.payment_recovery_required === true,
    payment_recovery_message: access?.payment_recovery_message || null,
  };
}

function isPlatformRoute(route) {
  return route === "redbubble" || route === "teepublic";
}

function canAccessRoute(route, platformAccess) {
  if (!isPlatformRoute(route)) return true;
  return Boolean(platformAccess?.[route]);
}

function Sidebar({ activeRoute, onNavigate, user, onSignOut, theme, setTheme, platformAccess, trialEligibility, isAdmin }) {
  const userLabel = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Account";

  return (
    <aside className="pp-sidebar" aria-label="Main navigation">
      <div className="pp-sidebar-top">
        <div className="pp-sidebar-brand" onClick={() => onNavigate("dashboard")}>
          <img src="/brand/podpilot-logo.svg" alt="PodPilot" className="pp-sidebar-logo" />
          <span className="pp-sidebar-label pp-sidebar-brand-text">PodPilot</span>
        </div>

        <nav className="pp-sidebar-nav">
          {NAV_ITEMS.map((item) => {
            const locked = isPlatformRoute(item.id) && !canAccessRoute(item.id, platformAccess);
            const ItemIcon = item.iconComponent;
            const tooltip = locked
              ? (trialEligibility?.eligible === true
                  ? `${item.label} preview mode. Start your free trial to use this feature.`
                  : `${item.label} preview mode. Choose a plan to use this feature.`)
              : item.label;
            return (
              <button
                key={item.id}
                type="button"
                className={`pp-sidebar-btn${activeRoute === item.id ? " pp-sidebar-btn-active" : ""}${locked ? " pp-sidebar-btn-locked" : ""}`}
                onClick={() => {
                  onNavigate(item.id);
                }}
                data-tooltip={tooltip}
                aria-label={tooltip}
                aria-disabled={locked || undefined}
              >
                {ItemIcon ? <ItemIcon className="ui-icon" aria-hidden="true" /> : <Icon name={item.icon} />}
                {locked && <Icon name="lock" className="pp-sidebar-lock-icon" />}
                <span className="pp-sidebar-label">{item.label}</span>
              </button>
            );
          })}

          {isAdmin && (
            <div className="pp-sidebar-admin">
              <span className="pp-sidebar-label pp-sidebar-section-label">Admin</span>
              {ADMIN_NAV_ITEMS.map((item) => {
                const ItemIcon = item.iconComponent;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`pp-sidebar-btn${activeRoute === item.id ? " pp-sidebar-btn-active" : ""}`}
                    onClick={() => onNavigate(item.id)}
                    data-tooltip={item.label}
                    aria-label={item.label}
                  >
                    <ItemIcon className="ui-icon" aria-hidden="true" />
                    <span className="pp-sidebar-label">{item.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </nav>
      </div>

      <div className="pp-sidebar-bottom">
        <button
          type="button"
          className={`pp-sidebar-btn${activeRoute === "profile" ? " pp-sidebar-btn-active" : ""}`}
          onClick={() => onNavigate("profile")}
          data-tooltip={userLabel}
          aria-label={userLabel}
        >
          <Icon name="user" />
          <span className="pp-sidebar-label">{userLabel}</span>
        </button>
      </div>
    </aside>
  );
}

// ── Main App ────────────────────────────────────────────────────────────────

const VALID_ROUTES = ["dashboard", "redbubble", "teepublic", "billing", "affiliate", "profile", "admin", "admin-affiliates"];
const VALID_TABS = ["designs", "import"];
const SUBSCRIPTION_POLL_INTERVAL_MS = 30000;
const SUBSCRIPTION_POLL_ATTEMPTS = 2;
const CHECKOUT_QUERY_KEY = "checkout";
const CHECKOUT_QUERY_VALUE = "success";
const DESIGN_MARKETPLACES = ["redbubble", "teepublic"];
const EDITOR_INDEX_KEYS = {
  redbubble: "podpilot:redbubble:selectedDesignIndex",
  teepublic: "podpilot:teepublic:selectedDesignIndex",
};
const EDITOR_DESIGN_ID_KEYS = {
  redbubble: "podpilot:redbubble:selectedDesignId",
  teepublic: "podpilot:teepublic:selectedDesignId",
};
const EDITOR_VIEW_KEYS = {
  redbubble: "podpilot:redbubble:lastView",
  teepublic: "podpilot:teepublic:lastView",
};
const CHECKOUT_DEBUG =
  import.meta.env.DEV ||
  import.meta.env.VITE_ENABLE_CHECKOUT_DEBUG === "true";
const COMPARISON_ROUTES = [
  "/compare/podpilot-vs-merchghost-vs-merchtitans",
  "/customers/compare/podpilot-vs-merchghost-vs-merchtitans",
];

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function hasCheckoutSuccessFlag() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get(CHECKOUT_QUERY_KEY) === CHECKOUT_QUERY_VALUE;
  } catch {
    return false;
  }
}

function clearCheckoutFlagFromUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete(CHECKOUT_QUERY_KEY);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  } catch {
    /* noop */
  }
}

function cacheDebugLog(message) {
  if (!import.meta.env.DEV) return;
  // eslint-disable-next-line no-console
  console.log(`[Cache] ${message}`);
}

function getMarketplaceSetter(marketplace, redbubbleSetter, teepublicSetter) {
  return marketplace === "teepublic" ? teepublicSetter : redbubbleSetter;
}

const ACTIVE_EXTENSION_QUEUE_STATUSES = new Set(["starting", "running", "paused"]);

function normalizeExtensionUploadStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (["running", "in_progress", "uploading"].includes(status)) return "uploading";
  if (["done", "success", "uploaded"].includes(status)) return "uploaded";
  if (["error", "failed", "skipped"].includes(status)) return "failed";
  if (["not_uploaded", "pending", "queued", "preparing", "ready"].includes(status)) return "not_uploaded";
  return "";
}

function normalizeUploadPlatform(value) {
  const platform = String(value || "").trim().toLowerCase();
  return DESIGN_MARKETPLACES.includes(platform) ? platform : "";
}

function readEditorIndex(marketplace) {
  try {
    const value = Number(sessionStorage.getItem(EDITOR_INDEX_KEYS[marketplace]));
    return Number.isInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeEditorIndex(marketplace, index) {
  try {
    sessionStorage.setItem(EDITOR_INDEX_KEYS[marketplace], String(Math.max(0, Number(index) || 0)));
  } catch {
    // Draft navigation still works in memory if session storage is unavailable.
  }
}

function readEditorDesignId(marketplace) {
  try {
    return sessionStorage.getItem(EDITOR_DESIGN_ID_KEYS[marketplace]) || "";
  } catch {
    return "";
  }
}

function writeEditorDesignId(marketplace, designId) {
  try {
    const key = EDITOR_DESIGN_ID_KEYS[marketplace];
    const value = String(designId || "").trim();
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // Editor selection still works in memory if session storage is unavailable.
  }
}

function readEditorView(marketplace) {
  try {
    return sessionStorage.getItem(EDITOR_VIEW_KEYS[marketplace]) === "editor" ? "editor" : "list";
  } catch {
    return "list";
  }
}

function writeEditorView(marketplace, view) {
  try {
    sessionStorage.setItem(EDITOR_VIEW_KEYS[marketplace], view === "editor" ? "editor" : "list");
  } catch {
    // View restoration still works in memory if session storage is unavailable.
  }
}

function designIdentity(design) {
  return String(design?.id || design?.local_id || design?.tempId || "").trim();
}

function findDesignIndexById(designs, designId) {
  const targetId = String(designId || "").trim();
  if (!targetId) return -1;
  return (Array.isArray(designs) ? designs : []).findIndex((design) => designIdentity(design) === targetId);
}

function logNavigation(message) {
  console.info(`[PodPilot][Navigation] ${message}`);
}

function designDedupeKeys(design, marketplace) {
  if (!design) return [];
  const keys = [];
  const safeMarketplace = design.marketplace || marketplace;
  if (design.id) keys.push(`id:${design.id}`);
  if (design.local_id) keys.push(`local:${design.local_id}`);
  if (design.tempId) keys.push(`local:${design.tempId}`);
  if (design.filename) keys.push(`file:${safeMarketplace}:${String(design.filename).trim().toLowerCase()}`);
  return keys;
}

function designDedupeKey(design, marketplace) {
  return designDedupeKeys(design, marketplace)[0] || "";
}

function isLocalDraftDesign(design) {
  const id = String(design?.id || "");
  return id.startsWith("local_") || id.startsWith("temp_") || Boolean(design?.local_id || design?.tempId);
}

function findExistingDedupeKey(aliasToKey, aliases) {
  return aliases.find((alias) => aliasToKey.has(alias));
}

function registerDedupeAliases(aliasToKey, aliases, key) {
  aliases.forEach((alias) => aliasToKey.set(alias, key));
}

function mergeDesignCollections(currentDesigns = [], incomingDesigns = [], marketplace, { prepend = false } = {}) {
  const incoming = Array.isArray(incomingDesigns) ? incomingDesigns.filter(Boolean) : [];
  if (incoming.length === 0) return Array.isArray(currentDesigns) ? currentDesigns : [];

  const byKey = new Map();
  const aliasToKey = new Map();
  const order = [];
  (Array.isArray(currentDesigns) ? currentDesigns : []).filter(Boolean).forEach((design) => {
    const aliases = designDedupeKeys(design, marketplace);
    const key = aliases[0] || "";
    if (!key) {
      order.push(design);
      return;
    }
    if (!byKey.has(key)) order.push(key);
    byKey.set(key, design);
    registerDedupeAliases(aliasToKey, aliases, key);
  });

  const incomingOrder = [];
  incoming.forEach((design) => {
    const aliases = designDedupeKeys(design, design.marketplace || marketplace);
    const existingAlias = findExistingDedupeKey(aliasToKey, aliases);
    const key = existingAlias ? aliasToKey.get(existingAlias) : aliases[0] || "";
    if (!key) {
      incomingOrder.push(design);
      return;
    }
    const existed = byKey.has(key);
    byKey.set(key, { ...(byKey.get(key) || {}), ...design });
    registerDedupeAliases(aliasToKey, aliases, key);
    if (!existed || prepend) incomingOrder.push(key);
  });

  const incomingKeySet = new Set(incomingOrder.filter((item) => typeof item === "string"));
  const nextOrder = prepend
    ? [...incomingOrder, ...order.filter((item) => !(typeof item === "string" && incomingKeySet.has(item)))]
    : [...order, ...incomingOrder.filter((item) => !(typeof item === "string" && order.includes(item)))];

  return nextOrder.map((item) => (typeof item === "string" ? byKey.get(item) : item)).filter(Boolean);
}

function SubscriptionHydrationScreen({ error, onRetry, isRetrying }) {
  return (
    <div className="pp-page-loader pp-subscription-loader" role="status" aria-live="polite">
      <div className="pp-subscription-loader-mark" aria-hidden="true">
        <span className="pp-subscription-loader-ring" />
        <span className="pp-subscription-loader-orbit" />
        <img src="/brand/podpilot-logo.svg" alt="" className="pp-loading-logo" />
      </div>
      {error ? (
        <>
          <strong>Could not verify your subscription.</strong>
          <span>{error}</span>
          <button
            type="button"
            className="primary-button"
            onClick={onRetry}
            disabled={isRetrying}
            aria-busy={isRetrying || undefined}
          >
            {isRetrying ? "Checking..." : "Retry"}
          </button>
        </>
      ) : (
        <>
          <strong>Checking your subscription<span className="pp-loading-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span></strong>
          <div className="pp-subscription-loader-progress" aria-hidden="true">
            <span />
          </div>
        </>
      )}
    </div>
  );
}

function readRouteFromLocation() {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, "");
  if (!path) return { route: "dashboard", tab: "designs", editor: false };
  if (path === "reset-password") return { route: "dashboard", tab: "designs", editor: false };
  if (path === "subscription") return { route: "billing", tab: "designs", editor: false };
  const [first, second] = path.split("/");
  if (first === "admin") {
    return { route: second === "affiliates" ? "admin-affiliates" : "admin", tab: "designs", editor: false };
  }
  if (first === "dashboard") {
    const nestedRoute = VALID_ROUTES.includes(second) ? second : "dashboard";
    const nestedTab = VALID_TABS.includes(path.split("/")[2]) ? path.split("/")[2] : "designs";
    return { route: nestedRoute, tab: nestedTab, editor: false };
  }
  const route = VALID_ROUTES.includes(first) ? first : "dashboard";
  const editor = isPlatformRoute(route) && second === "editor";
  const tab = VALID_TABS.includes(second) ? second : "designs";
  return { route, tab, editor };
}

function buildPath(route, tab, editorPlatform = "") {
  const safeRoute = VALID_ROUTES.includes(route) ? route : "dashboard";
  const safeTab = VALID_TABS.includes(tab) ? tab : "designs";
  if (safeRoute === "dashboard") return "/dashboard";
  if (safeRoute === "admin") return "/admin";
  if (safeRoute === "admin-affiliates") return "/admin/affiliates";
  if (editorPlatform === safeRoute && isPlatformRoute(safeRoute)) return `/${safeRoute}/editor`;
  if (safeTab === "designs") return `/${safeRoute}`;
  return `/${safeRoute}/${safeTab}`;
}

function isValidRoute(pathname) {
  const path = pathname.replace(/^\/+|\/+$/g, "");
  if (!path) return true; // "/"
  
  const segments = path.split("/");
  const first = segments[0];
  
  const staticRoutes = [
    "contact",
    "founder",
    "who-is-behind-this-tool",
    "privacy-policy",
    "terms-of-service",
    "refund-policy",
    "help-center",
    "security",
    "email-confirmed",
    "reset-password",
    "login",
    "signup",
    "pricing",
    "ai-listing-generator",
    "redbubble-automation-tool",
    "teepublic-automation-tool",
    "redbubble-upload-automation",
    "teepublic-upload-automation",
    "privacy",
    "terms",
    "help",
    "blog",
    "checkout",
    "thank-you",
    "extension-installed"
  ];
  
  if (first === "compare") {
    return segments.length === 2 && segments[1] === "podpilot-vs-merchghost-vs-merchtitans";
  }

  if (first === "customers") {
    return segments.length === 3 && segments[1] === "compare" && segments[2] === "podpilot-vs-merchghost-vs-merchtitans";
  }

  if (staticRoutes.includes(first)) {
    return first === "blog" ? segments.length <= 2 : segments.length === 1;
  }
  
  if (first === "dashboard") {
    return segments.length === 1;
  }
  
  if (first === "redbubble" || first === "teepublic") {
    if (segments.length === 1) return true;
    if (segments.length === 2) {
      return segments[1] === "import" || segments[1] === "designs" || segments[1] === "editor";
    }
    return false;
  }
  
  if (first === "profile") {
    return segments.length === 1;
  }

  if (first === "billing" || first === "subscription") {
    return segments.length === 1;
  }

  if (first === "affiliate") return segments.length === 1;

  if (first === "admin") {
    return segments.length === 1 || (segments.length === 2 && segments[1] === "affiliates");
  }
  
  return false;
}

export default function App() {
  const { loading, isAuthenticated, user, session, signOut } = useAuth();
  const authLoading = loading;
  const userId = user?.id || "";
  const isAdmin = user?.app_metadata?.role === "admin";
  const initialRoute = readRouteFromLocation();
  const [activeRoute, setActiveRoute] = useState(initialRoute.route);
  const [activeTab, setActiveTab] = useState(initialRoute.tab);
  const [editorPlatform, setEditorPlatform] = useState(initialRoute.editor ? initialRoute.route : "");
  const [editorKinds, setEditorKinds] = useState(() => ({
    redbubble: initialRoute.editor && initialRoute.route === "redbubble" ? "design" : "",
    teepublic: initialRoute.editor && initialRoute.route === "teepublic" ? "design" : "",
  }));
  const [retentionNoticeOpen, setRetentionNoticeOpen] = useState(false);

  const acknowledgeRetentionNotice = useCallback(() => {
    acknowledgeDesignRetentionNotice();
    setRetentionNoticeOpen(false);
  }, []);

  // Prevent crawlers from indexing private app and checkout routes.
  useEffect(() => {
    const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
    const publicExactPaths = [
      "/",
      "/pricing",
      "/blog",
      "/ai-listing-generator",
      "/redbubble-automation-tool",
      "/teepublic-automation-tool",
      "/redbubble-upload-automation",
      "/teepublic-upload-automation",
      "/help",
      "/help-center",
      "/contact",
      "/founder",
      "/who-is-behind-this-tool",
      "/privacy",
      "/privacy-policy",
      "/terms",
      "/terms-of-service",
      "/refund-policy",
      "/security",
      ...COMPARISON_ROUTES,
    ];
    const publicPathPrefixes = ["/blog"];
    const privateRoutes = ["dashboard", "redbubble", "teepublic", "billing", "subscription", "affiliate", "profile", "admin", "admin-affiliates"];
    const privatePathPrefixes = ["/dashboard", "/redbubble", "/teepublic", "/billing", "/subscription", "/affiliate", "/profile", "/admin"];
    const privateExactPaths = ["/checkout", "/login", "/signup", "/reset-password", "/email-confirmed"];
    const isPublicPath =
      publicExactPaths.includes(pathname) ||
      publicPathPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    const isPrivate =
      !isPublicPath &&
      (privateRoutes.includes(activeRoute) ||
        privateExactPaths.includes(pathname) ||
        privatePathPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)));
    let robotsMeta = document.querySelector("meta[name='robots']");
    if (!robotsMeta) {
      robotsMeta = document.createElement("meta");
      robotsMeta.setAttribute("name", "robots");
      document.head.appendChild(robotsMeta);
    }
    robotsMeta.setAttribute("content", isPrivate ? "noindex, nofollow" : "index, follow");
  }, [activeRoute]);
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("rb-theme");
    if (saved) return saved;
    return "light";
  });
  const [showImagesPanel, setShowImagesPanel] = useState(false);

  const [redbubbleDesigns, setRedbubbleDesigns] = useState([]);
  const [teepublicDesigns, setTeepublicDesigns] = useState([]);
  const [platformAccess, setPlatformAccess] = useState(DEFAULT_PLATFORM_ACCESS);
  const [subscriptionSummary, setSubscriptionSummary] = useState(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [subscriptionLoaded, setSubscriptionLoaded] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState("");
  const [subscriptionUserId, setSubscriptionUserId] = useState("");
  const [trialEligibility, setTrialEligibility] = useState(null);
  const [isLoadingPlatformAccess, setIsLoadingPlatformAccess] = useState(true);
  const [rbEditorIndex, setRbEditorIndex] = useState(() => readEditorIndex("redbubble"));
  const [rbEditorDesignId, setRbEditorDesignId] = useState(() => (
    initialRoute.editor && initialRoute.route === "redbubble" ? readEditorDesignId("redbubble") : ""
  ));
  const [tpEditorIndex, setTpEditorIndex] = useState(() => initialRoute.editor && initialRoute.route === "teepublic" ? readEditorIndex("teepublic") : -1);
  const [tpEditorDesignId, setTpEditorDesignId] = useState(() => (
    initialRoute.editor && initialRoute.route === "teepublic" ? readEditorDesignId("teepublic") : ""
  ));
  const [platformNavState, setPlatformNavState] = useState(() => ({
    redbubble: {
      lastView: initialRoute.editor && initialRoute.route === "redbubble" ? "editor" : readEditorView("redbubble"),
      activeDesignId: initialRoute.editor && initialRoute.route === "redbubble" ? readEditorDesignId("redbubble") : readEditorDesignId("redbubble"),
      activeDesignIndex: readEditorIndex("redbubble"),
    },
    teepublic: {
      lastView: initialRoute.editor && initialRoute.route === "teepublic" ? "editor" : readEditorView("teepublic"),
      activeDesignId: initialRoute.editor && initialRoute.route === "teepublic" ? readEditorDesignId("teepublic") : readEditorDesignId("teepublic"),
      activeDesignIndex: readEditorIndex("teepublic"),
    },
  }));
  const [editorDirtyState, setEditorDirtyState] = useState({
    redbubble: false,
    teepublic: false,
  });
  const editorDirtyStateRef = useRef(editorDirtyState);
  const [unsavedResetTokens, setUnsavedResetTokens] = useState({
    redbubble: 0,
    teepublic: 0,
  });
  const [unsavedPrompt, setUnsavedPrompt] = useState({
    open: false,
    platform: "",
    action: null,
  });
  const [dashboardToast, setDashboardToast] = useState(null);
  const [uploadControlPrompt, setUploadControlPrompt] = useState({
    visible: false,
    message: "",
    isSwitching: false,
  });
  const [isLoadingDesigns, setIsLoadingDesigns] = useState(false);
  const [isRefreshingDesigns, setIsRefreshingDesigns] = useState(false);
  const hasStartedInitialDesignLoad = useRef(false);
  const hasLoadedDesigns = useRef(false);
  const previousUserIdRef = useRef("");
  const designRefreshRequestsRef = useRef(new Map());
  const uploadStatusRowSignaturesRef = useRef(new Map());
  const uploadStatusEventSignaturesRef = useRef(new Map());
  const hasHydratedUploadStatusEventsRef = useRef(false);
  const uploadStatusFailedSyncRef = useRef(new Set());
  const redbubbleStatusReconcileInFlightRef = useRef(new Set());
  const redbubbleStatusReconciledRef = useRef(new Set());
  const subscriptionRequestRef = useRef(0);
  const subscriptionSnapshotRef = useRef({
    loaded: false,
    userId: "",
    summary: null,
    platformAccess: DEFAULT_PLATFORM_ACCESS,
  });

  const [isPasswordRecovery, setIsPasswordRecovery] = useState(
    () => window.location.pathname === "/reset-password"
  );

  useEffect(() => {
    if (authLoading) {
      debugSubscriptionLog("auth loading");
    } else {
      debugSubscriptionLog(`auth resolved user=${userId || "(none)"}`);
    }
  }, [authLoading, userId]);

  useEffect(() => {
    subscriptionSnapshotRef.current = {
      loaded: subscriptionLoaded,
      userId: subscriptionUserId,
      summary: subscriptionSummary,
      platformAccess,
    };
  }, [subscriptionLoaded, subscriptionUserId, subscriptionSummary, platformAccess]);

  useEffect(() => {
    editorDirtyStateRef.current = editorDirtyState;
  }, [editorDirtyState]);

  useEffect(() => {
    const hasDirtyEditor = Object.values(editorDirtyState).some(Boolean);
    if (!hasDirtyEditor) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
      return "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [editorDirtyState]);

  useEffect(() => {
    if (isAuthenticated) return;
    setUploadControlPrompt({ visible: false, message: "", isSwitching: false });
    subscriptionRequestRef.current += 1;
    previousUserIdRef.current = "";
    hasStartedInitialDesignLoad.current = false;
    hasLoadedDesigns.current = false;
    designRefreshRequestsRef.current.clear();
    uploadStatusRowSignaturesRef.current.clear();
    uploadStatusEventSignaturesRef.current.clear();
    hasHydratedUploadStatusEventsRef.current = false;
    uploadStatusFailedSyncRef.current.clear();
    redbubbleStatusReconcileInFlightRef.current.clear();
    redbubbleStatusReconciledRef.current.clear();
    setRedbubbleDesigns([]);
    setTeepublicDesigns([]);
    setIsLoadingDesigns(false);
    setPlatformAccess(DEFAULT_PLATFORM_ACCESS);
    setSubscriptionSummary(null);
    setSubscriptionLoading(false);
    setSubscriptionLoaded(false);
    setSubscriptionError("");
    setSubscriptionUserId("");
    setTrialEligibility(null);
    setIsLoadingPlatformAccess(true);
    setIsRefreshingDesigns(false);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !userId) return;
    if (previousUserIdRef.current && previousUserIdRef.current !== userId) {
      subscriptionRequestRef.current += 1;
      hasStartedInitialDesignLoad.current = false;
      hasLoadedDesigns.current = false;
      designRefreshRequestsRef.current.clear();
      uploadStatusRowSignaturesRef.current.clear();
      uploadStatusEventSignaturesRef.current.clear();
      hasHydratedUploadStatusEventsRef.current = false;
      uploadStatusFailedSyncRef.current.clear();
      redbubbleStatusReconcileInFlightRef.current.clear();
      redbubbleStatusReconciledRef.current.clear();
      setRedbubbleDesigns([]);
      setTeepublicDesigns([]);
      setPlatformAccess(DEFAULT_PLATFORM_ACCESS);
      setSubscriptionSummary(null);
      setSubscriptionLoading(false);
      setSubscriptionLoaded(false);
      setSubscriptionError("");
      setSubscriptionUserId("");
      setTrialEligibility(null);
      setIsLoadingPlatformAccess(true);
      setIsLoadingDesigns(false);
      setIsRefreshingDesigns(false);
    }
    previousUserIdRef.current = userId;
  }, [isAuthenticated, userId]);

  useEffect(() => {
    const handleUploadDeviceConflict = (event) => {
      setUploadControlPrompt({
        visible: true,
        message: event?.detail?.message || DEVICE_SWITCH_MESSAGE,
        isSwitching: false,
      });
    };
    window.addEventListener("podpilot:upload-device-conflict", handleUploadDeviceConflict);
    return () => window.removeEventListener("podpilot:upload-device-conflict", handleUploadDeviceConflict);
  }, []);

  useEffect(() => {
    if (!supabase) return undefined;
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setIsPasswordRecovery(true);
    });
    return () => subscription?.subscription?.unsubscribe();
  }, []);

  const fetchSubscriptionAndAccess = useCallback(async ({
    reason = "manual",
    manageLoading = true,
    deferInactive = false,
    force = false,
  } = {}) => {
    if (!isAuthenticated || !userId) return null;
    const requestId = subscriptionRequestRef.current + 1;
    subscriptionRequestRef.current = requestId;
    if (manageLoading) {
      setSubscriptionLoading(true);
    }
    setSubscriptionError("");
    setIsLoadingPlatformAccess(true);
    debugSubscriptionLog(`fetching subscription reason=${reason}`);
    try {
      const [nextSubscription, nextAccessRaw, nextTrialEligibility] = await Promise.all([
        getMySubscription({ force }),
        getMyPlatformAccess({ force }).catch((error) => {
          console.warn("[PodPilot] platform access refresh failed:", error?.message || error);
          return subscriptionSnapshotRef.current.platformAccess || DEFAULT_PLATFORM_ACCESS;
        }),
        getTrialEligibility({ force }).catch((error) => {
          console.warn("[PodPilot] trial eligibility refresh failed:", error?.message || error);
          return null;
        }),
      ]);
      if (subscriptionRequestRef.current !== requestId) return null;
      const nextAccess = normalizePlatformAccess(nextAccessRaw);
      const flags = getSubscriptionFlags(nextSubscription, true);
      debugSubscriptionLog("subscription response", nextSubscription);
      debugSubscriptionLog(
        `computed hasActiveSubscription=${flags.hasActiveSubscription} trialActive=${flags.trialActive} isWorkspaceLocked=${flags.isWorkspaceLocked}`,
      );
      setSubscriptionSummary(nextSubscription || null);
      setPlatformAccess(nextAccess);
      setTrialEligibility(nextTrialEligibility || null);
      setSubscriptionUserId(userId);
      setSubscriptionLoaded(!(deferInactive && flags.isWorkspaceLocked));
      return { summary: nextSubscription || null, platformAccess: nextAccess, flags };
    } catch (error) {
      if (subscriptionRequestRef.current !== requestId) return null;
      const snapshot = subscriptionSnapshotRef.current;
      const hasFreshPreviousState = snapshot.loaded && snapshot.userId === userId;
      console.warn("[PodPilot] subscription refresh failed:", error?.message || error);
      setSubscriptionError(
        "Please retry. We will not switch this workspace into preview mode until your subscription check completes.",
      );
      if (hasFreshPreviousState) {
        setSubscriptionSummary(snapshot.summary || null);
        setPlatformAccess(snapshot.platformAccess || DEFAULT_PLATFORM_ACCESS);
        setSubscriptionLoaded(true);
        setSubscriptionUserId(userId);
      } else {
        setSubscriptionSummary(null);
        setPlatformAccess(DEFAULT_PLATFORM_ACCESS);
        setSubscriptionLoaded(false);
        setSubscriptionUserId("");
      }
      return null;
    } finally {
      if (subscriptionRequestRef.current !== requestId) return;
      if (manageLoading) {
        setSubscriptionLoading(false);
      }
      setIsLoadingPlatformAccess(false);
    }
  }, [isAuthenticated, userId]);

  const setMarketplaceDesigns = useCallback((marketplace, value, { writeCache = true } = {}) => {
    const setter = getMarketplaceSetter(marketplace, setRedbubbleDesigns, setTeepublicDesigns);
    setter((current) => {
      const nextValue = typeof value === "function" ? value(current) : value;
      const nextDesigns = Array.isArray(nextValue) ? nextValue : [];
      if (writeCache && userId) {
        const currentKeys = new Set((current || []).map((design) => designDedupeKey(design, marketplace)).filter(Boolean));
        const addedCount = nextDesigns.filter((design) => {
          const key = designDedupeKey(design, marketplace);
          return key && !currentKeys.has(key);
        }).length;
        if (addedCount > 0) {
          cacheDebugLog(`mutation add marketplace=${marketplace} count=${addedCount}`);
        } else if (nextDesigns !== current) {
          cacheDebugLog(`mutation merge marketplace=${marketplace} count=${nextDesigns.length}`);
        }
        void setCachedDesigns(userId, marketplace, nextDesigns);
      }
      return nextDesigns;
    });
  }, [userId]);

  const prependMarketplaceDesigns = useCallback((marketplace, newDesigns = []) => {
    const incoming = Array.isArray(newDesigns) ? newDesigns.filter(Boolean) : [newDesigns].filter(Boolean);
    if (incoming.length === 0) return;
    cacheDebugLog(`mutation add marketplace=${marketplace} count=${incoming.length}`);
    setMarketplaceDesigns(marketplace, (current) => mergeDesignCollections(current, incoming, marketplace, { prepend: true }));
    if (userId) {
      void prependCachedDesigns(userId, marketplace, incoming).then(() => {
        cacheDebugLog("post-import cache write success");
      });
    }
  }, [setMarketplaceDesigns, userId]);

  const setRedbubbleDesignsCached = useCallback((value) => {
    setMarketplaceDesigns("redbubble", value);
  }, [setMarketplaceDesigns]);

  const setTeepublicDesignsCached = useCallback((value) => {
    setMarketplaceDesigns("teepublic", value);
  }, [setMarketplaceDesigns]);

  const fetchFreshDesigns = useCallback((marketplace, { preserveCurrent = false, dedupe = true } = {}) => {
    if (!isAuthenticated || !userId) return Promise.resolve(null);
    const requestKey = `${userId}:${marketplace}:${preserveCurrent ? "preserve" : "replace"}`;
    const existing = dedupe ? designRefreshRequestsRef.current.get(requestKey) : null;
    if (existing) return existing;

    cacheDebugLog(`background refresh started marketplace=${marketplace}`);
    const request = listDesigns(marketplace)
      .then(async (data) => {
        const freshDesigns = Array.isArray(data?.designs) ? data.designs : [];
        if (marketplace === "redbubble") {
          freshDesigns.forEach((design) => {
            console.info(
              `[PodPilot][Redbubble] fetched design id=${design.id || design.design_id || ""} backendStatus=${design.status || ""} uploadedAt=${design.uploaded_at || ""}`,
            );
          });
        }
        if (preserveCurrent) {
          setMarketplaceDesigns(marketplace, (current) => mergeDesignCollections(current, freshDesigns, marketplace));
          await mergeCachedDesigns(userId, marketplace, freshDesigns);
        } else {
          setMarketplaceDesigns(marketplace, (current) => {
            const localDrafts = current.filter(isLocalDraftDesign);
            return localDrafts.length > 0
              ? mergeDesignCollections(freshDesigns, localDrafts, marketplace, { prepend: true })
              : freshDesigns;
          });
          await setCachedDesigns(userId, marketplace, freshDesigns);
        }
        hasLoadedDesigns.current = true;
        cacheDebugLog(`background refresh success marketplace=${marketplace} count=${freshDesigns.length}`);
        return { marketplace, designs: freshDesigns, fromBackend: true };
      })
      .finally(() => {
        if (dedupe) designRefreshRequestsRef.current.delete(requestKey);
      });

    if (dedupe) designRefreshRequestsRef.current.set(requestKey, request);
    return request;
  }, [isAuthenticated, setMarketplaceDesigns, userId]);

  const refreshDesigns = useCallback(async ({
    force = false,
    invalidate = true,
    marketplaces = DESIGN_MARKETPLACES,
    preserveCurrent = false,
    dedupe = true,
    reason = "auto",
  } = {}) => {
    if (!isAuthenticated || !userId) return;

    const safeMarketplaces = marketplaces.filter((marketplace) => DESIGN_MARKETPLACES.includes(marketplace));
    const isInitialLoad = !hasStartedInitialDesignLoad.current;
    hasStartedInitialDesignLoad.current = true;

    let hadAnyCache = false;
    const needsBackend = [];

    if (!force) {
      const cachedResults = await Promise.all(
        safeMarketplaces.map((marketplace) => getCachedDesigns(userId, marketplace)),
      );

      cachedResults.forEach((cached, index) => {
        const marketplace = safeMarketplaces[index];
        if (!cached) {
          needsBackend.push(marketplace);
          return;
        }
        hadAnyCache = true;
        hasLoadedDesigns.current = true;
        setMarketplaceDesigns(marketplace, cached.designs, { writeCache: false });
        if (!isCacheFresh(cached.cachedAt, DESIGN_CACHE_TTL_MS)) {
          needsBackend.push(marketplace);
        }
      });
    } else {
      needsBackend.push(...safeMarketplaces);
      hadAnyCache = hasLoadedDesigns.current;
      if (invalidate) {
        safeMarketplaces.forEach((marketplace) => {
          void invalidateDesignCache(userId, marketplace);
        });
      }
    }

    if (needsBackend.length === 0) {
      setIsLoadingDesigns(false);
      setIsRefreshingDesigns(false);
      return;
    }

    if (isInitialLoad && !hadAnyCache) {
      setIsLoadingDesigns(true);
    } else {
      setIsLoadingDesigns(false);
      setIsRefreshingDesigns(true);
    }

    const results = await Promise.allSettled(
      needsBackend.map((marketplace) => fetchFreshDesigns(marketplace, { preserveCurrent, dedupe })),
    );
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length > 0) {
      console.warn("[PodPilot] design refresh failed:", failed[0].reason?.message || failed[0].reason);
      setDashboardToast({
        type: "error",
        message: hadAnyCache || hasLoadedDesigns.current
          ? "Showing saved workspace. Could not refresh."
          : "Could not load designs. Please try again.",
      });
    }

    setIsLoadingDesigns(false);
    setIsRefreshingDesigns(false);
    void reason;
  }, [
    fetchFreshDesigns,
    isAuthenticated,
    setMarketplaceDesigns,
    userId,
  ]);

  const refreshAfterUpload = useCallback((marketplace, reason = "upload-complete") => {
    if (!DESIGN_MARKETPLACES.includes(marketplace)) return;
    void refreshDesigns({
      force: true,
      marketplaces: [marketplace],
      preserveCurrent: true,
      dedupe: false,
      reason,
    });
  }, [refreshDesigns]);

  useEffect(() => {
    if (!isAuthenticated || !userId) return;
    if (hasCheckoutSuccessFlag()) return;
    void fetchSubscriptionAndAccess({ reason: "auth resolved" });
  }, [isAuthenticated, userId, fetchSubscriptionAndAccess]);

  useEffect(() => { refreshDesigns(); }, [refreshDesigns]);

  // Read the extension's local queue frequently while an upload is active. This is a
  // local browser message (not backend polling), so rows can update promptly without
  // increasing API traffic. A backend refresh still runs once when the queue settles.
  useEffect(() => {
    if (!isAuthenticated || !EXTENSION_ID.trim() || !window.chrome?.runtime?.sendMessage) return undefined;
    let cancelled = false;
    let timerId = null;
    let inFlight = false;
    let previousQueueStatus = "";

    const updateDesignRow = (platform, designId, status, errorMessage = "") => {
      const cleanPlatform = normalizeUploadPlatform(platform);
      const cleanDesignId = String(designId || "").trim();
      const cleanStatus = normalizeExtensionUploadStatus(status);
      if (!cleanPlatform || !cleanDesignId || !cleanStatus) return;

      const signatureKey = `${cleanPlatform}:${cleanDesignId}`;
      const signature = `${cleanStatus}:${errorMessage || ""}`;
      if (uploadStatusRowSignaturesRef.current.get(signatureKey) === signature) return;
      uploadStatusRowSignaturesRef.current.set(signatureKey, signature);

      console.info("[PodPilot Upload Status] status update received");
      console.info(`[PodPilot Upload Status] updating platform=${cleanPlatform} designId=${cleanDesignId} status=${cleanStatus}`);
      setMarketplaceDesigns(cleanPlatform, (current) => {
        let changed = false;
          const next = current.map((design) => {
            const rowId = String(design.id || design.design_id || "").trim();
            if (rowId !== cleanDesignId) return design;
            const backendAlreadyUploaded = String(design.status || "").toLowerCase() === "uploaded" || Boolean(design.uploaded_at);
            if (backendAlreadyUploaded && cleanStatus !== "uploaded") return design;
            const nextError = cleanStatus === "failed" ? (errorMessage || design.error_message || "") : "";
          if (design.status === cleanStatus && (design.error_message || "") === nextError) return design;
          changed = true;
          return { ...design, status: cleanStatus, error_message: nextError };
        });
        return changed ? next : current;
      });
    };

    const reconcileConfirmedRedbubbleUpload = async (designId) => {
      const cleanDesignId = String(designId || "").trim();
      const eventKey = `redbubble:${cleanDesignId}`;
      if (
        !cleanDesignId ||
        redbubbleStatusReconciledRef.current.has(eventKey) ||
        redbubbleStatusReconcileInFlightRef.current.has(eventKey)
      ) return;

      redbubbleStatusReconcileInFlightRef.current.add(eventKey);
      try {
        const updated = await updateDesignStatus(cleanDesignId, {
          status: "uploaded",
          stage: "website_extension_reconcile",
        });
        if (cancelled) return;
        if (normalizeUploadPlatform(updated?.marketplace) !== "redbubble" || updated?.status !== "uploaded") {
          throw new Error("Backend did not confirm the Redbubble upload status.");
        }
        redbubbleStatusReconciledRef.current.add(eventKey);
        uploadStatusFailedSyncRef.current.delete(eventKey);
        updateDesignRow("redbubble", cleanDesignId, "uploaded", "");
        void refreshDesigns({
          force: true,
          marketplaces: ["redbubble"],
          preserveCurrent: true,
          dedupe: false,
          reason: "redbubble-status-reconciled",
        });
      } catch (error) {
        if (cancelled) return;
        uploadStatusFailedSyncRef.current.add(eventKey);
        console.error("[PodPilot][Redbubble] website status reconciliation failed", error?.message || error);
        setDashboardToast({
          type: "error",
          message: "Redbubble upload succeeded, but its dashboard status could not be saved. Please try Refresh.",
        });
      } finally {
        redbubbleStatusReconcileInFlightRef.current.delete(eventKey);
      }
    };

    const scheduleNext = (delay) => {
      if (cancelled) return;
      if (timerId) window.clearTimeout(timerId);
      timerId = window.setTimeout(tick, delay);
    };

    const tick = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const ext = await new Promise((resolve) => {
          window.chrome.runtime.sendMessage(EXTENSION_ID, { action: "get_status" }, (response) => {
            if (window.chrome.runtime.lastError) { resolve({ ok: false }); return; }
            resolve(response || { ok: false });
          });
        });

        const extensionState = ext?.state;
        if (!ext?.ok || !extensionState || cancelled) return;
        const queueStatus = String(extensionState.status || "idle").toLowerCase();
        const queuePlatform = normalizeUploadPlatform(extensionState.marketplace);

        const queueIsActive = ACTIVE_EXTENSION_QUEUE_STATUSES.has(queueStatus);
        (Array.isArray(extensionState.queue) ? extensionState.queue : []).forEach((item) => {
          const itemStatus = normalizeExtensionUploadStatus(item.status);
          // save_designs initializes idle queue entries as pending; those are not
          // upload events and must never overwrite persisted table statuses.
          if (!queueIsActive && itemStatus === "not_uploaded") return;
          updateDesignRow(
            item.marketplace || queuePlatform,
            item.id || item.design_id,
            itemStatus,
            item.error_message || item.error || "",
          );
          const itemPlatform = normalizeUploadPlatform(item.marketplace || queuePlatform);
          if (itemPlatform === "redbubble" && itemStatus === "uploaded") {
            void reconcileConfirmedRedbubbleUpload(item.id || item.design_id);
          }
        });

        const isInitialStatusSyncHydration = !hasHydratedUploadStatusEventsRef.current;
        const syncEvents = Object.values(extensionState.statusSyncEvents || {});
        syncEvents.forEach((event) => {
          const platform = normalizeUploadPlatform(event?.platform);
          const designId = String(event?.designId || event?.design_id || "").trim();
          if (!platform || !designId) return;
          const eventKey = `${platform}:${designId}`;
          const eventSignature = `${event.updated_at || ""}:${event.backend_state || ""}:${event.status || ""}`;
          if (uploadStatusEventSignaturesRef.current.get(eventKey) === eventSignature) return;
          uploadStatusEventSignaturesRef.current.set(eventKey, eventSignature);

          updateDesignRow(platform, designId, event.status, event.error_message || "");
          if (event.backend_state === "success") {
            uploadStatusFailedSyncRef.current.delete(eventKey);
            console.info("[PodPilot Upload Status] backend update success");
          } else if (event.backend_state === "failed") {
            uploadStatusFailedSyncRef.current.add(eventKey);
            if (isInitialStatusSyncHydration) return;
            console.error("[PodPilot Upload Status] backend update failed");
            if (platform === "redbubble" && normalizeExtensionUploadStatus(event.status) === "uploaded") {
              void reconcileConfirmedRedbubbleUpload(designId);
            } else {
              setDashboardToast({
                type: "error",
                message: event.backend_error || "Upload status changed, but it could not be saved. Please try Refresh.",
              });
            }
          }
        });
        hasHydratedUploadStatusEventsRef.current = true;

        const wasActive = ACTIVE_EXTENSION_QUEUE_STATUSES.has(previousQueueStatus);
        const isActive = ACTIVE_EXTENSION_QUEUE_STATUSES.has(queueStatus);
        const platformHasFailedSync = queuePlatform && Array.from(uploadStatusFailedSyncRef.current)
          .some((key) => key.startsWith(`${queuePlatform}:`));
        if (wasActive && !isActive && !platformHasFailedSync && queuePlatform) {
          void refreshDesigns({
            force: true,
            marketplaces: [queuePlatform],
            preserveCurrent: true,
            reason: "extension-complete",
          });
        }
        previousQueueStatus = queueStatus;
      } catch (error) {
        console.warn("[PodPilot Upload Status] extension status check failed:", error?.message || error);
      } finally {
        inFlight = false;
        const isActive = ACTIVE_EXTENSION_QUEUE_STATUSES.has(previousQueueStatus);
        const isPlatformPage = activeRoute === "redbubble" || activeRoute === "teepublic";
        scheduleNext(isActive ? 1500 : (isPlatformPage ? 10000 : 30000));
      }
    };

    const checkNow = () => {
      if (document.visibilityState === "visible") scheduleNext(0);
    };
    void tick();
    window.addEventListener("focus", checkNow);
    document.addEventListener("visibilitychange", checkNow);
    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
      window.removeEventListener("focus", checkNow);
      document.removeEventListener("visibilitychange", checkNow);
    };
  }, [activeRoute, isAuthenticated, refreshDesigns, setMarketplaceDesigns]);

  // Sync designs to extension
  useEffect(() => {
    if (!isAuthenticated) return;
    const marketplace = activeRoute === "teepublic" ? "teepublic" : "redbubble";
    syncDesignsToExtension(
      marketplace === "teepublic" ? teepublicDesigns : redbubbleDesigns,
      session?.access_token,
    );
  }, [redbubbleDesigns, teepublicDesigns, activeRoute, isAuthenticated, session?.access_token]);

  useEffect(() => {
    localStorage.setItem("rb-theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.classList.remove("theme-light", "theme-dark");
    document.documentElement.classList.add(`theme-${theme}`);
    document.body.classList.remove("theme-light", "theme-dark");
    document.body.classList.add(`theme-${theme}`);
  }, [theme]);

  // ── URL sync ─────────────────────────────────────────────────────────────
  // Push the current route/tab into the URL so refresh stays on the same page.
  useEffect(() => {
    if (!isValidRoute(window.location.pathname)) {
      return;
    }
    if (
      isPasswordRecovery ||
      window.location.pathname === "/" ||
      window.location.pathname === "/pricing" ||
      window.location.pathname === "/ai-listing-generator" ||
      window.location.pathname === "/redbubble-automation-tool" ||
      window.location.pathname === "/teepublic-automation-tool" ||
      window.location.pathname === "/redbubble-upload-automation" ||
      window.location.pathname === "/teepublic-upload-automation" ||
      window.location.pathname === "/checkout" ||
      window.location.pathname.startsWith("/blog") ||
      window.location.pathname === "/contact" ||
      window.location.pathname === "/founder" ||
      window.location.pathname === "/who-is-behind-this-tool" ||
      window.location.pathname === "/privacy-policy" ||
      window.location.pathname === "/privacy" ||
      window.location.pathname === "/terms-of-service" ||
      window.location.pathname === "/terms" ||
      window.location.pathname === "/refund-policy" ||
      window.location.pathname === "/help-center" ||
      window.location.pathname === "/help" ||
      window.location.pathname === "/security" ||
      COMPARISON_ROUTES.includes(window.location.pathname) ||
      window.location.pathname === "/email-confirmed" ||
      window.location.pathname === "/login" ||
      window.location.pathname === "/signup" ||
      window.location.pathname === "/thank-you" ||
      window.location.pathname === "/extension-installed"
    ) {
      return;
    }
    const target = buildPath(activeRoute, activeTab, editorPlatform);
    const current = window.location.pathname + window.location.search + window.location.hash;
    const currentNoSearch = window.location.pathname;
    if (activeRoute === "billing" && currentNoSearch === "/subscription") {
      return;
    }
    if (currentNoSearch !== target) {
      const search = window.location.search || "";
      const hash = window.location.hash || "";
      window.history.replaceState(null, "", `${target}${search}${hash}`);
    }
    // We intentionally use replaceState so the browser back button still works
    // for top-level page changes via the navigation handler (which pushes).
    void current;
  }, [activeRoute, activeTab, editorPlatform, isPasswordRecovery]);

  // Respond to browser back/forward navigation
  useEffect(() => {
    function onPopState(event) {
      const next = readRouteFromLocation();
      const applyPopState = () => {
        setActiveRoute(next.route);
        setActiveTab(next.tab);
        setEditorPlatform(next.editor ? next.route : "");
        if (next.editor) {
          const historyKind = event.state?.editorKind;
          const historyIndex = Number(event.state?.selectedDesignIndex);
          const historyDesignId = String(event.state?.selectedDesignId || "").trim();
          if (Number.isInteger(historyIndex) && historyIndex >= 0) {
            if (next.route === "teepublic") setTpEditorIndex(historyIndex);
            else setRbEditorIndex(historyIndex);
          }
          if (next.route === "teepublic") {
            setTpEditorDesignId(historyDesignId || readEditorDesignId("teepublic"));
          } else if (next.route === "redbubble") {
            setRbEditorDesignId(historyDesignId || readEditorDesignId("redbubble"));
          }
          rememberPlatformNavigation(next.route, {
            lastView: "editor",
            activeDesignId: historyDesignId || readEditorDesignId(next.route),
            activeDesignIndex: Number.isInteger(historyIndex) && historyIndex >= 0 ? historyIndex : readEditorIndex(next.route),
          });
          setEditorKinds((current) => ({
            ...current,
            [next.route]: historyKind === "create" || historyKind === "design"
              ? historyKind
              : current[next.route] || "design",
          }));
        }
      };
      if (getDirtyNavigationPlatform()) {
        const target = buildPath(activeRoute, activeTab, editorPlatform);
        if (window.location.pathname !== target) {
          window.history.pushState(null, "", target);
        }
        guardUnsavedNavigation(applyPopState);
        return;
      }
      applyPopState();
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [activeRoute, activeTab, editorPlatform, guardUnsavedNavigation]);

  useEffect(() => {
    if (editorPlatform !== "redbubble" || editorKinds.redbubble !== "design") return;
    if (isLoadingDesigns || !hasLoadedDesigns.current) return;
    if (redbubbleDesigns.length === 0) {
      handleEditorUnavailable("redbubble", "no-designs");
      return;
    }
    if (rbEditorDesignId) {
      const idIndex = findDesignIndexById(redbubbleDesigns, rbEditorDesignId);
      if (idIndex >= 0) {
        if (idIndex !== rbEditorIndex) setRbEditorIndex(idIndex);
        rememberPlatformNavigation("redbubble", {
          lastView: "editor",
          activeDesignId: rbEditorDesignId,
          activeDesignIndex: idIndex,
        });
        logNavigation(`editor restored platform=redbubble designId=${rbEditorDesignId} filename=${redbubbleDesigns[idIndex]?.filename || ""}`);
        return;
      }
      handleEditorUnavailable("redbubble", "active-design-missing");
      return;
    }
    const fallbackIndex = Math.max(0, Math.min(rbEditorIndex || 0, redbubbleDesigns.length - 1));
    const fallbackDesign = redbubbleDesigns[fallbackIndex];
    const fallbackId = designIdentity(fallbackDesign);
    if (fallbackId) {
      setRbEditorIndex(fallbackIndex);
      setRbEditorDesignId(fallbackId);
      rememberPlatformNavigation("redbubble", {
        lastView: "editor",
        activeDesignId: fallbackId,
        activeDesignIndex: fallbackIndex,
      });
      logNavigation(`editor restored platform=redbubble designId=${fallbackId} filename=${fallbackDesign.filename || ""}`);
    }
  }, [editorKinds.redbubble, editorPlatform, isLoadingDesigns, rbEditorDesignId, rbEditorIndex, redbubbleDesigns]);

  useEffect(() => {
    if (editorPlatform !== "teepublic" || editorKinds.teepublic !== "design") return;
    if (isLoadingDesigns || !hasLoadedDesigns.current) return;
    if (teepublicDesigns.length === 0) {
      handleEditorUnavailable("teepublic", "no-designs");
      return;
    }
    if (tpEditorDesignId) {
      const idIndex = findDesignIndexById(teepublicDesigns, tpEditorDesignId);
      if (idIndex >= 0) {
        if (idIndex !== tpEditorIndex) setTpEditorIndex(idIndex);
        rememberPlatformNavigation("teepublic", {
          lastView: "editor",
          activeDesignId: tpEditorDesignId,
          activeDesignIndex: idIndex,
        });
        logNavigation(`editor restored platform=teepublic designId=${tpEditorDesignId} filename=${teepublicDesigns[idIndex]?.filename || ""}`);
        return;
      }
      handleEditorUnavailable("teepublic", "active-design-missing");
      return;
    }
    const fallbackIndex = Math.max(0, Math.min(tpEditorIndex || 0, teepublicDesigns.length - 1));
    const fallbackDesign = teepublicDesigns[fallbackIndex];
    const fallbackId = designIdentity(fallbackDesign);
    if (fallbackId) {
      setTpEditorIndex(fallbackIndex);
      setTpEditorDesignId(fallbackId);
      rememberPlatformNavigation("teepublic", {
        lastView: "editor",
        activeDesignId: fallbackId,
        activeDesignIndex: fallbackIndex,
      });
      logNavigation(`editor restored platform=teepublic designId=${fallbackId} filename=${fallbackDesign.filename || ""}`);
    }
  }, [editorKinds.teepublic, editorPlatform, isLoadingDesigns, teepublicDesigns, tpEditorDesignId, tpEditorIndex]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const rawToast = localStorage.getItem("rb-dashboard-toast");
    if (!rawToast) return;
    try { setDashboardToast(JSON.parse(rawToast)); } catch { setDashboardToast({ type: "success", message: AUTH_MESSAGES.loginSuccess }); }
    localStorage.removeItem("rb-dashboard-toast");
  }, [isAuthenticated]);

  useEffect(() => {
    if (!dashboardToast) return undefined;
    const timer = window.setTimeout(() => setDashboardToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [dashboardToast]);

  const refreshSubscriptionAfterCheckout = useCallback(async () => {
    if (!isAuthenticated || !userId) return false;
    debugSubscriptionLog("checkout completed, refreshing subscription");
    setDashboardToast({
      type: "success",
      message: "Subscription started. Verifying your plan...",
    });
    setSubscriptionLoading(true);
    setSubscriptionError("");
    let sawBackendResponse = false;
    for (let attempt = 0; attempt < SUBSCRIPTION_POLL_ATTEMPTS; attempt += 1) {
      const result = await fetchSubscriptionAndAccess({
        reason: `checkout poll ${attempt + 1}`,
        manageLoading: false,
        deferInactive: true,
        force: true,
      });
      if (result) {
        sawBackendResponse = true;
      }
      if (result?.flags && !result.flags.isWorkspaceLocked) {
        setSubscriptionLoaded(true);
        setSubscriptionLoading(false);
        clearCheckoutFlagFromUrl();
        setDashboardToast({
          type: "success",
          message: "Subscription confirmed. Your workspace is unlocked.",
        });
        return true;
      }
      if (attempt < SUBSCRIPTION_POLL_ATTEMPTS - 1) {
        await wait(SUBSCRIPTION_POLL_INTERVAL_MS);
      }
    }
    setSubscriptionLoading(false);
    clearCheckoutFlagFromUrl();
    if (sawBackendResponse) {
      setSubscriptionLoaded(true);
      setDashboardToast({
        type: "error",
        message: "Payment received but subscription is still syncing. Please wait or refresh.",
      });
    } else {
      setSubscriptionLoaded(false);
      setSubscriptionError(
        "Payment received but subscription is still syncing. Please wait or refresh.",
      );
    }
    return false;
  }, [fetchSubscriptionAndAccess, isAuthenticated, userId]);

  useEffect(() => {
    if (!isAuthenticated || !userId || !hasCheckoutSuccessFlag()) return;
    void refreshSubscriptionAfterCheckout();
  }, [isAuthenticated, userId, refreshSubscriptionAfterCheckout]);

  // Resume Paddle checkout right after login/signup if a plan was pending.
  // Subscription checkout always returns to the dedicated inline page.
  useEffect(() => {
    if (!isAuthenticated) return;
    const pendingCheckout = getPendingCheckoutPlan();
    if (!pendingCheckout) return;
    const plan = pendingCheckout.plan;
    const billingCycle = pendingCheckout.billing_cycle || "monthly";
    if (window.location.pathname === "/checkout") {
      clearPendingCheckoutPlan();
      return;
    }
    if (CHECKOUT_DEBUG) {
      // eslint-disable-next-line no-console
      console.log(`[AuthFlow] pendingCheckoutPlan=${plan} billing=${billingCycle}`);
    }
    clearPendingCheckoutPlan();
    const urlPlan = plan === "all_platforms" ? "all-platforms" : plan;
    window.location.assign(`/checkout?plan=${encodeURIComponent(urlPlan)}&billing=${encodeURIComponent(billingCycle)}`);
  }, [isAuthenticated]);

  function handleImportComplete(persistedDesigns) {
    const marketplace = activeRoute === "teepublic" ? "teepublic" : "redbubble";
    const importedDesigns = Array.isArray(persistedDesigns) ? persistedDesigns : [];
    if (importedDesigns.length > 0) {
      prependMarketplaceDesigns(marketplace, importedDesigns);
    }
    setActiveTab("designs");
    const target = buildPath(activeRoute, "designs");
    if (window.location.pathname !== target) {
      window.history.pushState(null, "", target);
    }
    cacheDebugLog("post-import background refresh started");
    void refreshDesigns({
      force: true,
      invalidate: importedDesigns.length === 0,
      marketplaces: [marketplace],
      preserveCurrent: importedDesigns.length > 0,
      reason: "import",
    });
  }

  function handleDesignsCopied(targetMarketplace, copiedDesigns = []) {
    if (!DESIGN_MARKETPLACES.includes(targetMarketplace)) return;
    const incoming = Array.isArray(copiedDesigns) ? copiedDesigns.filter(Boolean) : [];
    if (incoming.length > 0) {
      prependMarketplaceDesigns(targetMarketplace, incoming);
    }
    void refreshDesigns({
      force: true,
      marketplaces: [targetMarketplace],
      preserveCurrent: true,
      dedupe: true,
      reason: "cross-platform-copy",
    });
  }

  function setPlatformUnsaved(platform, isDirty) {
    if (!isPlatformRoute(platform)) return;
    const nextValue = Boolean(isDirty);
    if (editorDirtyStateRef.current[platform] !== nextValue) {
      editorDirtyStateRef.current = {
        ...editorDirtyStateRef.current,
        [platform]: nextValue,
      };
    }
    setEditorDirtyState((current) => (
      current[platform] === nextValue
        ? current
        : { ...current, [platform]: nextValue }
    ));
  }

  function getDirtyNavigationPlatform() {
    if (isPlatformRoute(editorPlatform) && editorDirtyStateRef.current[editorPlatform]) {
      return editorPlatform;
    }
    if (isPlatformRoute(activeRoute) && editorDirtyStateRef.current[activeRoute]) {
      return activeRoute;
    }
    return DESIGN_MARKETPLACES.find((platform) => editorDirtyStateRef.current[platform]) || "";
  }

  function clearPlatformUnsaved(platform) {
    if (!isPlatformRoute(platform)) return;
    setPlatformUnsaved(platform, false);
    setUnsavedResetTokens((current) => ({
      ...current,
      [platform]: current[platform] + 1,
    }));
  }

  function guardUnsavedNavigation(action) {
    const dirtyPlatform = getDirtyNavigationPlatform();
    if (!dirtyPlatform) {
      action();
      return true;
    }
    setUnsavedPrompt({
      open: true,
      platform: dirtyPlatform,
      action,
    });
    return false;
  }

  function stayOnUnsavedEditor() {
    setUnsavedPrompt({ open: false, platform: "", action: null });
  }

  function leaveUnsavedEditor() {
    const pending = unsavedPrompt;
    if (pending.platform) clearPlatformUnsaved(pending.platform);
    setUnsavedPrompt({ open: false, platform: "", action: null });
    if (typeof pending.action === "function") pending.action();
  }

  function rememberPlatformNavigation(platform, patch = {}) {
    if (!isPlatformRoute(platform)) return;
    setPlatformNavState((current) => {
      const previous = current[platform] || { lastView: "list", activeDesignId: "", activeDesignIndex: 0 };
      const next = { ...previous, ...patch };
      if (patch.lastView) writeEditorView(platform, next.lastView);
      if (Object.prototype.hasOwnProperty.call(patch, "activeDesignId")) {
        writeEditorDesignId(platform, next.activeDesignId || "");
      }
      if (Object.prototype.hasOwnProperty.call(patch, "activeDesignIndex")) {
        writeEditorIndex(platform, next.activeDesignIndex || 0);
      }
      return { ...current, [platform]: next };
    });
  }

  function restorePlatformNavigation(platform) {
    const designs = platform === "teepublic" ? teepublicDesigns : redbubbleDesigns;
    const state = platformNavState[platform] || {};
    const restoreView = state.lastView === "editor" ? "editor" : "list";
    const activeDesignId = String(state.activeDesignId || readEditorDesignId(platform) || "").trim();
    const activeDesignIndex = Number.isInteger(state.activeDesignIndex) ? state.activeDesignIndex : readEditorIndex(platform);
    logNavigation(`switch platform=${platform} restoreView=${restoreView} activeDesignId=${activeDesignId}`);

    setActiveRoute(platform);
    setActiveTab("designs");

    if (restoreView === "editor") {
      const idIndex = findDesignIndexById(designs, activeDesignId);
      const fallbackDesign = activeDesignId
        ? null
        : designs[Math.max(0, Math.min(activeDesignIndex || 0, Math.max(0, designs.length - 1)))] || null;
      const resolvedDesign = idIndex >= 0 ? designs[idIndex] : fallbackDesign;
      const canWaitForDesignLoad = activeDesignId && (!hasLoadedDesigns.current || isLoadingDesigns);

      if (resolvedDesign || canWaitForDesignLoad) {
        const resolvedId = designIdentity(resolvedDesign) || activeDesignId;
        const resolvedIndex = idIndex >= 0 ? idIndex : Math.max(0, activeDesignIndex || 0);
        if (platform === "teepublic") {
          setTpEditorIndex(resolvedIndex);
          setTpEditorDesignId(resolvedId);
        } else {
          setRbEditorIndex(resolvedIndex);
          setRbEditorDesignId(resolvedId);
        }
        rememberPlatformNavigation(platform, {
          lastView: "editor",
          activeDesignId: resolvedId,
          activeDesignIndex: resolvedIndex,
        });
        setEditorKinds((current) => ({ ...current, [platform]: "design" }));
        setEditorPlatform(platform);
        const target = buildPath(platform, "designs", platform);
        const historyState = {
          editorPlatform: platform,
          editorKind: "design",
          selectedDesignIndex: resolvedIndex,
          selectedDesignId: resolvedId,
        };
        if (window.location.pathname !== target) window.history.pushState(historyState, "", target);
        else window.history.replaceState(historyState, "", target);
        if (resolvedDesign) {
          logNavigation(`editor restored platform=${platform} designId=${resolvedId} filename=${resolvedDesign.filename || ""}`);
        }
        return;
      }

      logNavigation(`fallback to list reason=missing-active-design platform=${platform} activeDesignId=${activeDesignId}`);
    }

    setEditorPlatform("");
    const target = buildPath(platform, "designs");
    if (window.location.pathname !== target) {
      window.history.pushState({ editorPlatform: "", editorKind: "" }, "", target);
    }
  }

  function handleNavigate(route) {
    guardUnsavedNavigation(() => applyNavigate(route));
  }

  function applyNavigate(route) {
    if (isPlatformRoute(route)) {
      restorePlatformNavigation(route);
      return;
    }
    setActiveRoute(route);
    setActiveTab("designs");
    setEditorPlatform("");
    const target = buildPath(route, "designs");
    if (window.location.pathname !== target) {
      window.history.pushState(null, "", target);
    }
  }

  function handleTabChange(nextTab) {
    guardUnsavedNavigation(() => applyTabChange(nextTab));
  }

  function applyTabChange(nextTab) {
    setActiveTab(nextTab);
    setEditorPlatform("");
    const target = buildPath(activeRoute, nextTab);
    if (window.location.pathname !== target) {
      window.history.pushState(null, "", target);
    }
  }

  function handleOpenEditor(platform, kind = "design", index = null, designId = "") {
    if (!isPlatformRoute(platform)) return;
    const designs = platform === "teepublic" ? teepublicDesigns : redbubbleDesigns;
    const selectedDesignId = String(designId || "").trim();
    const designFromIdIndex = findDesignIndexById(designs, selectedDesignId);
    const designFromId = designFromIdIndex >= 0 ? designs[designFromIdIndex] : null;
    const designFromIndex = Number.isInteger(index) && index >= 0 ? designs[index] : null;
    const requestedDesign = designFromId || designFromIndex || null;
    const nextDesignId = selectedDesignId || designIdentity(requestedDesign);
    const nextIndex = designFromIdIndex >= 0
      ? designFromIdIndex
      : (Number.isInteger(index) && index >= 0 ? index : Math.max(0, findDesignIndexById(designs, nextDesignId)));

    if (Number.isInteger(nextIndex) && nextIndex >= 0) {
      if (platform === "teepublic") setTpEditorIndex(nextIndex);
      else setRbEditorIndex(nextIndex);
    }
    if (nextDesignId) {
      if (platform === "teepublic") setTpEditorDesignId(nextDesignId);
      else setRbEditorDesignId(nextDesignId);
    }
    rememberPlatformNavigation(platform, {
      lastView: kind === "design" ? "editor" : "list",
      activeDesignId: kind === "design" ? nextDesignId : "",
      activeDesignIndex: Number.isInteger(nextIndex) && nextIndex >= 0 ? nextIndex : 0,
    });
    if (kind === "design") {
      logNavigation(`editor restored platform=${platform} designId=${nextDesignId || ""} filename=${requestedDesign?.filename || ""}`);
    }
    setEditorKinds((current) => ({ ...current, [platform]: kind }));
    setActiveRoute(platform);
    setActiveTab("designs");
    setEditorPlatform(platform);
    const target = buildPath(platform, "designs", platform);
    const historyState = {
      editorPlatform: platform,
      editorKind: kind,
      selectedDesignIndex: Number.isInteger(nextIndex) && nextIndex >= 0 ? nextIndex : 0,
      selectedDesignId: kind === "design" ? nextDesignId : "",
    };
    if (window.location.pathname !== target) {
      window.history.pushState(historyState, "", target);
    } else {
      window.history.replaceState(historyState, "", target);
    }
  }

  function handleBackToDesigns(platform) {
    guardUnsavedNavigation(() => applyBackToDesigns(platform));
  }

  function applyBackToDesigns(platform) {
    setActiveRoute(platform);
    setActiveTab("designs");
    setEditorPlatform("");
    rememberPlatformNavigation(platform, { lastView: "list" });
    const target = buildPath(platform, "designs");
    if (window.location.pathname !== target) window.history.pushState({ editorPlatform: "", editorKind: "" }, "", target);
  }

  function handleEditorUnavailable(platform, reason = "active-design-unavailable") {
    logNavigation(`fallback to list reason=${reason} platform=${platform}`);
    rememberPlatformNavigation(platform, { lastView: "list" });
    setEditorKinds((current) => ({ ...current, [platform]: "" }));
    setDashboardToast({
      type: "info",
      message: `No ${platform === "teepublic" ? "TeePublic" : "Redbubble"} design is available to edit. Add or import a design first.`,
    });
    setActiveRoute(platform);
    setActiveTab("designs");
    setEditorPlatform("");
    window.history.replaceState(null, "", buildPath(platform, "designs"));
  }

  async function handleSignOut() {
    localStorage.setItem("rb-auth-toast", JSON.stringify({ type: "success", message: AUTH_MESSAGES.logoutSuccess }));
    try {
      await clearDesignCacheForUser(userId);
      setRedbubbleDesigns([]);
      setTeepublicDesigns([]);
      await signOut();
    } catch (error) {
      localStorage.removeItem("rb-auth-toast");
      setDashboardToast({ type: "error", message: error?.message || "Logout failed." });
    }
  }

  async function handleUploadControlSwitch() {
    setUploadControlPrompt((current) => ({ ...current, isSwitching: true }));
    try {
      await switchDevice();
      setUploadControlPrompt({ visible: false, message: "", isSwitching: false });
      setDashboardToast({
        type: "success",
        message: "Upload control switched to this device.",
      });
    } catch (error) {
      const { message } = parseDeviceError(error);
      setUploadControlPrompt({
        visible: true,
        message: message || DEVICE_SWITCH_MESSAGE,
        isSwitching: false,
      });
    }
  }

  // ── Render gates ──────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="pp-loading">
        <img src="/brand/podpilot-logo.svg" alt="PodPilot" className="pp-loading-logo" />
        <strong>Checking session...</strong>
      </div>
    );
  }

  if (!isValidRoute(window.location.pathname)) {
    return <NotFoundPage isAuthenticated={isAuthenticated} theme={theme} />;
  }

  if (isPasswordRecovery) {
    return <ResetPasswordPage onBackToSignIn={() => { setIsPasswordRecovery(false); window.history.replaceState(null, "", "/dashboard"); }} />;
  }

  if (window.location.pathname === "/email-confirmed") {
    return <EmailConfirmedPage />;
  }

  if (window.location.pathname === "/") {
    return <LandingPage theme={theme} setTheme={setTheme} />;
  }

  if (window.location.pathname === "/pricing") {
    return <PricingPage theme={theme} setTheme={setTheme} subscriptionSummary={subscriptionSummary} />;
  }

  if (COMPARISON_ROUTES.includes(window.location.pathname)) {
    return <ComparisonPage theme={theme} setTheme={setTheme} />;
  }

  if (window.location.pathname === "/redbubble-automation-tool") {
    return <RedbubbleAutomationToolPage theme={theme} setTheme={setTheme} />;
  }

  if (window.location.pathname === "/teepublic-automation-tool") {
    return <TeePublicAutomationToolPage />;
  }

  const seoRouteAliases = {
    "/ai-listing-generator": "ai-listing-generator-for-print-on-demand",
    "/redbubble-upload-automation": "redbubble-upload-automation",
    "/teepublic-upload-automation": "teepublic-upload-automation",
  };
  if (seoRouteAliases[window.location.pathname]) {
    return (
      <BlogPage
        theme={theme}
        setTheme={setTheme}
        slug={seoRouteAliases[window.location.pathname]}
        canonicalPath={window.location.pathname}
      />
    );
  }

  if (window.location.pathname === "/checkout") {
    return <CheckoutPage theme={theme} setTheme={setTheme} />;
  }

  if (window.location.pathname === "/blog" || window.location.pathname.startsWith("/blog/")) {
    const slug = window.location.pathname.replace(/^\/blog\/?/, "").replace(/\/+$/, "");
    return <BlogPage theme={theme} setTheme={setTheme} slug={slug} />;
  }

  if (window.location.pathname === "/contact") {
    return <ContactPage />;
  }

  if (window.location.pathname === "/founder" || window.location.pathname === "/who-is-behind-this-tool") {
    return <FounderPage />;
  }

  if (window.location.pathname === "/privacy-policy" || window.location.pathname === "/privacy") {
    return <PrivacyPolicyPage />;
  }

  if (window.location.pathname === "/terms-of-service" || window.location.pathname === "/terms") {
    return <TermsOfServicePage />;
  }

  if (window.location.pathname === "/refund-policy") {
    return <RefundPolicyPage />;
  }

  if (window.location.pathname === "/help-center" || window.location.pathname === "/help") {
    return <HelpCenterPage />;
  }

  if (window.location.pathname === "/security") {
    return <SecurityPage />;
  }

  if (window.location.pathname === "/thank-you" || window.location.pathname === "/extension-installed") {
    return <ThankYouPage />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  const isExtensionAuth = new URLSearchParams(window.location.search).get("source") === "extension";
  if (isExtensionAuth) {
    return <ExtensionAuthSuccess session={session} />;
  }

  if (subscriptionError && !subscriptionLoaded && !subscriptionLoading) {
    return (
      <SubscriptionHydrationScreen
        error={subscriptionError}
        isRetrying={subscriptionLoading}
        onRetry={() => fetchSubscriptionAndAccess({ reason: "retry" })}
      />
    );
  }

  if (subscriptionLoading || !subscriptionLoaded) {
    return <SubscriptionHydrationScreen />;
  }

  // ── Marketplace-specific state ────────────────────────────────────────────
  const redbubbleImages = deriveImagesFromDesigns(redbubbleDesigns);
  const teepublicImages = deriveImagesFromDesigns(teepublicDesigns);
  const subscriptionFlags = getSubscriptionFlags(subscriptionSummary, subscriptionLoaded);
  const workspaceLocked = subscriptionFlags.isWorkspaceLocked;
  const activePlatformLocked = (
    subscriptionLoaded &&
    !subscriptionLoading &&
    !isLoadingPlatformAccess &&
    isPlatformRoute(activeRoute) &&
    !platformAccess?.[activeRoute]
  );
  const redbubbleLocked = subscriptionLoaded && !subscriptionLoading && !isLoadingPlatformAccess && !platformAccess?.redbubble;
  const teepublicLocked = subscriptionLoaded && !subscriptionLoading && !isLoadingPlatformAccess && !platformAccess?.teepublic;
  const isPastDue = subscriptionSummary?.is_past_due === true || subscriptionSummary?.status === "past_due";
  const paymentRecoveryRequired = isPastDue && subscriptionSummary?.past_due_grace_active !== true;
  const openPaymentRecovery = async () => {
    const data = await createBillingPortalSession();
    if (!data?.url) throw new Error("Paddle did not return a portal URL.");
    window.open(data.url, "_blank", "noopener,noreferrer");
  };
  const handleLockedPaidFeature = paymentRecoveryRequired
    ? () => openPaymentRecovery().catch((error) => {
        const detail = error?.response?.data?.detail;
        setDashboardToast({
          type: "error",
          message: typeof detail === "string" && detail
            ? detail
            : "Could not open the billing portal. Please try again.",
        });
      })
    : openPricing;
  debugSubscriptionLog(`route decision route=${activeRoute} workspaceLocked=${workspaceLocked} platformLocked=${activePlatformLocked}`);

  return (
    <>
      <div className={`pp-app theme-${theme}`}>
        <Sidebar
          activeRoute={activeRoute}
          onNavigate={handleNavigate}
          user={user}
          onSignOut={handleSignOut}
          theme={theme}
          setTheme={setTheme}
          platformAccess={platformAccess}
          trialEligibility={trialEligibility}
          isAdmin={isAdmin}
        />

      <main className="pp-main">
        {/* Toast */}
        {dashboardToast && (
          <div className={`app-toast app-toast-${dashboardToast.type}`} role="status">
            <span>{dashboardToast.message}</span>
            <button type="button" onClick={() => setDashboardToast(null)} aria-label="Dismiss"><Icon name="x" /></button>
          </div>
        )}

        {uploadControlPrompt.visible && (
          <div className="upload-control-prompt" role="alertdialog" aria-live="assertive" aria-label="Upload session already active">
            <div>
              <strong>Upload session already active</strong>
              <span>{uploadControlPrompt.message || DEVICE_SWITCH_MESSAGE}</span>
            </div>
            <div className="upload-control-prompt-actions">
              <button type="button" className="primary-button" onClick={handleUploadControlSwitch} disabled={uploadControlPrompt.isSwitching}>
                {uploadControlPrompt.isSwitching ? "Switching..." : "Switch upload control to this device"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setUploadControlPrompt({ visible: false, message: "", isSwitching: false })}
              >
                Not now
              </button>
            </div>
          </div>
        )}

        {(activeRoute === "dashboard" || isPlatformRoute(activeRoute)) && isPastDue && (
          <PaymentRecoveryBanner
            summary={subscriptionSummary}
            onRecoverPayment={openPaymentRecovery}
          />
        )}

        {(activeRoute === "dashboard" || isPlatformRoute(activeRoute)) && workspaceLocked && !isPastDue && (
          <PreviewModeBanner trialEligibility={trialEligibility} />
        )}

        {/* Dashboard */}
        {activeRoute === "dashboard" && (
          <Dashboard
            redbubbleDesigns={redbubbleDesigns}
            teepublicDesigns={teepublicDesigns}
            isLoading={isLoadingDesigns}
            isRefreshing={isRefreshingDesigns && hasLoadedDesigns.current}
            onNavigate={handleNavigate}
            theme={theme}
            setTheme={setTheme}
            platformAccess={platformAccess}
            subscriptionSummary={subscriptionSummary}
            isWorkspaceLocked={workspaceLocked}
            trialEligibility={trialEligibility}
            onOpenRetentionNotice={() => setRetentionNoticeOpen(true)}
          />
        )}

        {/* Redbubble — direct to designs, import opens inline */}
        {(
          <div hidden={activeRoute !== "redbubble"} className={`pp-marketplace-view${redbubbleLocked ? " is-workspace-locked" : ""}`}>
            {isLoadingPlatformAccess || isLoadingDesigns ? (
              <div className="pp-loading"><strong>Loading Redbubble access...</strong></div>
            ) : activeRoute === "redbubble" && activeTab === "import" ? (
              <ImportDesigns
                onImportComplete={handleImportComplete}
                onBackToDesigns={() => handleTabChange("designs")}
                existingDesigns={redbubbleDesigns}
                isWorkspaceLocked={redbubbleLocked}
                onLockedAction={handleLockedPaidFeature}
              />
            ) : (
              <>
                <DesignManager
                  designs={redbubbleDesigns}
                  uploadedImages={redbubbleImages}
                  onDesignsChange={setRedbubbleDesignsCached}
                  onImportClick={() => redbubbleLocked ? handleLockedPaidFeature() : handleTabChange("import")}
                  onUploadImagesClick={() => redbubbleLocked ? handleLockedPaidFeature() : setShowImagesPanel((c) => !c)}
                  onImagesUploaded={() => refreshAfterUpload("redbubble", "images-uploaded")}
                  onDesignsCopied={handleDesignsCopied}
                  onRefreshFromBackend={() => refreshDesigns({
                    force: true,
                    marketplaces: ["redbubble"],
                    dedupe: false,
                    reason: "manual-refresh",
                  })}
                  editorMode={editorPlatform === "redbubble"}
                  editorKind={editorKinds.redbubble}
                  selectedDesignIndex={rbEditorIndex}
                  selectedDesignId={rbEditorDesignId}
                  onSelectedDesignIndexChange={(index) => {
                    setRbEditorIndex(index);
                    rememberPlatformNavigation("redbubble", { activeDesignIndex: index });
                  }}
                  onSelectedDesignIdChange={(designId) => {
                    setRbEditorDesignId(designId);
                    rememberPlatformNavigation("redbubble", { activeDesignId: designId });
                  }}
                  onEditorOpen={(kind, index, designId) => handleOpenEditor("redbubble", kind, index, designId)}
                  onBackToDesigns={() => handleBackToDesigns("redbubble")}
                  onEditorUnavailable={() => handleEditorUnavailable("redbubble")}
                  onUnsavedChangesChange={(isDirty) => setPlatformUnsaved("redbubble", isDirty)}
                  unsavedResetToken={unsavedResetTokens.redbubble}
                  designsLoaded={hasLoadedDesigns.current}
                  userId={user?.id || ""}
                  isLoading={isLoadingDesigns}
                  isWorkspaceLocked={redbubbleLocked}
                  onLockedAction={handleLockedPaidFeature}
                />
                {editorPlatform !== "redbubble" && showImagesPanel && <ImageGrid marketplace="redbubble" designs={redbubbleDesigns} uploadedImages={redbubbleImages} onImagesUploaded={() => refreshAfterUpload("redbubble", "images-uploaded")} userId={user?.id || ""} isWorkspaceLocked={redbubbleLocked} onLockedAction={handleLockedPaidFeature} />}
              </>
            )}
          </div>
        )}

        {/* TeePublic — direct to designs, import opens inline */}
        {(
          <div hidden={activeRoute !== "teepublic"} className={`pp-marketplace-view${teepublicLocked ? " is-workspace-locked" : ""}`}>
            {isLoadingPlatformAccess || isLoadingDesigns ? (
              <div className="pp-loading"><strong>Loading TeePublic access...</strong></div>
            ) : activeRoute === "teepublic" && activeTab === "import" ? (
              <TeePublicImport
                onImportComplete={handleImportComplete}
                onBackToDesigns={() => handleTabChange("designs")}
                existingDesigns={teepublicDesigns}
                isWorkspaceLocked={teepublicLocked}
                onLockedAction={handleLockedPaidFeature}
              />
            ) : (
              <>
                {tpEditorIndex >= 0 && (
                  <div hidden={editorPlatform !== "teepublic" || editorKinds.teepublic !== "design"}>
                    <TeePublicEditor
                    designs={teepublicDesigns}
                    activeIndex={tpEditorIndex}
                    activeDesignId={tpEditorDesignId}
                    onActiveIndexChange={(index) => {
                      setTpEditorIndex(index);
                      rememberPlatformNavigation("teepublic", { activeDesignIndex: index });
                    }}
                    onActiveDesignIdChange={(designId) => {
                      setTpEditorDesignId(designId);
                      rememberPlatformNavigation("teepublic", { activeDesignId: designId });
                    }}
                    onDesignsChange={setTeepublicDesignsCached}
                    onImagesUploaded={() => refreshAfterUpload("teepublic", "images-uploaded")}
                    onRefreshFromBackend={() => refreshDesigns({
                      force: true,
                      marketplaces: ["teepublic"],
                      preserveCurrent: true,
                      dedupe: false,
                      reason: "teepublic-editor-mutation",
                    })}
                    onBack={() => handleBackToDesigns("teepublic")}
                    onUnsavedChangesChange={(isDirty) => setPlatformUnsaved("teepublic", isDirty)}
                    unsavedResetToken={unsavedResetTokens.teepublic}
                    uploadedImages={teepublicImages}
                    userId={user?.id || ""}
                    isWorkspaceLocked={teepublicLocked}
                    onLockedAction={handleLockedPaidFeature}
                  />
                  </div>
                )}
                <div hidden={editorPlatform === "teepublic" && editorKinds.teepublic === "design"}>
                  <>
                    <TeePublicDesignManager
                      designs={teepublicDesigns}
                      uploadedImages={teepublicImages}
                      onDesignsChange={setTeepublicDesignsCached}
                      onImportClick={() => teepublicLocked ? handleLockedPaidFeature() : handleTabChange("import")}
                      onUploadImagesClick={() => teepublicLocked ? handleLockedPaidFeature() : setShowImagesPanel((c) => !c)}
                      onImagesUploaded={() => refreshAfterUpload("teepublic", "images-uploaded")}
                      onDesignsCopied={handleDesignsCopied}
                      onRefreshFromBackend={() => refreshDesigns({ force: true, marketplaces: ["teepublic"], reason: "manual-refresh" })}
                      onEditDesign={(index, designId) => handleOpenEditor("teepublic", "design", index, designId)}
                      editorMode={editorPlatform === "teepublic"}
                      editorKind={editorKinds.teepublic}
                      onEditorOpen={(kind) => handleOpenEditor("teepublic", kind)}
                      onBackToDesigns={() => handleBackToDesigns("teepublic")}
                      onUnsavedChangesChange={(isDirty) => setPlatformUnsaved("teepublic", isDirty)}
                      unsavedResetToken={unsavedResetTokens.teepublic}
                      designsLoaded={hasLoadedDesigns.current}
                      userId={user?.id || ""}
                      isLoading={isLoadingDesigns}
                      isWorkspaceLocked={teepublicLocked}
                      onLockedAction={handleLockedPaidFeature}
                    />
                    {editorPlatform !== "teepublic" && showImagesPanel && <ImageGrid marketplace="teepublic" designs={teepublicDesigns} uploadedImages={teepublicImages} onImagesUploaded={() => refreshAfterUpload("teepublic", "images-uploaded")} userId={user?.id || ""} isWorkspaceLocked={teepublicLocked} onLockedAction={handleLockedPaidFeature} />}
                  </>
                </div>
              </>
            )}
          </div>
        )}

        {/* Billing */}
        {activeRoute === "billing" && (
          <BillingSubscriptionsPage
            initialSubscription={subscriptionSummary}
            initialPlatformAccess={platformAccess}
          />
        )}

        {activeRoute === "affiliate" && <AffiliatePage />}

        {activeRoute === "admin" && <AdminAffiliatePage isAdmin={isAdmin} initialSection="overview" />}
        {activeRoute === "admin-affiliates" && <AdminAffiliatePage isAdmin={isAdmin} initialSection="affiliates" />}

        {/* Profile */}
        {activeRoute === "profile" && (
          <ProfilePage onSignOut={handleSignOut} />
        )}
      </main>
      </div>
      <DesignRetentionNotice open={retentionNoticeOpen} onAcknowledge={acknowledgeRetentionNotice} />
      <UnsavedChangesModal
        open={unsavedPrompt.open}
        onStay={stayOnUnsavedEditor}
        onLeave={leaveUnsavedEditor}
      />
    </>
  );
}
