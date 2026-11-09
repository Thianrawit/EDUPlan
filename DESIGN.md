---
version: alpha
name: Thianrawit
description: |
  EduPlan AI presents a clean, modern educational technology interface built on
  a foundation of soft neutrals and energetic brand accents. The visual language
  prioritizes clarity and accessibility, with ample whitespace, gentle shadows,
  and a warm, inviting color palette that feels approachable to educators. The
  system employs a layered depth model through subtle color blocking rather than
  aggressive shadows, creating a sense of hierarchy without visual heaviness.
  Two distinct product cards anchor the interface using bold, vibrant gradient
  buttons—one in cobalt blue, the other in rich purple—signaling different user
  paths. The overall atmosphere is professional yet friendly, designed to
  inspire confidence in an AI-powered educational planning tool while
  maintaining the approachability of a learning platform.
source:
  url: "https://thianrawit.github.io/EDUPlan/"
  pagesAnalyzed: 1
  extractedAt: 2026-11-07
  tokensMeasured: true
colors:
  canvas: "#F8FAFC"
  ink: "#0F172A"
  body: "#334155"
  muted: "#475569"
  faint: "#94A3B8"
  hairline: "#E2E8F0"
  accent-1: "#1E293B"
  accent-2: "#64748B"
  accent-3: "#2563EB"
  accent-4: "#1D4ED8"
  accent-5: "#BFDBFE"
  accent-6: "#DBEAFE"
  accent-7: "#E9D5FF"
  neutral-1: "#CBD5E1"
  neutral-2: "#F3E8FF"
typography:
  heading-md:
    fontFamily: Sarabun
    fontSize: 38.25px
    fontWeight: 800
    lineHeight: 1.11
    letterSpacing: -0.96px
  heading-sm:
    fontFamily: Sarabun
    fontSize: 21.25px
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: 0px
  body-md:
    fontFamily: Sarabun
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0px
  body-sm:
    fontFamily: Sarabun
    fontSize: 14.875px
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: 0px
  body-xs:
    fontFamily: Sarabun
    fontSize: 12.75px
    fontWeight: 400
    lineHeight: 1.33
    letterSpacing: 0px
  body-xs-strong:
    fontFamily: Sarabun
    fontSize: 12.75px
    fontWeight: 500
    lineHeight: 1.33
    letterSpacing: 0px
  body-xs-2:
    fontFamily: Sarabun
    fontSize: 12.75px
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: 0px
  body-xs-3:
    fontFamily: Sarabun
    fontSize: 12.75px
    fontWeight: 700
    lineHeight: 1.33
    letterSpacing: 0px
  button:
    fontFamily: Sarabun
    fontSize: 17.85px
    fontWeight: 700
    lineHeight: 1.6
    letterSpacing: 0px
rounded:
  xs: 8.5px
  sm: 12.75px
  md: 20px
spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 20px
  xl: 24px
  xxl: 28px
  xxxl: 36px
  section: 44px
  band: 48px
borderWidths:
  thin: 1px
shadows:
  sm: "rgba(0, 0, 0, 0.05) 0px 1px 2px 0px"
  md: "rgba(0, 0, 0, 0.1) 0px 20px 25px -5px, rgba(0, 0, 0, 0.1) 0px 8px 10px -6px"
elevationStrategy: layered-micro
themes:
  derived: dark   # the other theme is the site's measured palette
  light:
    bg: "#F8FAFC"
    surface: "#F1F3F4"
    surfaceRaised: "#E8EAEC"
    text: "#0F172A"
    textMuted: "#334155"
    border: "#E2E8F0"
    accent: "#0F172A"
    accentFg: "#FFFFFF"
    focusRing: "#0F172A"
    elevation: shadow
  dark:
    bg: "#0D0F11"
    surface: "#1C1D1F"
    surfaceRaised: "#28292B"
    text: "#F5F6F6"
    textMuted: "#9D9E9F"
    border: "#343537"
    accent: "#6683C8"
    accentFg: "#0B0B0C"
    focusRing: "#3F61B1"
    elevation: "border+surface"
gradients:
  - context: section
    kind: linear
    value: "linear-gradient(to right, rgb(37, 99, 235), rgb(79, 70, 229))"
  - context: section
    kind: linear
    value: "linear-gradient(to right, rgb(37, 99, 235), rgb(2, 132, 199))"
  - context: section
    kind: linear
    value: "linear-gradient(to right, rgb(147, 51, 234), rgb(79, 70, 229))"
