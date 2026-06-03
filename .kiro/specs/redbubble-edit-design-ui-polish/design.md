# Design Document

## Overview

This design polishes the Edit Redbubble Design view and the Create Redbubble Design view inside `frontend/src/components/DesignManager.jsx` to deliver a clean SaaS-style form aesthetic, consistent two-column-on-desktop / single-column-on-mobile layout, validated Copy Link input, and submit gating with on-blur inline helper text. All work happens in the existing React 18 + Vite + plain CSS stack — no new dependencies, no Tailwind, no UI library, no backend changes, no Supabase, no trademark checker, no save/update logic changes.

The design centers on three small, pure helper functions plus a thin layer of local component state:

1. `resolveStickerPreviewStyle(toggleEnabled, color)` — produces the inline style for the sticker preview, leaving the `--sticker-preview-color` variable unset (so the existing CSS background falls through to white) when the toggle is off.
2. `validateCopyLink(value)` — classifies a Copy Link input into `valid-clean`, `valid-with-tip`, `invalid-empty`, `invalid-scheme`, or `invalid-host`.
3. `validateRequired(value)` — trims and checks for non-empty content.

The form components use a `blurredFields` Set, derive an `errors` object from `(form, blurredFields)`, and gate the Submit button on a derived `isFormValid` boolean. The same helpers are reused on Edit_Page and Create_Page so behavior is identical.

## Architecture

### Module Layout

```
frontend/src/
├── components/
│   ├── DesignManager.jsx          ← edited: Edit view (~776–945) and Create view (~540–760)
│   └── designValidation.js        ← new: pure validators + style resolver
└── styles.css                     ← edited: ~2681 (edit-page), ~2875 (sticker-color-card), ~2959 (create-page)
                                       new rule: .field-error
```

`designValidation.js` is a new sibling module containing only pure functions. It has no React imports, no DOM access, no side effects — making it directly testable.

### Data Flow (Edit_Page and Create_Page share the same shape)

```
form state (existing) ──┐
                        ├──► errors = getDisplayedErrors(form, blurredFields)
blurredFields (new) ────┘                │
                                         ├──► <span className="field-error"> (rendered only if errors[f] && blurredFields has f)
                                         │
form state (existing) ──► isFormValid = computeIsFormValid(form)
                                         │
                                         └──► Submit button `disabled={!isFormValid}`
```

`isFormValid` is computed from the raw form state (not from `blurredFields`) because the Submit button must reflect the true form validity regardless of which fields the user has touched. `errors` (the displayed message map) is gated by `blurredFields` so users do not see red text on fields they have not yet visited.

### Sticker Preview Background Resolution

The current implementation always sets `--sticker-preview-color` on the preview element, falling back to `"#7d7d7d"` when the toggle is off. That fallback gray is what produces the dark overlay. The fix:

- When `formStickerEnabled === true`, set `style={{ "--sticker-preview-color": formStickerColor }}`.
- When `formStickerEnabled === false`, pass `style={undefined}` (or `style={{}}`) so the CSS variable is never set on the inline style. The `.edit-sticker-preview` rule in `styles.css` already provides a white background as the default; without the variable override, the image renders cleanly on white.

This is encapsulated in `resolveStickerPreviewStyle` so both views call the same function and a property test can verify the conditional.

## Components and Interfaces

### `frontend/src/components/designValidation.js` (new)

