import { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard } from "lucide-react";
import { useAuth } from "./auth/AuthContext";
import Dashboard from "./components/Dashboard";
import DesignManager from "./components/DesignManager";
import TeePublicDesignManager from "./components/TeePublicDesignManager";
import TeePublicEditor from "./components/TeePublicEditor";
import BillingSubscriptionsPage from "./components/BillingSubscriptionsPage";
import Icon from "./components/Icon";
import ImageGrid from "./components/ImageGrid";
import ImportDesigns from "./components/ImportDesigns";
import TeePublicImport from "./components/TeePublicImport";
import LoginPage from "./components/LoginPage";
import LandingPage from "./components/LandingPage";
import PricingPage from "./components/PricingPage";
import CheckoutPage from "./components/CheckoutPage";
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
import { EXTENSION_ID } from "./config";
import { AUTH_MESSAGES, supabase } from "./lib/supabaseClient";
import {
  getMyPlatformAccess,
  getMySubscription,
  getTrialEligibility,
  switchDevice,
  listDesigns,
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
      previewUrl: d.image_url || "",
      previewDataUrl: "",
      matched: true,
      storedName: d.filename,
      imagePath: d.image_r2_key || "",
      imageUrl: d.image_url || "",
      thumbnail_r2_key: d.thumbnail_r2_key || "",
      thumbnailUrl: d.thumbnail_url || d.image_url || "",
    }));
}

function normalizeDesignForExtension(design) {
  return {
    id: design.id,
    filename: design.filename,
    image_url: design.image_url || "",
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
  };
}

function isPlatformRoute(route) {
  return route === "redbubble" || route === "teepublic";
}

function canAccessRoute(route, platformAccess) {
  if (!isPlatformRoute(route)) return true;
  return Boolean(platformAccess?.[route]);
}

function Sidebar({ activeRoute, onNavigate, user, onSignOut, theme, setTheme, platformAccess, trialEligibility }) {
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

const VALID_ROUTES = ["dashboard", "redbubble", "teepublic", "billing", "profile"];
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
const CHECKOUT_DEBUG =
  import.meta.env.DEV ||
  import.meta.env.VITE_ENABLE_CHECKOUT_DEBUG === "true";

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
  
  return false;
}