components:
  button-text:
    typography: "{typography.button}"
    textColor: "rgb(255, 255, 255)"
    height: 54.0469px
    padding: "12.75px 17px 12.75px 17px"
    boxShadow: "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.05) 0px 1px 2px 0px"
    rounded: "{rounded.sm}"
  button-outline:
    typography: "{typography.body-xs-strong}"
    textColor: "{colors.muted}"
    border: "1px solid {colors.hairline}"
    height: 31.75px
    padding: "6.375px 12.75px 6.375px 12.75px"
    rounded: "{rounded.xs}"
  button-icon:
    textColor: "{colors.muted}"
    border: "1px solid {colors.hairline}"
    height: 31.75px
    padding: "6.375px 6.375px 6.375px 6.375px"
    fontSize: 17.85px
    fontFamily: Sarabun
    fontWeight: 400
    lineHeight: 1.6
    rounded: "{rounded.xs}"
  card:
    textColor: "{colors.accent-1}"
    border: "1px solid {colors.hairline}"
    padding: "29.75px 29.75px 29.75px 29.75px"
    fontSize: 17.85px
    boxShadow: "rgba(0, 0, 0, 0.05) 0px 1px 2px 0px"
    fontFamily: Sarabun
    fontWeight: 400
    lineHeight: 1.6
    rounded: "{rounded.md}"
    backgroundColor: "rgb(255, 255, 255)"
  footer:
    typography: "{typography.body-xs}"
    textColor: "{colors.accent-2}"
    border: "1px solid {colors.hairline}"
    padding: "25.5px 0px 25.5px 0px"
    backgroundColor: "rgb(255, 255, 255)"
states:
  other-hover:
    target: other
    state: hover
    backgroundColor: "{colors.faint}"
  button-hover:
    target: button
    state: hover
    textColor: "{colors.accent-4}"
    borderColor: "rgb(147, 197, 253)"
    backgroundColor: "rgb(240, 247, 255)"
  card-hover:
    target: card
    state: hover
    borderColor: "rgb(147, 197, 253)"
    backgroundColor: "{colors.canvas}"
  input-focus:
    target: input
    state: focus
    boxShadow: "rgba(37, 99, 235, 0.15) 0px 0px 0px 3px"
    borderColor: "{colors.accent-3}"
  button-disabled:
    target: button
    state: disabled
    opacity: 0.5
  badge-hover:
    target: badge
    state: hover
    borderColor: "rgb(147, 197, 253)"
    backgroundColor: "{colors.canvas}"
  other-focus-visible:
    target: other
    state: focus-visible
    boxShadow: "rgba(37, 99, 235, 0.25) 0px 0px 0px 3px"
  button-active:
    target: button
    state: active
    transform: "translateY(0px)"
  other-focus:
    target: other
    state: focus
    outline: "transparent solid 2px"
    outlineColor: transparent
    outlineWidth: 2px
  other-disabled:
    target: other
    state: disabled
    opacity: 0.4
breakpoints:
  - width: 375
    containerWidth: 1920
    gridColumns: 0
    navLinksVisible: 0
    menuToggleVisible: false
    headingPx: 32
    bodyPx: 18
    sectionPaddingX: 0
  - width: 768
    containerWidth: 1920
    gridColumns: 0
    navLinksVisible: 0
    menuToggleVisible: false
    headingPx: 38
    bodyPx: 18
    sectionPaddingX: 0
  - width: 1024
    containerWidth: 1920
    gridColumns: 2
    navLinksVisible: 0
    menuToggleVisible: false
    headingPx: 38
    bodyPx: 18
    sectionPaddingX: 0
  - width: 1280
    containerWidth: 1920
    gridColumns: 2
    navLinksVisible: 0
    menuToggleVisible: false
    headingPx: 38
    bodyPx: 18
    sectionPaddingX: 0
  - width: 1440
    containerWidth: 1920
    gridColumns: 2
    navLinksVisible: 0
    menuToggleVisible: false
    headingPx: 38
    bodyPx: 18
    sectionPaddingX: 0
coverage:
  statesFound: 48
  gradientsFound: 3
  rolesUnassigned: 9
  archetypesUnnamed: 0
  archetypesDetected: 0
  responsiveMeasured: true
  stylesheetsBlocked: false
  semanticRampDeclared: false
---

# Design System Inspired by EduPlan AI

## 1. Visual Theme & Atmosphere

EduPlan AI presents a clean, modern educational technology interface built on a foundation of soft neutrals and energetic brand accents. The visual language prioritizes clarity and accessibility, with ample whitespace, gentle shadows, and a warm, inviting color palette that feels approachable to educators. The system employs a layered depth model through subtle color blocking rather than aggressive shadows, creating a sense of hierarchy without visual heaviness. Two distinct product cards anchor the interface using bold, vibrant gradient buttons—one in cobalt blue, the other in rich purple—signaling different user paths. The overall atmosphere is professional yet friendly, designed to inspire confidence in an AI-powered educational planning tool while maintaining the approachability of a learning platform.

**Key Characteristics**
- Soft, neutral background (`{colors.canvas}` — `#F8FAFC`) with minimal shadow elevation
- Bold, saturated CTAs in blue and purple with smooth corner radius
- Thai typography (Sarabun) supporting bilingual content seamlessly
- Generous whitespace and balanced two-column card layouts
- Micro-interactions with subtle transforms and color shifts on hover
- Gradient accents used sparingly for visual interest on key actions
- High contrast text hierarchy from `{colors.ink}` to `{colors.faint}`

## 2. Color Palette & Roles