```js
// Required-field validator
// Returns true if value is non-empty after trim, false otherwise.
export function validateRequired(value) {
  if (typeof value !== "string") return false;
  return value.trim().length > 0;
}

// Duplicate URL canonical shape, anchored, optional trailing slash.
export const DUPLICATE_URL_REGEX =
  /^\/portfolio\/images\/\d+-[\w-]+\/duplicate\/?$/;

// Copy Link validator
// Returns one of:
//   { status: "invalid-empty",  message: "Copy link is required" }
//   { status: "invalid-scheme", message: "Copy link must start with https://" }
//   { status: "invalid-host",   message: "Copy link must be a redbubble.com URL" }
//   { status: "valid-with-tip", tip: "Tip: paste the duplicate URL ending in /duplicate for best results" }
//   { status: "valid-clean" }
//
// Submit gating: any status starting with "valid-" passes (isValid === true).
export function validateCopyLink(value) {
  if (!validateRequired(value)) {
    return { status: "invalid-empty", message: "Copy link is required" };
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch (_err) {
    return { status: "invalid-scheme", message: "Copy link must start with https://" };
  }

  if (url.protocol !== "https:") {
    return { status: "invalid-scheme", message: "Copy link must start with https://" };
  }

  const host = url.hostname.toLowerCase();
  const isRedbubbleHost = host === "redbubble.com" || host.endsWith(".redbubble.com");
  if (!isRedbubbleHost) {
    return { status: "invalid-host", message: "Copy link must be a redbubble.com URL" };
  }

  if (DUPLICATE_URL_REGEX.test(url.pathname)) {
    return { status: "valid-clean" };
  }

  return {
    status: "valid-with-tip",
    tip: "Tip: paste the duplicate URL ending in /duplicate for best results",
  };
}

// Convenience: boolean valid for submit gating.
export function isCopyLinkValid(value) {
  const result = validateCopyLink(value);
  return result.status === "valid-clean" || result.status === "valid-with-tip";
}

// Sticker preview inline-style resolver.
// When toggle is off, returns undefined so the CSS variable is NOT set
// and the default white background applies.
export function resolveStickerPreviewStyle(toggleEnabled, color) {
  if (!toggleEnabled) return undefined;
  return { "--sticker-preview-color": color };
}
```

### `frontend/src/components/DesignManager.jsx` (edited)

Two view sections are touched. Each gains:

- A `blurredFields` `useState` initialized to `new Set()`.
- A derived `errors` object recomputed each render from `(form, blurredFields)`.
- A derived `isFormValid` boolean recomputed each render from `form`.
- An `onBlur` handler that adds the field name to `blurredFields`.
- A `<span className="field-error">` rendered inside each labeled field when `errors[fieldName]` is truthy.
- A `disabled={!isFormValid}` prop on the Submit button.

#### Required-field map (shared between Edit and Create)

```js
const REQUIRED_FIELDS = {
  title:           "Design title is required",
  main_tag:        "Main tag is required",
  supporting_tags: "Supporting tags are required",
  description:     "Description is required",
  // copy_link handled separately by validateCopyLink
};
```

#### Edit view — local state additions (inside the `if (editingId && editingId !== "new")` branch)

```jsx
const [blurredFields, setBlurredFields] = useState(() => new Set());

const markBlurred = (name) =>
  setBlurredFields((prev) => {
    if (prev.has(name)) return prev;
    const next = new Set(prev);
    next.add(name);
    return next;
  });

// Reset on entering a different design
useEffect(() => {
  setBlurredFields(new Set());
}, [editingId]);

const errors = (() => {
  const out = {};
  for (const [name, message] of Object.entries(REQUIRED_FIELDS)) {
    if (!validateRequired(form[name])) out[name] = message;
  }
  const copyLinkResult = validateCopyLink(form.copy_link);
  if (copyLinkResult.status.startsWith("invalid-")) {
    out.copy_link = copyLinkResult.message;
  }
  return out;
})();

const copyLinkResult = validateCopyLink(form.copy_link);
const copyLinkTip =
  copyLinkResult.status === "valid-with-tip" ? copyLinkResult.tip : null;

const isFormValid =
  Object.values(REQUIRED_FIELDS).every((_msg, i) => {
    const name = Object.keys(REQUIRED_FIELDS)[i];
    return validateRequired(form[name]);
  }) && isCopyLinkValid(form.copy_link);
```

#### Edit view — sticker preview inline style

Replace:
```jsx
style={{ "--sticker-preview-color": formStickerEnabled ? formStickerColor : "#7d7d7d" }}
```
With:
```jsx
style={resolveStickerPreviewStyle(formStickerEnabled, formStickerColor)}
```
on both the `<img className="edit-sticker-preview">` and the `<div className="edit-preview-empty edit-sticker-preview">`.

#### Edit view — labeled field with helper text (pattern, applied per required field)

```jsx
<label>
  Design Title <span className="req-asterisk">*</span>
  <textarea
    value={form.title}
    onChange={(event) => updateForm("title", event.target.value)}
    onBlur={() => markBlurred("title")}
    rows={2}
    placeholder="Enter design title"
    aria-invalid={Boolean(errors.title && blurredFields.has("title"))}
  />
  {errors.title && blurredFields.has("title") && (
    <span className="field-error">{errors.title}</span>
  )}
</label>
```

