import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App.jsx";
import { AuthProvider } from "./auth/AuthContext.jsx";
import WhatsAppFloatingButton from "./components/WhatsAppFloatingButton.jsx";
import AppErrorBoundary from "./components/AppErrorBoundary.jsx";
import AffiliateReferralTracker from "./components/AffiliateReferralTracker.jsx";
import PrerenderedPublicPageApp, { PRERENDERED_PUBLIC_ROUTES } from "./components/PrerenderedPublicPageApp.jsx";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./styles.css";
import "./affiliate-program.css";

const root = document.getElementById("root");
const prerenderedRoute = root?.dataset?.prerenderedRoute || "";
const shouldHydratePrerenderedPublicPage =
  PRERENDERED_PUBLIC_ROUTES.includes(prerenderedRoute) && root.hasChildNodes();

const defaultApp = (
  <React.StrictMode>
    <AppErrorBoundary>
      <AuthProvider>
        <AffiliateReferralTracker />
        <App />
        <WhatsAppFloatingButton />
      </AuthProvider>
    </AppErrorBoundary>
  </React.StrictMode>
);

if (shouldHydratePrerenderedPublicPage) {
  hydrateRoot(
    root,
    <React.StrictMode>
      <PrerenderedPublicPageApp route={prerenderedRoute} />
    </React.StrictMode>,
  );
} else {
  createRoot(root).render(defaultApp);
}
