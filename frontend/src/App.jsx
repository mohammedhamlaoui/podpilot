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
import StorageNoticeModal from "./components/StorageNoticeModal";
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
import { openPaddleCheckout, isPaddleConfigured } from "./lib/paddle";
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
  if (!path) return { route: "dashboard", tab: "designs" };
  if (path === "reset-password") return { route: "dashboard", tab: "designs" };
  if (path === "subscription") return { route: "billing", tab: "designs" };
  const [first, second] = path.split("/");
  if (first === "dashboard") {
    const nestedRoute = VALID_ROUTES.includes(second) ? second : "dashboard";
    const nestedTab = VALID_TABS.includes(path.split("/")[2]) ? path.split("/")[2] : "designs";
    return { route: nestedRoute, tab: nestedTab };
  }
  const route = VALID_ROUTES.includes(first) ? first : "dashboard";
  const tab = VALID_TABS.includes(second) ? second : "designs";
  return { route, tab };
}

function buildPath(route, tab) {
  const safeRoute = VALID_ROUTES.includes(route) ? route : "dashboard";
  const safeTab = VALID_TABS.includes(tab) ? tab : "designs";
  if (safeRoute === "dashboard") return "/dashboard";
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
      return segments[1] === "import" || segments[1] === "designs";
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
  const [tpEditorIndex, setTpEditorIndex] = useState(-1);
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
          setMarketplaceDesigns(marketplace, freshDesigns);
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

  // Poll every 30s while extension is available; refreshes stay quiet after the initial load.
  useEffect(() => {
    if (!isAuthenticated || !EXTENSION_ID.trim() || !window.chrome?.runtime?.sendMessage) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const ext = await new Promise((resolve) => {
          window.chrome.runtime.sendMessage(EXTENSION_ID, { action: "get_status" }, (response) => {
            if (window.chrome.runtime.lastError) { resolve({ ok: false }); return; }
            resolve(response || { ok: false });
          });
        });
        const status = ext?.state?.status;
        if ((status === "running" || status === "paused") && !cancelled) {
          await refreshDesigns({ force: true, reason: "extension-poll" });
        } else if (status === "idle" && !cancelled) {
          await refreshDesigns({ reason: "extension-idle" });
        }
      } catch (_) {}
    };
    const intervalId = window.setInterval(tick, 30000);
    return () => { cancelled = true; window.clearInterval(intervalId); };
  }, [isAuthenticated, refreshDesigns]);

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
      window.location.pathname === "/privacy-policy" ||
      window.location.pathname === "/privacy" ||
      window.location.pathname === "/terms-of-service" ||
      window.location.pathname === "/terms" ||
      window.location.pathname === "/refund-policy" ||
      window.location.pathname === "/help-center" ||
      window.location.pathname === "/help" ||
      window.location.pathname === "/security" ||
      window.location.pathname === "/email-confirmed" ||
      window.location.pathname === "/thank-you" ||
      window.location.pathname === "/extension-installed"
    ) {
      return;
    }
    const target = buildPath(activeRoute, activeTab);
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
  }, [activeRoute, activeTab, isPasswordRecovery]);

  // Respond to browser back/forward navigation
  useEffect(() => {
    function onPopState() {
      const next = readRouteFromLocation();
      setActiveRoute(next.route);
      setActiveTab(next.tab);
      setTpEditorIndex(-1);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

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
  // Runs once when auth flips to authenticated; clears the pending state
  // immediately so it never replays.
  // Resume Paddle checkout right after login/signup if a plan was pending.
  // Runs once when auth flips to authenticated; clears the pending state
  // only after Paddle's overlay actually opens so a transient init failure
  // doesn't lose the user's intent.
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
    if (!isPaddleConfigured()) {
      clearPendingCheckoutPlan();
      return;
    }
    const userId = user?.id || "";
    const email = user?.email || "";
    if (CHECKOUT_DEBUG) {
      // eslint-disable-next-line no-console
      console.log(`[AuthFlow] pendingCheckoutPlan=${plan} billing=${billingCycle}`);
    }
    setDashboardToast({
      type: "success",
      message: "Account ready. Opening secure Paddle checkout...",
    });
    Promise.resolve().then(() => {
      if (CHECKOUT_DEBUG) {
        // eslint-disable-next-line no-console
        console.log(`[Paddle] opening checkout plan=${plan} user_id=${userId}`);
      }
      return openPaddleCheckout({
      plan,
      billingCycle,
      email: email || undefined,
      userId: userId || undefined,
      onCheckoutComplete: () => {
        setDashboardToast({
          type: "success",
          message: "Subscription started. Verifying your plan...",
        });
        void refreshSubscriptionAfterCheckout();
      },
      onCheckoutClosed: () => {
        // No-op — user can click Manage from the dashboard if they want
        // to retry.
      },
      });
    }).then(() => {
      // Only clear once Paddle's overlay has actually opened.
      clearPendingCheckoutPlan();
    }).catch((error) => {
      // eslint-disable-next-line no-console
      console.error("[Paddle] checkout error", error);
      setDashboardToast({
        type: "error",
        message: error?.message || "Could not open checkout. Please try again from Pricing.",
      });
    });
  }, [isAuthenticated, refreshSubscriptionAfterCheckout, user?.id, user?.email]);

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
    setTpEditorIndex(-1);
    const target = buildPath(route, "designs");
    if (window.location.pathname !== target) {
      window.history.pushState(null, "", target);
    }
  }

  function handleTabChange(nextTab) {
    setActiveTab(nextTab);
    const target = buildPath(activeRoute, nextTab);
    if (window.location.pathname !== target) {
      window.history.pushState(null, "", target);
    }
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
  const marketplace = activeRoute === "teepublic" ? "teepublic" : "redbubble";
  const activeDesigns = marketplace === "teepublic" ? teepublicDesigns : redbubbleDesigns;
  const activeImages = deriveImagesFromDesigns(activeDesigns);
  const subscriptionFlags = getSubscriptionFlags(subscriptionSummary, subscriptionLoaded);
  const workspaceLocked = subscriptionFlags.isWorkspaceLocked;
  const activePlatformLocked = (
    subscriptionLoaded &&
    !subscriptionLoading &&
    !isLoadingPlatformAccess &&
    isPlatformRoute(activeRoute) &&
    !platformAccess?.[activeRoute]
  );
  debugSubscriptionLog(`route decision route=${activeRoute} workspaceLocked=${workspaceLocked} platformLocked=${activePlatformLocked}`);

  return (
    <>
      <StorageNoticeModal />
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
        {activeRoute === "redbubble" && (
          <div className={`pp-marketplace-view${activePlatformLocked ? " is-workspace-locked" : ""}`}>
            {isLoadingPlatformAccess || isLoadingDesigns ? (
              <div className="pp-loading"><strong>Loading Redbubble access...</strong></div>
            ) : activeTab === "import" ? (
              <ImportDesigns
                onImportComplete={handleImportComplete}
                onBackToDesigns={() => handleTabChange("designs")}
                existingDesigns={redbubbleDesigns}
                isWorkspaceLocked={activePlatformLocked}
                onLockedAction={openPricing}
              />
            ) : (
              <>
                <DesignManager
                  designs={redbubbleDesigns}
                  uploadedImages={activeImages}
                  onDesignsChange={setRedbubbleDesignsCached}
                  onImportClick={() => activePlatformLocked ? openPricing() : handleTabChange("import")}
                  onUploadImagesClick={() => activePlatformLocked ? openPricing() : setShowImagesPanel((c) => !c)}
                  onImagesUploaded={() => refreshDesigns({ force: true, marketplaces: ["redbubble"], reason: "images-uploaded" })}
                  onRefreshFromBackend={() => refreshDesigns({ force: true, marketplaces: ["redbubble"], reason: "manual-refresh" })}
                  userId={user?.id || ""}
                  isLoading={isLoadingDesigns}
                  isWorkspaceLocked={activePlatformLocked}
                  onLockedAction={openPricing}
                />
                {showImagesPanel && <ImageGrid designs={redbubbleDesigns} uploadedImages={activeImages} onImagesUploaded={() => refreshDesigns({ force: true, marketplaces: ["redbubble"], reason: "images-uploaded" })} userId={user?.id || ""} isWorkspaceLocked={activePlatformLocked} onLockedAction={openPricing} />}
              </>
            )}
          </div>
        )}

        {/* TeePublic — direct to designs, import opens inline */}
        {activeRoute === "teepublic" && (
          <div className={`pp-marketplace-view${activePlatformLocked ? " is-workspace-locked" : ""}`}>
            {isLoadingPlatformAccess || isLoadingDesigns ? (
              <div className="pp-loading"><strong>Loading TeePublic access...</strong></div>
            ) : activeTab === "import" ? (
              <TeePublicImport
                onImportComplete={handleImportComplete}
                onBackToDesigns={() => handleTabChange("designs")}
                existingDesigns={teepublicDesigns}
                isWorkspaceLocked={activePlatformLocked}
                onLockedAction={openPricing}
              />
            ) : (
              <>
                {tpEditorIndex >= 0 ? (
                  <TeePublicEditor
                    designs={teepublicDesigns}
                    activeIndex={tpEditorIndex}
                    onActiveIndexChange={setTpEditorIndex}
                    onDesignsChange={setTeepublicDesignsCached}
                    onBack={() => setTpEditorIndex(-1)}
                    uploadedImages={activeImages}
                    userId={user?.id || ""}
                    isWorkspaceLocked={activePlatformLocked}
                    onLockedAction={openPricing}
                  />
                ) : (
                  <>
                    <TeePublicDesignManager
                      designs={teepublicDesigns}
                      uploadedImages={activeImages}
                      onDesignsChange={setTeepublicDesignsCached}
                      onImportClick={() => activePlatformLocked ? openPricing() : handleTabChange("import")}
                      onUploadImagesClick={() => activePlatformLocked ? openPricing() : setShowImagesPanel((c) => !c)}
                      onImagesUploaded={() => refreshDesigns({ force: true, marketplaces: ["teepublic"], reason: "images-uploaded" })}
                      onRefreshFromBackend={() => refreshDesigns({ force: true, marketplaces: ["teepublic"], reason: "manual-refresh" })}
                      onEditDesign={(index) => setTpEditorIndex(index)}
                      userId={user?.id || ""}
                      isLoading={isLoadingDesigns}
                      isWorkspaceLocked={activePlatformLocked}
                      onLockedAction={openPricing}
                    />
                    {showImagesPanel && <ImageGrid designs={teepublicDesigns} uploadedImages={activeImages} onImagesUploaded={() => refreshDesigns({ force: true, marketplaces: ["teepublic"], reason: "images-uploaded" })} userId={user?.id || ""} isWorkspaceLocked={activePlatformLocked} onLockedAction={openPricing} />}
                  </>
                )}
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