The same pattern is applied to `main_tag`, `supporting_tags`, `description`. Note: the existing `required` HTML attribute is removed from these textareas since validation is now driven by the React state derivation. The red asterisk visual marker stays.

#### Edit view — Copy Link field

```jsx
<label className="edit-grid-wide copy-link-field">
  <span className="copy-link-label">
    Copy Link <span className="req-asterisk">*</span>
    <a /* unchanged setup-guide link */ />
  </span>
  <div className="copy-link-row">
    <input
      type="url"
      value={form.copy_link}
      onChange={(event) => updateForm("copy_link", event.target.value)}
      onBlur={() => markBlurred("copy_link")}
      placeholder="https://www.redbubble.com/portfolio/images/123456789-design-name/duplicate"
      aria-invalid={Boolean(errors.copy_link && blurredFields.has("copy_link"))}
    />
    <button
      type="button"
      className="copy-link-open"
      onClick={() => form.copy_link && window.open(form.copy_link, "_blank", "noreferrer")}
      disabled={!isCopyLinkValid(form.copy_link)}
      aria-label="Open copy link"
      title="Open copy link"
    >
      <Icon name="link" />
    </button>
  </div>
  {errors.copy_link && blurredFields.has("copy_link") && (
    <span className="field-error">{errors.copy_link}</span>
  )}
  {!errors.copy_link && copyLinkTip && (
    <span className="copy-link-help">{copyLinkTip}</span>
  )}
</label>
```

The Open button now requires the link to be valid (not just non-empty), preventing the user from launching a broken or wrong-domain URL.

#### Edit view — Submit button

```jsx
<button type="submit" className="primary-button" disabled={!isFormValid}>
  Update Design
</button>
```

#### Create view — identical pattern

The Create view (`if (editingId === "new")` branch, ~540–760) receives the same treatment with these adaptations:

- The form data lives in `activeCreateDraft` keyed by `activeCreateImageId`. Because `blurredFields` should be tracked *per draft*, the state shape is:
  ```js
  const [blurredFieldsByDraft, setBlurredFieldsByDraft] = useState(() => ({}));
  const blurredFields = blurredFieldsByDraft[activeCreateImageId] ?? new Set();
  const markBlurred = (name) =>
    setBlurredFieldsByDraft((prev) => {
      const current = prev[activeCreateImageId] ?? new Set();
      if (current.has(name)) return prev;
      const next = new Set(current);
      next.add(name);
      return { ...prev, [activeCreateImageId]: next };
    });
  ```