export default function App() {
  const { loading, isAuthenticated, user, session, signOut } = useAuth();
  const authLoading = loading;
  const userId = user?.id || "";
  const initialRoute = readRouteFromLocation();
  const [activeRoute, setActiveRoute] = useState(initialRoute.route);
  const [activeTab, setActiveTab] = useState(initialRoute.tab);
  const [editorPlatform, setEditorPlatform] = useState(initialRoute.editor ? initialRoute.route : "");
  const [editorKinds, setEditorKinds] = useState(() => ({
    redbubble: initialRoute.editor && initialRoute.route === "redbubble" ? "design" : "",
    teepublic: initialRoute.editor && initialRoute.route === "teepublic" ? "design" : "",
  }));

  // Prevent crawlers from indexing private app and checkout routes.
  useEffect(() => {
    const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
    const publicExactPaths = [
      "/",
      "/pricing",
      "/blog",
      "/ai-listing-generator",
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
    ];
    const publicPathPrefixes = ["/blog"];
    const privateRoutes = ["dashboard", "redbubble", "teepublic", "billing", "subscription", "profile"];
    const privatePathPrefixes = ["/dashboard", "/redbubble", "/teepublic", "/billing", "/subscription", "/profile"];
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
  const [tpEditorIndex, setTpEditorIndex] = useState(() => initialRoute.editor && initialRoute.route === "teepublic" ? readEditorIndex("teepublic") : -1);
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
  const uploadStatusFailedSyncRef = useRef(new Set());
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
    if (isAuthenticated) return;
    setUploadControlPrompt({ visible: false, message: "", isSwitching: false });
    subscriptionRequestRef.current += 1;
    previousUserIdRef.current = "";
    hasStartedInitialDesignLoad.current = false;
    hasLoadedDesigns.current = false;
    designRefreshRequestsRef.current.clear();
    uploadStatusRowSignaturesRef.current.clear();
    uploadStatusEventSignaturesRef.current.clear();
    uploadStatusFailedSyncRef.current.clear();
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
      uploadStatusFailedSyncRef.current.clear();
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

  const fetchFreshDesigns = useCallback((marketplace, { preserveCurrent = false } = {}) => {
    if (!isAuthenticated || !userId) return Promise.resolve(null);
    const requestKey = `${userId}:${marketplace}:${preserveCurrent ? "preserve" : "replace"}`;
    const existing = designRefreshRequestsRef.current.get(requestKey);
    if (existing) return existing;

    cacheDebugLog(`background refresh started marketplace=${marketplace}`);
    const request = listDesigns(marketplace)
      .then(async (data) => {
        const freshDesigns = Array.isArray(data?.designs) ? data.designs : [];
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
        designRefreshRequestsRef.current.delete(requestKey);
      });

    designRefreshRequestsRef.current.set(requestKey, request);
    return request;
  }, [isAuthenticated, setMarketplaceDesigns, userId]);

  const refreshDesigns = useCallback(async ({
    force = false,
    invalidate = true,
    marketplaces = DESIGN_MARKETPLACES,
    preserveCurrent = false,
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

    const results = await Promise.allSettled(needsBackend.map((marketplace) => fetchFreshDesigns(marketplace, { preserveCurrent })));
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
          const nextError = cleanStatus === "failed" ? (errorMessage || design.error_message || "") : "";
          if (design.status === cleanStatus && (design.error_message || "") === nextError) return design;
          changed = true;
          return { ...design, status: cleanStatus, error_message: nextError };
        });
        return changed ? next : current;
      });
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
        });

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
            console.error("[PodPilot Upload Status] backend update failed");
            setDashboardToast({
              type: "error",
              message: event.backend_error || "Upload status changed, but it could not be saved. Please try Refresh.",
            });
          }
        });

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
      setActiveRoute(next.route);
      setActiveTab(next.tab);
      setEditorPlatform(next.editor ? next.route : "");
      if (next.editor) {
        const historyKind = event.state?.editorKind;
        const historyIndex = Number(event.state?.selectedDesignIndex);
        if (Number.isInteger(historyIndex) && historyIndex >= 0) {
          if (next.route === "teepublic") setTpEditorIndex(historyIndex);
          else setRbEditorIndex(historyIndex);
        }
        setEditorKinds((current) => ({
          ...current,
          [next.route]: historyKind === "create" || historyKind === "design"
            ? historyKind
            : current[next.route] || "design",
        }));
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (editorPlatform !== "teepublic" || editorKinds.teepublic !== "design") return;
    if (isLoadingDesigns || !hasLoadedDesigns.current) return;
    if (teepublicDesigns.length === 0) {
      handleEditorUnavailable("teepublic");
      return;
    }
    const safeIndex = Math.max(0, Math.min(tpEditorIndex, teepublicDesigns.length - 1));
    if (safeIndex !== tpEditorIndex) setTpEditorIndex(safeIndex);
  }, [editorKinds.teepublic, editorPlatform, isLoadingDesigns, teepublicDesigns.length, tpEditorIndex]);

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

  function handleNavigate(route) {
    setActiveRoute(route);
    setActiveTab("designs");
    setEditorPlatform("");
    const target = buildPath(route, "designs");
    if (window.location.pathname !== target) {
      window.history.pushState(null, "", target);
    }
  }

  function handleTabChange(nextTab) {
    setActiveTab(nextTab);
    setEditorPlatform("");
    const target = buildPath(activeRoute, nextTab);
    if (window.location.pathname !== target) {
      window.history.pushState(null, "", target);
    }
  }

  function handleOpenEditor(platform, kind = "design", index = null) {
    if (!isPlatformRoute(platform)) return;
    if (Number.isInteger(index) && index >= 0) {
      writeEditorIndex(platform, index);
      if (platform === "teepublic") setTpEditorIndex(index);
      else setRbEditorIndex(index);
    }
    setEditorKinds((current) => ({ ...current, [platform]: kind }));
    setActiveRoute(platform);
    setActiveTab("designs");
    setEditorPlatform(platform);
    const target = buildPath(platform, "designs", platform);
    if (window.location.pathname !== target) {
      window.history.pushState({ editorPlatform: platform, editorKind: kind, selectedDesignIndex: Number.isInteger(index) ? index : 0 }, "", target);
    } else {
      window.history.replaceState({ editorPlatform: platform, editorKind: kind, selectedDesignIndex: Number.isInteger(index) ? index : 0 }, "", target);
    }
  }

  function handleBackToDesigns(platform) {
    setActiveRoute(platform);
    setActiveTab("designs");
    setEditorPlatform("");
    const target = buildPath(platform, "designs");
    if (window.location.pathname !== target) window.history.pushState({ editorPlatform: "", editorKind: "" }, "", target);
  }

  function handleEditorUnavailable(platform) {
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

        {(activeRoute === "dashboard" || isPlatformRoute(activeRoute)) && workspaceLocked && (
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
                onLockedAction={openPricing}
              />
            ) : (
              <>
                <DesignManager
                  designs={redbubbleDesigns}
                  uploadedImages={redbubbleImages}
                  onDesignsChange={setRedbubbleDesignsCached}
                  onImportClick={() => redbubbleLocked ? openPricing() : handleTabChange("import")}
                  onUploadImagesClick={() => redbubbleLocked ? openPricing() : setShowImagesPanel((c) => !c)}
                  onImagesUploaded={() => refreshDesigns({ force: true, marketplaces: ["redbubble"], reason: "images-uploaded" })}
                  onRefreshFromBackend={() => refreshDesigns({ force: true, marketplaces: ["redbubble"], reason: "manual-refresh" })}
                  editorMode={editorPlatform === "redbubble"}
                  editorKind={editorKinds.redbubble}
                  selectedDesignIndex={rbEditorIndex}
                  onSelectedDesignIndexChange={(index) => { setRbEditorIndex(index); writeEditorIndex("redbubble", index); }}
                  onEditorOpen={(kind, index) => handleOpenEditor("redbubble", kind, index)}
                  onBackToDesigns={() => handleBackToDesigns("redbubble")}
                  onEditorUnavailable={() => handleEditorUnavailable("redbubble")}
                  designsLoaded={hasLoadedDesigns.current}
                  userId={user?.id || ""}
                  isLoading={isLoadingDesigns}
                  isWorkspaceLocked={redbubbleLocked}
                  onLockedAction={openPricing}
                />
                {editorPlatform !== "redbubble" && showImagesPanel && <ImageGrid designs={redbubbleDesigns} uploadedImages={redbubbleImages} onImagesUploaded={() => refreshDesigns({ force: true, marketplaces: ["redbubble"], reason: "images-uploaded" })} userId={user?.id || ""} isWorkspaceLocked={redbubbleLocked} onLockedAction={openPricing} />}
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
                onLockedAction={openPricing}
              />
            ) : (
              <>
                {tpEditorIndex >= 0 && (
                  <div hidden={editorPlatform !== "teepublic" || editorKinds.teepublic !== "design"}>
                    <TeePublicEditor
                    designs={teepublicDesigns}
                    activeIndex={tpEditorIndex}
                    onActiveIndexChange={(index) => { setTpEditorIndex(index); writeEditorIndex("teepublic", index); }}
                    onDesignsChange={setTeepublicDesignsCached}
                    onBack={() => handleBackToDesigns("teepublic")}
                    uploadedImages={teepublicImages}
                    userId={user?.id || ""}
                    isWorkspaceLocked={teepublicLocked}
                    onLockedAction={openPricing}
                  />
                  </div>
                )}
                <div hidden={editorPlatform === "teepublic" && editorKinds.teepublic === "design"}>
                  <>
                    <TeePublicDesignManager
                      designs={teepublicDesigns}
                      uploadedImages={teepublicImages}
                      onDesignsChange={setTeepublicDesignsCached}
                      onImportClick={() => teepublicLocked ? openPricing() : handleTabChange("import")}
                      onUploadImagesClick={() => teepublicLocked ? openPricing() : setShowImagesPanel((c) => !c)}
                      onImagesUploaded={() => refreshDesigns({ force: true, marketplaces: ["teepublic"], reason: "images-uploaded" })}
                      onRefreshFromBackend={() => refreshDesigns({ force: true, marketplaces: ["teepublic"], reason: "manual-refresh" })}
                      onEditDesign={(index) => handleOpenEditor("teepublic", "design", index)}
                      editorMode={editorPlatform === "teepublic"}
                      editorKind={editorKinds.teepublic}
                      onEditorOpen={(kind) => handleOpenEditor("teepublic", kind)}
                      onBackToDesigns={() => handleBackToDesigns("teepublic")}
                      designsLoaded={hasLoadedDesigns.current}
                      userId={user?.id || ""}
                      isLoading={isLoadingDesigns}
                      isWorkspaceLocked={teepublicLocked}
                      onLockedAction={openPricing}
                    />
                    {editorPlatform !== "teepublic" && showImagesPanel && <ImageGrid designs={teepublicDesigns} uploadedImages={teepublicImages} onImagesUploaded={() => refreshDesigns({ force: true, marketplaces: ["teepublic"], reason: "images-uploaded" })} userId={user?.id || ""} isWorkspaceLocked={teepublicLocked} onLockedAction={openPricing} />}
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

        {/* Profile */}
        {activeRoute === "profile" && (
          <ProfilePage onSignOut={handleSignOut} />
        )}
      </main>
      </div>
    </>
  );
}
