import { useEffect, useRef, useState } from "react";
import { getColorHex } from "../config/teepublicColorHex";

/**
 * Custom color dropdown that renders swatches like MerchGhost.
 *
 * Props:
 *   colors: string[]         — available color names for this product
 *   value: string            — currently selected color name
 *   onChange: (color) => void
 *   label?: string           — product label shown above
 */
export default function ColorDropdown({ colors, value, onChange, label }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const selectedHex = getColorHex(value);
  const isGradient = selectedHex.includes("gradient");

  return (
    <div className="color-dropdown-wrap" ref={ref}>
      {label && <div className="color-dropdown-label">{label}</div>}
      <button
        type="button"
        className="color-dropdown-trigger"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span
          className="color-swatch"
          style={{ background: selectedHex, border: value === "White" || value === "Creme" ? "1px solid #ddd" : "none" }}
        />
        <span className="color-dropdown-value">{value || "Select..."}</span>
        <svg className="color-dropdown-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="color-dropdown-list">
          {colors.map((color) => {
            const hex = getColorHex(color);
            const isSelected = color === value;
            return (
              <button
                key={color}
                type="button"
                className={`color-dropdown-option${isSelected ? " selected" : ""}`}
                onClick={() => { onChange(color); setOpen(false); }}
              >
                <span
                  className="color-swatch"
                  style={{ background: hex, border: color === "White" || color === "Creme" ? "1px solid #ddd" : "none" }}
                />
                <span className="color-option-name">{color}</span>
                {isSelected && (
                  <svg className="color-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