- The Save All button (`disabled={selectedCreateImages.length === 0}`) becomes `disabled={selectedCreateImages.length === 0 || !allDraftsValid}` where `allDraftsValid` runs `isFormValid` against every draft (using each draft's `title`, parsed `main_tag` from `tags[0]`, parsed `supporting_tags` from `tags.slice(1).join(",")`, `description`, and `copy_link`). This satisfies Requirement 4 for the bulk Create flow.
- The sticker preview style uses `resolveStickerPreviewStyle(activeStickerEnabled, activeStickerColor)`.
- The same `<span className="field-error">` rendering is applied below each required field.
- The Copy Link input is wrapped in `.copy-link-row` and gets the same Open-button gating.

### CSS Changes — `frontend/src/styles.css`

#### New rule (added near the existing `.copy-link-help` block)

```css
.field-error {
  display: block;
  font-size: 12px;
  color: var(--pp-danger);
  margin-top: 4px;
  line-height: 1.3;
}

.field-error::before {
  /* visually-quiet leading dot keeps red helper text from sitting flush against the input */
  content: "";
}
```

#### Existing rules confirmed (not rewritten — existing classes already meet the brief)

- `.edit-page`, `.edit-panel`, `.edit-panel-heading`, `.edit-actions` — kept as-is. `.edit-actions` already anchors bottom-right.
- `.edit-panel-layout` — already declares `grid-template-columns: 280px 1fr;` at `min-width: 900px`, stacks below. Confirmed to satisfy Requirement 2 (the brief asks for `>=900px` here, not the earlier `>=960px` figure mentioned in the requirements text — the existing 900px breakpoint is retained because the user's technical context explicitly calls it out).
- `.edit-grid` — already declares `grid-template-columns: 1fr 1fr;` at `min-width: 720px`, single column below. Confirmed.
- `.edit-grid-wide` — full-row span, used for Copy Link and Description.
- `.edit-preview-card` — white card, soft border, rounded corners using `var(--pp-card)`, `var(--pp-border)`, `var(--pp-radius-lg)`, `var(--pp-shadow-sm)`. Confirmed.
- `.edit-sticker-preview` — default background is white. The `--sticker-preview-color` variable, when set, overlays as a tint via the existing `background` rule. Confirmed: when the variable is unset, the white default stays.
- `.copy-link-field`, `.copy-link-label`, `.copy-link-row`, `.copy-link-open`, `.copy-link-help` — kept.
- `.toggle-card` — kept.
- `.sticker-color-card` — alignment polish only: ensure `display: flex; align-items: center; gap: 12px; flex-wrap: wrap;` so on `<720px` viewports the children stack with the `gap` providing the >=8px spacing required by 5.2. The existing rule may already do this; if not, the gap and flex-wrap values are added without changing the visual identity.
- `.req-asterisk` — kept.

#### Label-to-field spacing (Requirements 2.5, 2.6)

The existing `.edit-grid label` rule sets `display: flex; flex-direction: column; gap: 8px;`. To meet the >=12px requirement, this gap is bumped to `12px`. This is a one-token change in `styles.css` near the `.edit-grid` block.

## Data Models

No new persisted data. The new ephemeral runtime shapes are:

```ts
// Returned by validateCopyLink
type CopyLinkValidation =
  | { status: "valid-clean" }
  | { status: "valid-with-tip"; tip: string }
  | { status: "invalid-empty";  message: string }
  | { status: "invalid-scheme"; message: string }
  | { status: "invalid-host";   message: string };

// Local state additions on the Edit view
type EditViewState = {
  blurredFields: Set<string>;
};

// Local state additions on the Create view
type CreateViewState = {
  blurredFieldsByDraft: Record<string /* draftId */, Set<string>>;
};

// Derived each render
type DisplayedErrors = Partial<Record<
  "title" | "main_tag" | "supporting_tags" | "description" | "copy_link",
  string
>>;
```

## Error Handling

- **Validator never throws.** `validateCopyLink` wraps `new URL(...)` in `try/catch` and treats any throw as `invalid-scheme`. Non-string inputs to `validateRequired` short-circuit to `false`.
- **No `console.error` calls** are introduced. Validation results flow through state into rendered helper text.
- **The `URL` constructor** is available in all supported browsers (Vite targets evergreen browsers). No polyfill is needed.
- **Whitespace-only inputs** are treated as empty by `validateRequired` (post-trim). `validateCopyLink` also trims before parsing so a leading/trailing space does not cause a false `invalid-scheme`.
- **Open button safety.** The Open Copy Link button is now gated on `isCopyLinkValid`, so clicking cannot launch `javascript:` URLs or non-Redbubble hosts.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Sticker preview style respects the toggle

For any boolean `toggleEnabled` and any color string `color`, `resolveStickerPreviewStyle(toggleEnabled, color)` SHALL return `undefined` (or a value that does not contain the `--sticker-preview-color` key) when `toggleEnabled` is `false`, and SHALL return an object with `--sticker-preview-color` equal to `color` when `toggleEnabled` is `true`.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Copy Link validator classifies inputs correctly

For any string input `value`, `validateCopyLink(value)` SHALL return a result whose `status` matches the input's classification:
- `value` is empty or whitespace-only ⇒ `status === "invalid-empty"`
- `value` is non-empty, parses as a URL with scheme other than `https` (or fails to parse) ⇒ `status === "invalid-scheme"`
- `value` parses as `https` URL whose hostname is neither `redbubble.com` nor a subdomain ending in `.redbubble.com` ⇒ `status === "invalid-host"`
- `value` parses as `https` URL with a Redbubble host whose pathname matches `/^\/portfolio\/images\/\d+-[\w-]+\/duplicate\/?$/` ⇒ `status === "valid-clean"`
- `value` parses as `https` URL with a Redbubble host whose pathname does not match the duplicate shape ⇒ `status === "valid-with-tip"`

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

### Property 3: Submit gating reflects required-field and Copy Link validity

For any form state `form`, `isFormValid(form)` SHALL return `true` if and only if every required field (`title`, `main_tag`, `supporting_tags`, `description`) is non-empty after trimming AND `validateCopyLink(form.copy_link).status` starts with `valid-`. In every other case it SHALL return `false`.

**Validates: Requirements 4.2, 4.3, 4.6**

### Property 4: Displayed errors are gated by blur and reflect current validity

For any form state `form`, any `blurredFields` set, and any required field name `f`, the displayed error map produced by `getDisplayedErrors(form, blurredFields)` SHALL contain an entry for `f` if and only if `blurredFields` contains `f` AND the field's value fails its validator. As soon as the value becomes valid, the entry SHALL be absent regardless of whether `f` remains in `blurredFields`.

**Validates: Requirements 4.4, 4.5, 4.6**

## Testing Strategy

**Unit tests (example-based)** for `designValidation.js`:
- `validateCopyLink("")` returns `invalid-empty`
- `validateCopyLink("   ")` returns `invalid-empty`
- `validateCopyLink("not a url")` returns `invalid-scheme`
- `validateCopyLink("http://www.redbubble.com/x")` returns `invalid-scheme`
- `validateCopyLink("https://example.com/")` returns `invalid-host`
- `validateCopyLink("https://www.redbubble.com/portfolio/images/123-foo-bar/duplicate")` returns `valid-clean`
- `validateCopyLink("https://www.redbubble.com/portfolio/images/123-foo-bar/duplicate/")` returns `valid-clean` (trailing slash)
- `validateCopyLink("https://shop.redbubble.com/")` returns `valid-with-tip` (subdomain accepted)
- `validateCopyLink("https://www.redbubble.com/")` returns `valid-with-tip` (homepage)
- `resolveStickerPreviewStyle(false, "#abcdef")` returns `undefined`
- `resolveStickerPreviewStyle(true, "#abcdef")` returns `{ "--sticker-preview-color": "#abcdef" }`

**Property-based tests** (minimum 100 iterations each; runner is `fast-check` if available, otherwise the lightweight property runner already used in the project — selection deferred to the Tasks phase). Each test is tagged `Feature: redbubble-edit-design-ui-polish, Property N: <text>`.

- **Property 1** — generator: arbitrary boolean for toggle, arbitrary hex color string for color. Assert the returned object's key presence matches the rule.
- **Property 2** — three composed generators:
  1. `gen-malformed`: arbitrary strings (including empty, whitespace, garbage, javascript URLs).
  2. `gen-non-redbubble-https`: `https://${randomHost}${randomPath}` where host is constrained not to end in `redbubble.com`.
  3. `gen-valid-duplicate`: `https://www.redbubble.com/portfolio/images/${randomDigits}-${randomSlug}/duplicate` (with optional trailing slash).
  4. `gen-valid-non-duplicate`: `https://${redbubbleHost}/${arbitraryPath}` where host is `redbubble.com` or `*.redbubble.com` and path does not match the duplicate regex.
  Assert each generator's outputs land in the expected `status`.
- **Property 3** — generator: a record `{ title, main_tag, supporting_tags, description, copy_link }` where each field is independently chosen from {empty string, whitespace string, arbitrary non-empty string} and `copy_link` is independently sampled from the gen-valid / gen-invalid generators above. Assert `isFormValid` equals the conjunction of `validateRequired` on each required field and `isCopyLinkValid(copy_link)`.
- **Property 4** — generator: form state as in Property 3, plus an arbitrary subset of field names as `blurredFields`. Assert `getDisplayedErrors(form, blurredFields)[f]` is defined iff `f ∈ blurredFields` and `f` is invalid.

**Integration / smoke tests**:
- Render Edit view with no copy link, assert Submit button is disabled and no red helper text is shown until a field is blurred.
- Render Edit view with all fields filled and a duplicate URL, assert Submit is enabled and no helper text shown.
- Toggle sticker color off and confirm the rendered `<img>` has no inline `--sticker-preview-color` style attribute (DOM assertion).
- Manual responsive check at 960px and 700px viewport widths to confirm the two-column / single-column layout switch.

**Out of scope for tests** (per requirements): backend save logic, Supabase calls, Redbubble automation, trademark checker, TeePublic editor.
