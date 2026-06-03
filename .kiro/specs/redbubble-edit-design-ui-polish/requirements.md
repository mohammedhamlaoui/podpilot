# Requirements Document

## Introduction

This feature polishes the visual presentation and validation behavior of the Edit Redbubble Design view and the Create Redbubble Design view inside `frontend/src/components/DesignManager.jsx`. The goal is a clean SaaS-style form aesthetic (white cards, soft borders, rounded corners, balanced spacing) consistent with the rest of the app, with the sticker preview rendered without a dark overlay unless the sticker color toggle is enabled, a two-column desktop layout that collapses to one column on mobile, and Copy Link URL validation that gates the submit action with inline red helper text. Backend behavior, save/update logic, the Redbubble automation pipeline, the trademark checker, and the TeePublic editor are out of scope.

## Glossary

- **Edit_Page**: The Edit Redbubble Design view rendered inside `DesignManager.jsx` (the `<section className="workflow-panel manager-panel edit-page">` block).
- **Create_Page**: The Create Redbubble Design view rendered inside `DesignManager.jsx` (the sibling create form section).
- **Sticker_Preview**: The image preview rendered with class `edit-sticker-preview` inside `edit-preview-card`, showing the sticker image for the design being edited or created.
- **Sticker_Color_Toggle**: The toggle control inside `sticker-color-card` that enables or disables applying `--sticker-preview-color` as a background tint behind the sticker image.
- **Copy_Link_Field**: The Redbubble portfolio duplicate URL input rendered with class `copy-link-field`.
- **Required_Field**: A form field marked with a red asterisk in the Edit_Page or Create_Page UI: title, main tag, supporting tags, description, and Copy_Link_Field.
- **Submit_Button**: The primary action button at the bottom-right of the form labeled "Update Design" on Edit_Page and the equivalent create button on Create_Page.
- **Helper_Text**: A small inline message rendered directly below a form field, styled red when reporting a validation error.
- **Redbubble_Host**: A hostname equal to `redbubble.com` or any subdomain ending in `.redbubble.com`.
- **Duplicate_URL_Shape**: A Copy_Link_Field value matching the canonical pattern `https://www.redbubble.com/portfolio/images/{id}-{slug}/duplicate`.

## Requirements

### Requirement 1 — Sticker Preview Renders Without Dark Overlay By Default

**User Story:** As a seller editing a Redbubble design, I want the sticker image preview to be clearly visible on a white background, so that I can see the artwork I am about to publish.

#### Acceptance Criteria

1. WHILE the Sticker_Color_Toggle is off, THE Sticker_Preview SHALL render the sticker image over a white background with no `--sticker-preview-color` tint applied.
2. WHILE the Sticker_Color_Toggle is on, THE Sticker_Preview SHALL apply the user-selected `--sticker-preview-color` value as the background behind the sticker image.
3. WHEN no sticker image URL is available, THE Sticker_Preview SHALL render the existing `edit-preview-empty` placeholder state without applying a color tint.
4. THE Edit_Page SHALL render the Sticker_Preview inside a white card with soft border and rounded corners consistent with the existing `edit-preview-card` styling.
5. THE Create_Page SHALL render its preview area using the same white card, border, and rounded-corner treatment as the Edit_Page Sticker_Preview.

### Requirement 2 — Two-Column Desktop Layout, Single-Column Mobile

**User Story:** As a seller, I want the Edit and Create forms to use horizontal space on desktop and stack cleanly on mobile, so that the form feels balanced and readable on any screen.

#### Acceptance Criteria

1. WHILE the viewport width is at least 960px, THE Edit_Page SHALL render the Sticker_Preview and the form inputs in a two-column layout using the existing `edit-panel-layout` and `edit-grid` containers.
2. WHILE the viewport width is below 720px, THE Edit_Page SHALL render the Sticker_Preview and the form inputs stacked in a single column.
3. WHILE the viewport width is at least 960px, THE Create_Page SHALL render its preview and form inputs in a two-column layout matching the Edit_Page layout.
4. WHILE the viewport width is below 720px, THE Create_Page SHALL render its preview and form inputs stacked in a single column.
5. THE Edit_Page SHALL apply consistent vertical spacing of at least 12px between every label and the field below the label across all inputs.
6. THE Create_Page SHALL apply the same label-to-field spacing rule as the Edit_Page.

