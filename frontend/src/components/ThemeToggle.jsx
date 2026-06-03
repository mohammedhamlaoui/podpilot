import Icon from "./Icon";

export default function ThemeToggle({ theme, setTheme, className = "" }) {
  const toggleTheme = (e) => {
    e.stopPropagation();
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  const isLight = theme === "light";

  return (
    <button
      type="button"
      className={`theme-toggle-btn ${className}`.trim()}
      onClick={toggleTheme}
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
      title={isLight ? "Switch to dark mode" : "Switch to light mode"}
    >
      <Icon name={isLight ? "moon" : "sun"} className="theme-toggle-icon" />
    </button>
  );
}
