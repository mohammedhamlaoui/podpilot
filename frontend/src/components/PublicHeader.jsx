import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { LogoMark, LandingButton, UserMenu } from "./LandingPage";
import ThemeToggle from "./ThemeToggle";

const authHref = "/dashboard";

export default function PublicHeader({ theme, setTheme }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const auth = useAuth();
  const isAuthenticated = Boolean(auth?.user);
  const customerEmail = auth?.user?.email || "";
  const signOut = auth?.signOut;

  const publicNavItems = [
    { label: "Home", href: "/" },
    { label: "Pricing", href: "/pricing" },
    { label: "Blog", href: "/blog" },
    { label: "Help Center", href: "/help" },
    { label: "Contact", href: "/contact" },
  ];

  function closeMobileMenu() {
    setMobileOpen(false);
  }

  return (
    <header className="landing-nav" style={{ position: "sticky", top: 0, zIndex: 100, backdropFilter: "blur(12px)" }}>
      <div className="landing-container landing-nav-inner">
        <LogoMark />

        <nav className={`landing-nav-links${mobileOpen ? " is-open" : ""}`} aria-label="Public navigation">
          {publicNavItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={window.location.pathname === item.href ? "is-active" : undefined}
              onClick={closeMobileMenu}
            >
              {item.label}
            </a>
          ))}
          {setTheme && (
            <ThemeToggle theme={theme} setTheme={setTheme} className="landing-theme-toggle" />
          )}
          {isAuthenticated ? (
            <UserMenu email={customerEmail} onSignOut={signOut} />
          ) : (
            <>
              <a href={authHref} onClick={closeMobileMenu}>Login</a>
              <LandingButton>Start Free Trial</LandingButton>
            </>
          )}
        </nav>

        <button
          type="button"
          className="landing-menu-btn"
          aria-label="Toggle navigation"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((current) => !current)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
    </header>
  );
}