### Primary
- **Blue Primary** (`{colors.accent-3}` — `#2563EB`): Brand CTA fill, link text, focus indicators, and interactive highlights. Used prominently on primary action buttons and hover states.
- **Blue Darker** (`{colors.accent-4}` — `#1D4ED8`): Deepened blue for hover states on primary buttons, providing tactile feedback and visual emphasis.

### Accent Colors
- **Purple Accent** (`{colors.accent-7}` — `#E9D5FF`): Light purple tint for secondary card backgrounds and accent surfaces; pairs with purple CTAs.
- **Blue Light** (`{colors.accent-5}` — `#BFDBFE`): Pale blue used in hover states and low-emphasis backgrounds.
- **Blue Lighter** (`{colors.accent-6}` — `#DBEAFE`): Lighter blue tint for subtle backgrounds and secondary accent surfaces.
- **Slate Tones** (`{colors.accent-1}` — `#1E293B`, `{colors.accent-2}` — `#64748B`): Decorative accents for visual variety; no specific role assigned.

### Interactive
- **Hairline** (`{colors.hairline}` — `#E2E8F0`): 1px borders on cards, inputs, and dividers; provides subtle definition without visual weight.
- **Neutral Border** (`{colors.neutral-1}` — `#CBD5E1`): Secondary border color for interactive elements and disabled states.

### Neutral Scale
- **Ink** (`{colors.ink}` — `#0F172A`): Primary heading and headline text; highest contrast for critical information.
- **Body** (`{colors.body}` — `#334155`): Body copy and main content text; readable and warm.
- **Muted** (`{colors.muted}` — `#475569`): Secondary copy, captions, and helper text; reduced emphasis.
- **Faint** (`{colors.faint}` — `#94A3B8`): Tertiary text, placeholders, and very light metadata; minimal hierarchy.

### Surface & Borders
- **Canvas** (`{colors.canvas}` — `#F8FAFC`): Default page background; soft, cool off-white that reduces eye strain.
- **White** (observed as `rgb(255, 255, 255)` in component data): Card and container backgrounds; provides clean contrast against canvas.
- **Neutral Light** (`{colors.neutral-2}` — `#F3E8FF`): Light purple-tinted surface for secondary card styling.

## 3. Typography Rules

### Font Family

