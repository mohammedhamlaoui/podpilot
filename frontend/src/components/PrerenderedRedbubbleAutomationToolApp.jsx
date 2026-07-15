import { useEffect } from "react";
import { AuthProvider } from "../auth/AuthContext";
import AffiliateReferralTracker from "./AffiliateReferralTracker";
import AppErrorBoundary from "./AppErrorBoundary";
import RedbubbleAutomationToolPage from "./RedbubbleAutomationToolPage";
import WhatsAppFloatingButton from "./WhatsAppFloatingButton";

export default function PrerenderedRedbubbleAutomationToolApp() {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.classList.remove("theme-light", "theme-dark");
    document.documentElement.classList.add("theme-light");
    document.body.classList.remove("theme-light", "theme-dark");
    document.body.classList.add("theme-light");
  }, []);

  return (
    <AppErrorBoundary>
      <AuthProvider>
        <AffiliateReferralTracker />
        <RedbubbleAutomationToolPage />
        <WhatsAppFloatingButton />
      </AuthProvider>
    </AppErrorBoundary>
  );
}