### Requirement 3 — Copy Link URL Validation

**User Story:** As a seller, I want the Copy Link field to confirm I pasted a Redbubble URL, so that I cannot submit a design with a broken or wrong-domain link.

#### Acceptance Criteria

1. WHEN the Copy_Link_Field value is empty, THE Edit_Page SHALL treat the field as invalid and display Helper_Text reading "Copy link is required" in red below the field.
2. IF the Copy_Link_Field value cannot be parsed as a URL with scheme `https`, THEN THE Edit_Page SHALL display Helper_Text reading "Copy link must start with https://" in red below the field.
3. IF the Copy_Link_Field value parses as a URL but the host is not a Redbubble_Host, THEN THE Edit_Page SHALL display Helper_Text reading "Copy link must be a redbubble.com URL" in red below the field.
4. WHEN the Copy_Link_Field value parses as a URL with scheme `https` and a Redbubble_Host but does not match the Duplicate_URL_Shape, THE Edit_Page SHALL display non-blocking Helper_Text reading "Tip: paste the duplicate URL ending in /duplicate for best results" in the existing `copy-link-help` style and SHALL treat the field as valid for submit.
5. WHEN the Copy_Link_Field value matches the Duplicate_URL_Shape, THE Edit_Page SHALL hide the Helper_Text and SHALL treat the field as valid for submit.
6. THE Create_Page SHALL apply the same Copy_Link_Field validation rules as the Edit_Page.

### Requirement 4 — Required Field Validation and Submit Gating

**User Story:** As a seller, I want the form to tell me which required fields I missed and prevent submission until I fix them, so that I do not accidentally save an incomplete design.

#### Acceptance Criteria

1. THE Edit_Page SHALL treat title, main tag, supporting tags, description, and Copy_Link_Field as Required_Fields.
2. WHEN any Required_Field has an empty or whitespace-only value, THE Edit_Page SHALL render the Submit_Button in a disabled state.
3. WHEN every Required_Field has a non-empty value and the Copy_Link_Field passes the validation rules in Requirement 3, THE Edit_Page SHALL render the Submit_Button in an enabled state.
4. WHEN a Required_Field loses focus while empty, THE Edit_Page SHALL display Helper_Text in red below the field naming the missing value.
5. WHILE a user is typing in a Required_Field that previously showed an error, THE Edit_Page SHALL clear the Helper_Text for that field as soon as the value becomes valid.
6. THE Create_Page SHALL apply the same Required_Field set, submit gating, on-blur error display, and on-input error clearing as the Edit_Page.
7. THE Edit_Page SHALL keep the Cancel button and the Submit_Button anchored to the bottom-right of the form using the existing `edit-actions` container.

### Requirement 5 — Sticker Color Toggle Layout Polish

**User Story:** As a seller, I want the Enable Sticker Color toggle and its color picker to feel like one tidy control group, so that the section does not look like loose floating elements.

#### Acceptance Criteria

1. THE Edit_Page SHALL render the Sticker_Color_Toggle, its label, and the color picker inside the existing `sticker-color-card` container as a single visually grouped row on viewports of at least 720px.
2. WHILE the viewport width is below 720px, THE Edit_Page SHALL stack the Sticker_Color_Toggle, its label, and the color picker vertically with at least 8px vertical spacing between elements.
3. WHILE the Sticker_Color_Toggle is off, THE Edit_Page SHALL render the color picker in a visibly disabled state.
4. THE Create_Page SHALL render its sticker color controls using the same grouping, spacing, and disabled-state behavior as the Edit_Page.

### Requirement 6 — Visual Consistency With App Aesthetic

**User Story:** As a seller using the app, I want the Edit and Create forms to share the look and feel of the rest of the product, so that the experience feels cohesive.

#### Acceptance Criteria

1. THE Edit_Page SHALL style every input, textarea, and card using the existing CSS custom properties `--pp-card`, `--pp-border`, and the existing border-radius tokens already used elsewhere in `styles.css`.
2. THE Create_Page SHALL style every input, textarea, and card using the same CSS custom properties and border-radius tokens as the Edit_Page.
3. THE Edit_Page SHALL NOT introduce new CSS frameworks, utility-class libraries, or third-party UI dependencies.
4. THE Create_Page SHALL NOT introduce new CSS frameworks, utility-class libraries, or third-party UI dependencies.
