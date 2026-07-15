import { useEffect, useState } from "react";
import { AuthProvider } from "../auth/AuthContext";
import AffiliateReferralTracker from "./AffiliateReferralTracker";
import AffiliateProgramPage from "./AffiliateProgramPage";
import AppErrorBoundary from "./AppErrorBoundary";
import RedbubbleAutomationToolPage from "./RedbubbleAutomationToolPage";
import TeePublicAutomationToolPage from "./TeePublicAutomationToolPage";
import WhatsAppFloatingButton from "./WhatsAppFloatingButton";

const publicPages = {
  "/affiliate-program": AffiliateProgramPage,
  "/redbubble-automation-tool": RedbubbleAutomationToolPage,
  "/teepublic-automation-tool": TeePublicAutomationToolPage,
};

export const PRERENDERED_PUBLIC_ROUTES = Object.keys(publicPages);

export default function PrerenderedPublicPageApp({ route }) {
  const [theme, setTheme] = useState("light");
  const PublicPage = publicPages[route] || RedbubbleAutomationToolPage;
  const supportsThemeSelection = route === "/affiliate-program";

  useEffect(() => {
    if (!supportsThemeSelection) return;
    const savedTheme = localStorage.getItem("rb-theme");
    if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
  }, [supportsThemeSelection]);

  useEffect(() => {
    const activeTheme = supportsThemeSelection ? theme : "light";
    if (supportsThemeSelection) localStorage.setItem("rb-theme", activeTheme);
    document.documentElement.setAttribute("data-theme", activeTheme);
    document.documentElement.classList.remove("theme-light", "theme-dark");
    document.documentElement.classList.add(`theme-${activeTheme}`);
    document.body.classList.remove("theme-light", "theme-dark");
    document.body.classList.add(`theme-${activeTheme}`);
  }, [supportsThemeSelection, theme]);

  return (
    <AppErrorBoundary>
      <AuthProvider>
        <AffiliateReferralTracker />
        <PublicPage theme={theme} setTheme={setTheme} />
        <WhatsAppFloatingButton />
      </AuthProvider>
    </AppErrorBoundary>
  );
}
