import { Moon, Sun } from "lucide-react";

export default function ThemeToggle({ theme, setTheme, className = "" }) {
  const toggleTheme = (e) => {
    e.stopPropagation();
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  const isLight = theme === "light";
  const ThemeIcon = isLight ? Moon : Sun;

  return (
    <button
      type="button"
      className={`theme-toggle-btn ${className}`.trim()}
      onClick={toggleTheme}
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
      title={isLight ? "Switch to dark mode" : "Switch to light mode"}
    >
      <ThemeIcon className="ui-icon theme-toggle-icon" strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