**Primary Font:** Sarabun (https://fonts.googleapis.com/css2?family=Sarabun:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap)

- **Font Stack:** `Sarabun, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- **Rationale:** Sarabun is a humanist sans-serif optimized for Thai script with excellent Latin support, making it ideal for bilingual Thai–English education content. Fallbacks ensure readability on systems without the webfont loaded.

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|---|---|---|---|---|---|---|
| Display / Hero | Sarabun | 38.25px | 800 | 1.11 | −0.96px | Used for main page title "ยินดีต้อนรับสู่ EduPlan AI"; negative tracking adds sophistication. |
| Heading | Sarabun | 21.25px | 700 | 1.4 | 0px | Card titles and section headers; strong visual anchor. |
| Body MD | Sarabun | 17px | 400 | 1.5 | 0px | Primary body text; comfortable reading rhythm for paragraphs. |
| Button | Sarabun | 17.85px | 700 | 1.6 | 0px | CTA labels; increased weight and line height for clarity in interactive contexts. |
| Body SM | Sarabun | 14.875px | 400 | 1.43 | 0px | Secondary content and descriptive text; slightly reduced size maintains hierarchy. |
| Caption / XS | Sarabun | 12.75px | 400 | 1.33 | 0px | Captions, helper text, and metadata; still readable at small sizes. |
| Caption / XS Strong | Sarabun | 12.75px | 500 | 1.33 | 0px | Emphasized small text; bridge between normal and bold captions. |
| Caption / XS Bold | Sarabun | 12.75px | 600–700 | 1.33 | 0px | Strong small labels and badge text; adds visual weight at small scale. |

### Principles

- **Negative Tracking on Display:** The hero heading (`{typography.heading-md}` — 38.25px, weight 800, −0.96px letter-spacing) uses intentional negative tracking to create a compressed, premium feel.
- **Bilingual Support:** Sarabun's uniform metrics across Thai and Latin scripts ensure consistent spacing and line heights regardless of language.
- **Generous Line Height:** All body and caption sizes maintain line-height ratios ≥ 1.3, supporting readability and accessibility for both languages.
- **Weight Hierarchy:** Weights cluster at 400 (body), 500 (emphasis), 600–700 (labels and buttons), and 800 (display), creating clear visual distinction.
- **Scale Ratios:** Jump from heading (21.25px) to body (17px) maintains breathing room; small sizes (12.75px) are still distinct in weight, not just size.

## 4. Component Stylings

### Buttons

#### Primary Button (Filled)
- **Background:** `#2563EB` (`{colors.accent-3}`)
- **Text Color:** `#FFFFFF`
- **Font:** Sarabun, 17.85px, weight 700, line-height 1.6
- **Padding:** `{spacing.sm}` (`12.75px`) vertical, `{spacing.md}` (`17px`) horizontal
- **Border Radius:** `{rounded.xs}` (`8.5px`)
- **Border:** None
- **Box Shadow:** `rgba(0, 0, 0, 0.05) 0px 1px 2px 0px` (base), `rgba(37, 99, 235, 0.35) 0px 4px 10px` (hover)
- **Width:** ~333.75px (full-width in card context)
- **Height:** ~54.05px
- **Hover State:** Background becomes `#1D4ED8`, box shadow deepens to `rgba(37, 99, 235, 0.35) 0px 4px 10px`, transform: `translateY(-1px)`
- **Active State:** transform: `translateY(0px)` (shadow reduces, button returns to baseline)
- **Disabled State:** opacity: 0.4, color: `#F1F5F9`, border-color: `#CBD5E1`, background: `#94A3B8`, no shadow

#### Secondary Button (Outline)
- **Background:** transparent
- **Text Color:** `#475569` (`{colors.muted}`)
- **Font:** Sarabun, 12.75px, weight 500, line-height 1.33
- **Padding:** `{spacing.xs}` (`6.375px`) vertical, `{spacing.sm}` (`12.75px`) horizontal
- **Border:** 1px solid `#E2E8F0` (`{colors.hairline}`)
- **Border Radius:** `{rounded.xs}` (`8.5px`)
- **Box Shadow:** none
- **Width:** ~66.5px
- **Height:** ~31.75px
- **Hover State:** Border becomes `#94A3B8`, background becomes `#F8FAFC`, text becomes `#1E293B`

#### Icon Button
- **Background:** transparent
- **Text Color:** `#475569` (`{colors.muted}`)
- **Font:** Sarabun, 17.85px, weight 400, line-height 1.6
- **Padding:** `{spacing.xs}` (`6.375px`) on all sides
- **Border:** 1px solid `#E2E8F0` (`{colors.hairline}`)
- **Border Radius:** `{rounded.xs}` (`8.5px`)
- **Width/Height:** ~31.75px (square)
- **Box Shadow:** none
- **Hover State:** Background: `#F8FAFC`, border-color: `#94A3B8`, transform: `scale(1.2)`

### Cards & Containers

#### Default Card
- **Background:** `#FFFFFF`
- **Text Color:** `#1E293B`
- **Border:** 1px solid `#E2E8F0` (`{colors.hairline}`)
- **Border Radius:** `{rounded.md}` (`20px`)
- **Padding:** `{spacing.xl}` (`24px`) on all sides (measured as 29.75px, use measured value if possible)
- **Box Shadow:** `rgba(0, 0, 0, 0.05) 0px 1px 2px 0px` (base)
- **Font:** Sarabun, 17.85px, weight 400, line-height 1.6
- **Width:** ~395.25px (in two-column grid)
- **Height:** ~404.55px
- **Hover State:** Box shadow becomes `var(--shadow-elevated)`, border-color becomes `#3B82F6`, transform: `translateY(-2px)`, background: `#F8FAFC`

#### Card with Accent Background
- **Background:** `#F3E8FF` (`{colors.neutral-2}` — light purple for secondary product card)
- **All other properties:** As default card
- **Hover State:** Border becomes `rgb(216 180 254)`, box shadow elevated, transform: `translateY(-2px)`

### Inputs & Forms

#### Text Input (Focus)
- **Background:** `#FFFFFF`
- **Border:** 1px solid `#2563EB` (`{colors.accent-3}` — blue when focused)
- **Border Radius:** Not explicitly measured; infer from button radius precedent
- **Box Shadow:** `rgba(37, 99, 235, 0.15) 0px 0px 0px 3px` (focus ring)
- **Focus State:** Border becomes `#2563EB`, shadow adds 3px blue-tinted ring

### Navigation

#### Breadcrumb / Tab
- **Text Color:** `#2563EB` (`{colors.accent-3}` — primary blue for links)
- **Background:** transparent
- **Font:** Sarabun, size varies (observed as body-sm to body-xs)
- **Hover State:** Color may shift to `#1D4ED8`

#### Top Navigation Bar
- **Background:** `#FFFFFF`
- **Border:** 1px solid `#E2E8F0` (`{colors.hairline}` — subtle bottom divider)
- **Height:** Observed from logo and navigation alignment
- **Padding:** Implicit; logo and nav links centered

### Badges

#### Inline Badge (Pill-shaped label)
- **Background:** Light tint (e.g., `#DBEAFE` for blue context)
- **Text Color:** Primary color (e.g., `#2563EB`)
- **Border:** 1px solid `#BFDBFE`
- **Border Radius:** `{rounded.xs}` (`8.5px`) or higher (observed as ~12px in context)
- **Padding:** `{spacing.xs}` (`6.375px`) horizontal, tighter vertical
- **Font:** Sarabun, 12.75px, weight 500–700
- **Hover State:** Background deepens, border becomes `#2563EB`, background becomes `#F8FAFC`

### Checkmarks & Icons

#### List Item Checkmark
- **Text Color:** `#2563EB` (`{colors.accent-3}`)
- **Font:** Sarabun, 12.75px, weight varies
- **Styling:** Rendered as Unicode checkmark (✓) in blue, no background required

## 5. Layout Principles

### Spacing System

**Base Unit:** 4px (`{spacing.xxs}`)

**Full Scale:**
- `{spacing.xxs}` = 4px — micro-spacing between closely related elements
- `{spacing.xs}` = 8px — small gap between adjacent items
- `{spacing.sm}` = 12px — default button padding, tight card gutters
- `{spacing.md}` = 16px — standard horizontal padding, paragraph margins
- `{spacing.lg}` = 20px — heading-to-body spacing
- `{spacing.xl}` = 24px — card content padding, section boundaries
- `{spacing.xxl}` = 28px — larger section gaps
- `{spacing.xxxl}` = 36px — prominent vertical breathing room
- `{spacing.section}` = 44px — major section separation
- `{spacing.band}` = 48px — full-width section vertical padding

**Usage Context:**
- Button internal padding: `{spacing.sm}` vertical × `{spacing.md}` horizontal
- Card padding: `{spacing.xl}` on all sides
- Section top/bottom padding: `{spacing.band}` (48px)
- Body paragraph margins: `{spacing.lg}` (20px) bottom

### Grid & Container

- **Max Width:** Not capped; measured viewport columns range from 375px to 1440px without scroll constraint, indicating full-viewport layouts
- **Column Strategy:** Two-column grid layout for cards at desktop (1024px+), single column at mobile (375px–768px)
- **Card Dimensions:** ~395px wide in two-column context; scales to ~100% at mobile
- **Horizontal Padding:** Consistent `{spacing.md}` (16px) or minimal padding on smaller viewports; grows with breakpoints
- **Gutters:** Implicit spacing between cards; no explicit column gap measured; infer from visual proximity (~20–24px)

### Whitespace Philosophy

The design embraces generous whitespace to create visual breathing room and reduce cognitive load. The canvas background (`{colors.canvas}` — `#F8FAFC`) acts as an active design element, not passive emptiness. Vertical rhythm is maintained through consistent spacing scales, with section separators relying on margin and color shifts rather than borders. Cards float on the canvas with minimal shadow, allowing the background to breathe around them. Paragraph line-height ratios (1.5–1.6 for body text) support comfortable reading, especially for multilingual content.

### Border Radius Scale

- `{rounded.xs}` = 8.5px — buttons, icon buttons, small interactive elements, badges
- `{rounded.sm}` = 12.75px — subtle rounding on secondary components (observed in some UI elements)
- `{rounded.md}` = 20px — cards, containers, and major content blocks; warmer, more rounded feel than buttons

**Component Mapping:**
- Buttons: `{rounded.xs}` (8.5px)
- Cards: `{rounded.md}` (20px)
- Secondary UI: `{rounded.sm}` (12.75px)

### Border Widths

- **Thin:** 1px — default border weight for cards, inputs, buttons, and hairline dividers
  - Used on: card borders, input borders, outline button borders
  - Color: `#E2E8F0` (`{colors.hairline}`) for default; `#2563EB` (`{colors.accent-3}`) when focused/active

## 6. Depth & Elevation

| Level | Treatment | Use |
|---|---|---|
| Flat | No shadow | Cards at rest; text overlays; disabled states |
| Micro | `rgba(0, 0, 0, 0.05) 0px 1px 2px 0px` | Cards in default state; subtle definition without lift |
| Elevated | `rgb(37, 99, 235) 0px 0px 0px 2px` (blue ring) | Card focus state; interactive highlight |
| Modal | `rgba(0, 0, 0, 0.1) 0px 20px 25px -5px, rgba(0, 0, 0, 0.1) 0px 8px 10px -6px` | Modal backdrop and layered overlays; substantial depth |
| Button Hover | `rgba(37, 99, 235, 0.35) 0px 4px 10px` | Primary button on hover; indicates lift and interaction |

**Shadow Philosophy:**

The elevation model employs **layered-micro** depth: the system avoids deep, aggressive shadows in favor of subtle, nearly transparent layers. Cards use the micro shadow (`1px 2px 0px` with 5% opacity) to barely distinguish themselves from the canvas. Interactive states (hover, focus) add color-based emphasis (blue rings, gradient fills) rather than shadow escalation. Modal overlays are the exception, using layered shadows with 10% opacity and varying blur radii to create genuine depth separation. This approach keeps the interface clean and uncluttered while maintaining visual hierarchy.

### Opacity Levels

- **Default / Full:** 1.0 (100%) — normal state for text, icons, and interactive elements
- **Hover / Interaction:** 1.0 — maintained; depth changes through shadow or background shift instead
- **Disabled State:** 0.4 (40%) — disabled buttons; visually de-emphasized and non-interactive
- **Alternative Disabled:** 0.5 (50%) — some disabled states; slight variation observed in interaction data
- **Overlay / Semi-transparent:** Inferred from gradient and rgba usage; specific opacity for overlays not explicitly extracted

### Z-index / Layering

**Stacking Scale:**
- **Base / Content:** z-index: 0 (default cards, body content)
- **Elevated Dropdown:** z-index: 10 (lightweight dropdowns, tooltips)
- **Higher Dropdown:** z-index: 30 (navigation dropdowns, secondary menus)
- **Topmost Layer:** z-index: 50 (modals, primary overlays, sticky headers if present)

**Layering Strategy:** The z-index scale is shallow (max 50), appropriate for a single-page application without complex modal stacking. Dropdowns layer above content but below modals. No sticky/fixed element z-index was measured; assume standard dropdown behavior unless otherwise specified.

## 7. Do's and Don'ts

### Do

- **Use the Sarabun font stack** for all text to maintain Thai–English bilingual clarity and establish brand consistency.
- **Apply generous whitespace** using the spacing scale; never crowd content. Rely on `{spacing.xl}` (24px) padding within cards and `{spacing.band}` (48px) between major sections.
- **Employ color blocking for depth** instead of heavy shadows. Subtle micro-shadows (`1px 2px` at 5% opacity) combined with background tints and borders create visual hierarchy.
- **Use `{colors.accent-3}` (`#2563EB`)** as the primary CTA color for all first-action buttons; reserve `#9333EA` (purple) for secondary or alternative pathways.
- **Maintain consistent border radius** by applying `{rounded.xs}` (8.5px) to buttons and `{rounded.md}` (20px) to cards; do not mix radius scales within the same component family.
- **Provide focus states** with blue ring overlays (`rgba(37, 99, 235, 0.15) 0px 0px 0px 3px`) on interactive elements for accessibility.
- **Scale cards responsively**: single column at mobile (375px–768px), two columns at desktop (1024px+); never force a grid that requires horizontal scroll.
- **Color the text hierarchy** from `{colors.ink}` (headings) → `{colors.body}` (body) → `{colors.muted}` (secondary) → `{colors.faint}` (tertiary); avoid using neutral-scale colors arbitrarily.
- **Apply button hover transforms** (`translateY(-1px)`) with shadow elevation (`rgba(37, 99, 235, 0.35) 0px 4px 10px`) to signal interactivity.
- **Use the hairline color** (`#E2E8F0`) for borders; it provides definition without visual weight and pairs naturally with the canvas background.

### Don't

- **Don't invent new colors.** Stick to the defined palette. The 15 extracted colors cover all needs; resist adding arbitrary shades.
- **Don't apply heavy shadows** to cards or standard UI elements. The micro-shadow (`rgba(0, 0, 0, 0.05) 0px 1px 2px 0px`) is the standard; reserve modal shadows for overlays only.
- **Don't override the Sarabun font** for body text or buttons. System fallbacks handle missing webfonts gracefully; do not substitute weights or families.
- **Don't crowd buttons** with padding tighter than `{spacing.sm}` (12.75px). Buttons must remain touch-friendly and scannable.
- **Don't use disabled states** (opacity: 0.4) for hover effects; reserve disabled styling for non-interactive elements only.
- **Don't mix border radius** values within a component family. All buttons use `{rounded.xs}` (8.5px); all cards use `{rounded.md}` (20px).
- **Don't scale the card grid** to three or more columns without explicit design validation. The two-column layout is the measured desktop standard.
- **Don't apply transform effects** (scale, rotate, skew) to text or buttons unless explicitly required for micro-interaction (e.g., hover lift on icon buttons).
- **Don't create new heading styles** beyond the two measured sizes: `{typography.heading-md}` (38.25px, display) and `{typography.heading-sm}` (21.25px, section).
- **Don't forget the negative tracking** on the hero heading (`{typography.heading-md}` — letter-spacing: −0.96px); this is a defining visual trait of the brand.

## 8. Responsive Behavior

### Breakpoints

| Breakpoint | Viewport Width | Content Width | Grid Columns | Heading (Hero) | Body Text | Section Padding X | Key Changes |
|---|---|---|---|---|---|---|---|
| Mobile | 375px | 375px | 1 | 32px | 18px | 0px | Single-column layout; minimal padding; compact navigation |
| Tablet | 768px | 768px | 1 | 38px | 18px | 0px | Slightly taller body text; still single column; header sizing aligns toward desktop |
| Desktop SM | 1024px | 1920px | 2 | 38.25px | 17px | 0px | Two-column grid; full hero heading size; standard body text |
| Desktop MD | 1280px | 1920px | 2 | 38.25px | 17px | 0px | No measured change; maintains desktop layout |
| Desktop LG | 1440px | 1920px | 2 | 38.25px | 17px | 0px | No measured change; maximum standard viewport |

**Breakpoint Transitions:**
- **375px → 768px:** Heading scales from 32px to 38px; body remains ~18px; layout stays single column.
- **768px → 1024px:** Major shift to two-column grid; heading reaches full 38.25px; body text standardizes to 17px; section padding remains minimal (0px on measured viewport edge).
- **1024px+:** No further meaningful changes; desktop layout holds stable through 1440px.

### Touch Targets

- **Minimum touch target:** 31.75px × 31.75px (icon buttons, measured from component data)
- **Primary button height:** ~54.05px (comfortable for thumb interaction)
- **Secondary button height:** ~31.75px (acceptable for dense UI; verify against WCAG AA on production)
- **Link / text touch area:** Implicit padding around inline links; recommend wrapping in `{spacing.xs}` (8px) margin for comfortable tapping on mobile
- **Spacing between targets:** No explicit data; assume `{spacing.sm}` (12px) minimum gap between adjacent interactive elements to avoid mis-taps

### Collapsing Strategy

- **Single → Two Column (1024px):** Cards shift from 100% width (375px–768px) to ~395px side-by-side in a two-column flex or grid. Gaps inferred to be ~20–24px (not explicitly measured).
- **Navigation:** No collapse point observed; nav links appear to be hidden or restructured below 1024px, but measurement data shows 0 visible links across all breakpoints, suggesting either a horizontal scroll or hidden nav state. No toggle button measured; assume nav is either sticky/scrollable or collapsed behind a button not captured in extraction.
- **Text Scaling:** Body text scales from ~18px (mobile) to 17px (desktop)—a slight compression, likely a rendering artifact. Headings scale more visibly (32px → 38.25px).
- **Hero Section:** Padding and text alignment likely center-justified on mobile, left-justified on desktop; no explicit measurements. Assume padding compresses from `{spacing.band}` (48px) on desktop to `{spacing.section}` (44px) or less on mobile.
- **Card Padding:** Card content padding (`{spacing.xl}` — 24px) appears consistent across breakpoints; the card width scales, not the padding.

## 9. Agent Prompt Guide

### Quick Color Reference

- **Primary CTA Button:** Blue Primary (`{colors.accent-3}` — `#2563EB`)
- **Secondary CTA Button:** Purple (inferred from visual; exact hex not extracted; see Known Gaps)
- **Card Background:** White (`rgb(255, 255, 255)`)
- **Page Background (Canvas):** Light Cool Gray (`{colors.canvas}` — `#F8FAFC`)
- **Heading Text:** Ink (`{colors.ink}` — `#0F172A`)
- **Body Text:** Body (`{colors.body}` — `#334155`)
- **Secondary Text:** Muted (`{colors.muted}` — `#475569`)
- **Disabled / Placeholder:** Faint (`{colors.faint}` — `#94A3B8`)
- **Card Border:** Hairline (`{colors.hairline}` — `#E2E8F0`)
- **Focus Ring:** Blue light with opacity (`rgba(37, 99, 235, 0.15)`)

### Iteration Guide

1. **Typography Foundation:** All text uses Sarabun font with weights 400 (body), 500–600 (labels), 700 (headings/buttons), and 800 (display). Never substitute fonts; use fallback stack if Sarabun unavailable.

2. **Color Blocking Over Shadows:** Depth comes from background color shifts, borders, and micro-shadows—not layered drop-shadows. A card at rest uses `1px 2px 0px rgba(0,0,0,0.05)`; hover adds a transform lift and possibly a blue focus ring, not a bigger shadow.

3. **Spacing from Scale:** All gaps, padding, and margins derive from the 4px base unit (spacing scale: 4, 8, 12, 16, 20, 24, 28, 36, 44, 48px). Never eyeball; always pick from this scale.

4. **Button Styling Clarity:** Primary buttons are filled blue (`#2563EB`) with white text, 54px height, 8.5px radius. Secondary buttons are outlined (`1px #E2E8F0`), transparent fill, 31.75px height, same radius. Disabled state: opacity 0.4, no shadow, muted colors.

5. **Card Consistency:** All cards have 20px radius (`{rounded.md}`), 1px hairline border, 24px padding, 1px 2px micro-shadow, white background. Hover: add `translateY(-2px)`, blue border, light background shift.

6. **Responsive Grid:** Mobile = 1 column (100% width), Desktop (1024px+) = 2 columns (~395px each). No three-column layouts unless explicitly designed. Section padding-x = minimal/none on measured viewports.

7. **Text Hierarchy Lock:** Headings use `{colors.ink}` (#0F172A), body uses `{colors.body}` (#334155), secondary uses `{colors.muted}` (#475569), and faint metadata uses `{colors.faint}` (#94A3B8). Do not invent intermediate shades.

8. **Focus & Accessibility:** Interactive elements must have visible focus states: either a blue ring (`rgba(37, 99, 235, 0.15) 0px 0px 0px 3px`) or a border-color shift to `#2563EB`. Never remove outlines; ensure WCAG AA compliance on all CTAs.

9. **Hover Choreography:** Buttons lift by 1px (transform: translateY(-1px)) with shadow intensification. Cards shift background and border color without transform. Text links darken slightly. All transitions should be smooth (200–300ms) to feel responsive but not jarring.

10. **Bilingual Baseline:** Sarabun's metrics are consistent across Thai and Latin; maintain identical line-height and letter-spacing for both scripts. Test on Thai content to verify readability; line-height 1.5–1.6 is minimum for comfortable reading.

## 10. Known Gaps

- **No explicit semantic color palette:** The site does not declare error, success, warning, or info states in measured styles. Do not invent red/green/yellow statuses; add them only if the site's actual implementation data is provided.
- **Nine unassigned accent colors:** `{colors.accent-1}` through `{colors.accent-7}` (excluding primary blues) have no measured role. They are decorative or reserved for future expansion. Do not repurpose them as status colors or secondary themes.
- **Interaction states partially captured:** Hover, focus, and disabled states are documented, but active/selected/loading states were not observed in the extraction. Implement active states as a subtle variation (darker background or border shift) but verify with live design if critical.
- **No dark mode data:** The extraction captured light-mode only. If dark mode is required, it was not measured from the site and must be designed separately.
- **Navigation behavior unclear:** Measured breakpoints show 0 visible nav links across all viewports. The site may have a hamburger menu or horizontal scroll, but the toggle mechanism and collapsed nav styles were not captured. Refer to the live site for mobile nav implementation.
- **Purple secondary button hex not extracted:** The second product card shows a purple CTA visually, but its exact color hex was not measured. Infer from nearby elements or confirm with design; consider using a purple from the Tailwind palette (e.g., `#A78BFA`, `#9333EA`) pending confirmation.
- **Section gradient colors not hex-mapped:** Gradients use `linear-gradient(to right, rgb(37, 99, 235), rgb(79, 70, 229))` et al. (RGB notation); convert to hex if needed, but verify exact end-colors in production.
- **Responsive padding-x variation minimal:** Section padding-x was measured as 0px on multiple viewports; this may reflect how the site was captured (full-screen simulator). Adjust as needed for production; typical responsive patterns would scale padding from 16–24px on mobile to 32–48px on desktop.
- **Button width not specified:** Primary buttons measured ~333.75px in card context (constrained by card width). No explicit width rule exists; buttons likely use 100% width in container. Verify that button scaling does not break on ultra-wide displays.
- **Line-height computed from measured px:** All line-height values are ratios (1.11–1.6); if you need pixel values, multiply by font-size (e.g., 38.25px × 1.11 = 42.5px line-height).
- **No animation/transition specs:** Hover transforms and shadow shifts are documented, but animation duration, easing, and timing functions were not extracted. Assume 200–300ms ease-out for standard interactions unless specified elsewhere.
- **Surfaces behind authentication not visited:** Only the public landing page was analyzed. Sign-in flows, dashboard, or authenticated user interfaces may differ; extract those surfaces separately if needed.

---

# Token Reference

This document refers to the following design tokens. All values are deterministic and extracted from the live site:

**Colors:**
- `{colors.accent-1}` = `#1E293B` (decorative)
- `{colors.accent-2}` = `#64748B` (decorative)
- `{colors.accent-3}` = `#2563EB` (primary blue CTA)
- `{colors.accent-4}` = `#1D4ED8` (darker blue, hover state)
- `{colors.accent-5}` = `#BFDBFE` (light blue surface)
- `{colors.accent-6}` = `#DBEAFE` (lighter blue surface)
- `{colors.accent-7}` = `#E9D5FF` (light purple surface)
- `{colors.canvas}` = `#F8FAFC` (page background)
- `{colors.ink}` = `#0F172A` (primary text)
- `{colors.body}` = `#334155` (body text)
- `{colors.muted}` = `#475569` (secondary text)
- `{colors.faint}` = `#94A3B8` (tertiary text)
- `{colors.hairline}` = `#E2E8F0` (borders)
- `{colors.neutral-1}` = `#CBD5E1` (neutral border)
- `{colors.neutral-2}` = `#F3E8FF` (light purple surface)

**Typography:**
- `{typography.heading-md}` = 38.25px, weight 800, line-height 1.11, letter-spacing −0.96px (Sarabun)
- `{typography.heading-sm}` = 21.25px, weight 700, line-height 1.4, letter-spacing 0px (Sarabun)
- `{typography.body-md}` = 17px, weight 400, line-height 1.5, letter-spacing 0px (Sarabun)
- `{typography.button}` = 17.85px, weight 700, line-height 1.6, letter-spacing 0px (Sarabun)
- `{typography.body-sm}` = 14.875px, weight 400, line-height 1.43, letter-spacing 0px (Sarabun)
- `{typography.body-xs}` = 12.75px, weight 400, line-height 1.33, letter-spacing 0px (Sarabun)
- `{typography.body-xs-strong}` = 12.75px, weight 500, line-height 1.33, letter-spacing 0px (Sarabun)
- `{typography.body-xs-2}` = 12.75px, weight 600, line-height 1.33, letter-spacing 0px (Sarabun)
- `{typography.body-xs-3}` = 12.75px, weight 700, line-height 1.33, letter-spacing 0px (Sarabun)

**Spacing:**
- `{spacing.xxs}` = 4px
- `{spacing.xs}` = 8px
- `{spacing.sm}` = 12px
- `{spacing.md}` = 16px
- `{spacing.lg}` = 20px
- `{spacing.xl}` = 24px
- `{spacing.xxl}` = 28px
- `{spacing.xxxl}` = 36px
- `{spacing.section}` = 44px
- `{spacing.band}` = 48px

**Border Radius:**
- `{rounded.xs}` = 8.5px (buttons, small interactive elements)
- `{rounded.sm}` = 12.75px (secondary components)
- `{rounded.md}` = 20px (cards, containers)