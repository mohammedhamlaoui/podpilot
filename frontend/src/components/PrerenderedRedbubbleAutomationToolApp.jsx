import { useEffect, useState } from "react";
import { AuthProvider } from "../auth/AuthContext";
import AffiliateReferralTracker from "./AffiliateReferralTracker";
import AppErrorBoundary from "./AppErrorBoundary";
import RedbubbleAutomationToolPage from "./RedbubbleAutomationToolPage";
import WhatsAppFloatingButton from "./WhatsAppFloatingButton";

export default function PrerenderedRedbubbleAutomationToolApp() {
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    const savedTheme = localStorage.getItem("rb-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("rb-theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.classList.remove("theme-light", "theme-dark");
    document.documentElement.classList.add(`theme-${theme}`);
    document.body.classList.remove("theme-light", "theme-dark");
    document.body.classList.add(`theme-${theme}`);
  }, [theme]);

  return (
    <AppErrorBoundary>
      <AuthProvider>
        <AffiliateReferralTracker />
        <RedbubbleAutomationToolPage theme={theme} setTheme={setTheme} />
        <WhatsAppFloatingButton />
      </AuthProvider>
    </AppErrorBoundary>
  );
}
