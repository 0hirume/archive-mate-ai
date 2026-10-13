---
name: ArchiveMateAI
description: Open desk for broadcast archive research
colors:
    accent: "#285cc7"
    accent-foreground: "#ffffff"
    surface: "#f5f3ee"
    surface-raised: "#ffffff"
    surface-muted: "#f5f3ee"
    border: "#deddd6"
    foreground: "#252b2e"
    muted: "#666a6c"
    conversation: "#303c48"
    conversation-foreground: "#ffffff"
    danger: "#b42335"
    danger-foreground: "#ffffff"
    warning: "#875500"
    warning-foreground: "#ffffff"
    success: "#216b47"
    success-foreground: "#ffffff"
typography:
    title:
        fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Noto Sans, Arial, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji"
        fontSize: "1.25rem"
        fontWeight: 600
        lineHeight: 1.4
    body:
        fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Noto Sans, Arial, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji"
        fontSize: "1rem"
        fontWeight: 400
        lineHeight: 1.5
    label:
        fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Noto Sans, Arial, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji"
        fontSize: "0.875rem"
        fontWeight: 400
        lineHeight: 1.4285714286
rounded:
    selector: "0.25rem"
    field: "0.25rem"
    box: "0.5rem"
    none: "0px"
spacing:
    1: "0.25rem"
    2: "0.5rem"
    3: "0.75rem"
    4: "1rem"
    5: "1.25rem"
    6: "1.5rem"
components:
    search:
        backgroundColor: "{colors.accent}"
        textColor: "{colors.accent-foreground}"
        rounded: "{rounded.field}"
        padding: "0.5rem 1rem"
        height: "3rem"
    send:
        backgroundColor: "{colors.conversation}"
        textColor: "{colors.conversation-foreground}"
        rounded: "9999px"
        padding: "0.5rem 1rem"
        height: "3rem"
    action:
        backgroundColor: "{colors.surface-muted}"
        textColor: "{colors.foreground}"
        rounded: "{rounded.field}"
        padding: "0.5rem 1rem"
    quiet:
        backgroundColor: "transparent"
        textColor: "{colors.foreground}"
        rounded: "{rounded.field}"
        padding: "0.5rem 1rem"
    entry:
        backgroundColor: "{colors.surface-raised}"
        textColor: "{colors.foreground}"
        typography: "{typography.body}"
        rounded: "{rounded.field}"
        padding: "0.5rem 0.75rem"
        height: "3rem"
    footage:
        backgroundColor: "{colors.surface-raised}"
        textColor: "{colors.foreground}"
        rounded: "{rounded.none}"
        padding: "1.25rem 1rem"
    answer:
        backgroundColor: "{colors.surface-muted}"
        textColor: "{colors.foreground}"
        typography: "{typography.body}"
        rounded: "{rounded.field}"
        padding: "0.5rem 1rem"
    question:
        backgroundColor: "{colors.conversation}"
        textColor: "{colors.conversation-foreground}"
        typography: "{typography.body}"
        rounded: "{rounded.field}"
        padding: "0.5rem 1rem"
---

# Design System: ArchiveMateAI

## Overview

**Creative North Star: "Open desk"**

Open desk is a warm, light working environment: pale ground, white working surfaces, charcoal system typography, and a restrained blue action color. Plain geometry and comfortable spacing make source material easier to compare without turning research into a component showcase.

Conversation uses visible speaker labels, opposing message bubbles with relaxed leading, and a unified rounded composer. Prompt pills immediately above it fill a draft without sending: the current search text or a metadata research lead. Real catalog thumbnails supply the imagery; the interface does not manufacture visual evidence.

**Key Characteristics:**

- Warm neutral ground and white working surfaces.
- Compact system typography with quiet hierarchy.
- Spacious rows and restrained action color.
- Flat geometry and recognizable chat bubbles.

## Colors

The palette is warm and neutral, with one blue action accent and a dark slate conversational surface. Frontmatter values are normative; names below describe their use.

### Primary

- **Research Blue** (`accent`): direct Search, selected-source text, caret, and keyboard focus on buttons, links, and focusable regions. `accent-foreground` provides text on its solid fill.

### Neutral

- **Working White** (`surface-raised`): working surfaces. Solid action and conversation fills have their own paired foreground tokens.
- **Warm Ground** (`surface`, `surface-muted`): page background, assistant bubbles, preview fallback, and row hover.
- **Quiet Divider** (`border`): section borders, provenance dividers, and pane boundaries.
- **Charcoal Ink** (`foreground`): primary text. Supporting metadata uses `muted`.
- **Slate Conversation** (`conversation`): Send and user message bubbles, paired with `conversation-foreground`.

**The Action Color Rule.** Blue identifies action, focus, and selection; it is not a decorative surface wash. Selected rows use only the implemented 5% tint.

Error, warning, and success states use explicit `danger`, `warning`, and `success` tokens with corresponding foreground colors. They signal status rather than additional brand accents.

The sidebar offers a light/dark switch. Both palettes are defined in `frontend/style.css` with Tailwind theme tokens and dark overrides on `[data-theme="dark"]`. The selection is stored under `archive-mate-theme` and applied in the document head before painting; unavailable storage leaves a working visit-only selection.

## Typography

**Body and Title Font:** the platform system sans stack recorded in frontmatter. There is no separate display face, hero scale, or monospace identity.

**Character:** plain and readable. Size, weight, and spacing distinguish hierarchy without ornamental typography.

### Hierarchy

- **Title:** semibold section headings and source inspection titles; the frontmatter title role records the regular heading line height. Long source titles use snug leading (1.375).
- **Body:** search entry, composer, message text, and source descriptions. Footage titles use this size with semibold weight and snug leading.
- **Label:** filters, speaker labels, metadata, pagination, and help. Medium weight (500) emphasizes controls; buttons use semibold (600).
- **Numbers:** pagination, chapter timestamps, and message limits use tabular numerals.

**The Working Type Rule.** Use the existing title, body, and label hierarchy; do not promote system type into a decorative display treatment.

## Layout

The workspace uses the full viewport width, with horizontal gutters (16px, then 24px from 640px) and a main gap (24px). At 1024px a sticky left utility sidebar (224px, collapsed to 72px) sits beside a flexible research column and an optional right conversation pane (at least 320px, 40% of the desk). The conversation pane is sticky (24px from the top), with height `calc(100dvh - 48px)`.

Below 1024px, Ark Dialog provides the left drawer and full-viewport conversation sheet, with modal focus trapping, Escape dismissal, and focus restoration. Desktop panes remain non-modal; Archie can be hidden without losing the draft or messages. Categories use Ark Select with multiple selection and OR semantics, sorting uses single selection, and Ark DatePicker provides a range calendar beside typed ISO date fields that allow either endpoint to be blank. Filters use three columns from 640px, two beside the conversation pane, and three from 1280px. The page has an implemented minimum width (320px).

The spacing rhythm derives from the Tailwind quarter-rem unit. Working areas use padding (16px, then 24px); footage rows use vertical padding (20px), a gap (16px), and previews (104px wide, then 176px from 640px). Previews keep the source video ratio (16:9). Longer descriptions use the existing prose width (65ch).

## Elevation & Depth

Depth comes from warm ground, white surfaces, and quiet borders, not shadows. Fields, popups, and panes use explicit Tailwind tokens and flat borders. Focus outlines convey interaction, not elevation.

**The Flat Desk Rule.** Keep working surfaces flat; use tonal separation and dividers rather than ornamental lift.

## Shapes

Fields, previews, and ordinary buttons retain small field corners. Compact filter actions, prompt suggestions, and Send use full rounding; the unified composer uses a 1rem radius with a 0.75rem textarea radius. Metadata remains plain text rather than pills. Result rows and the mobile conversation sheet are square; message bubbles retain their directional tail and square lower speaker-side corner.

## Components

### Buttons

Restrained, text-led actions. Search uses blue; Send uses slate; pagination and source-opening actions use warm neutral fill. Ghost actions are transparent. Search and Send have minimum height (48px); most other actions have minimum height (44px). Button horizontal padding is normally (16px), with compact ghost actions (8px).

Solid actions use a 90% fill on hover; neutral actions use the divider color, and quiet actions use Warm Ground. Active buttons and links use 80% opacity. Keyboard focus uses a blue outline (2px) offset (2px). Disabled controls use 50% opacity and a not-allowed cursor. Reduced motion disables transitions and animation.

### Inputs / Fields

White fields have small corners and quiet divider borders. Search and composer use body-sized type; filters use label-sized type. Focus and caret use Research Blue. Typed publication dates accept YYYY-MM-DD, retain open-ended ranges, and report invalid or reversed dates before requests; the range calendar supplies keyboard date navigation through day, month, and year views. The composer grows from (48px) to (160px); disabled fields are visibly muted. Labels and help remain available to assistive technology.

### Navigation

A collapsible left utility sidebar carries Search, Overview, Sources, Setup, Archie visibility, and the light/dark switch. Blank rail space and passive branding toggle collapse; child controls act independently. Collapsed controls use Ark Tooltip on hover and keyboard focus. A compact mobile header opens the utility drawer or Archie; desktop has no duplicate header controls. Ark Dialog supplies modal dismissal and focus behavior. Pagination is a bordered, wrapping row of Previous and Next actions with a tabular page count. Keyboard access includes the revealed-on-focus skip link.

### Footage Rows / Containers

Results are quiet full-width rows, not individual elevated cards. Each pairs a real thumbnail or honest missing-preview fallback with title, channel, publication date, and duration. Hover uses Warm Ground; selection uses the subtle blue tint and explicit selected-source text. Row focus is inset (2px). Description, chapters, playlists, and metadata are visible sections distinguished by headings and spacing. The inspected title itself links to YouTube with a small inline external-link SVG, not a separate icon button. Playlist names, channel names when a channel identifier is available, and the canonical video URL link directly to YouTube with safe new-tab navigation. Video identifiers are not displayed as a separate field. Search explanations are not displayed; the API contract remains unchanged.

### Conversation

Assistant messages sit left on Warm Ground; questions sit right on Slate Conversation with white text and a maximum width (92%). Speaker labels remain visible and message text uses relaxed leading. Message history scrolls independently; the unified composer stays at the bottom. Contextual prompt pills use actual search text and only populate the draft. Suggested sources are separate quiet interactive rows; response scope remains visible. Failures expose retry/edit/direct-search actions without replacing the conversation with a form.

## Do's and Don'ts

### Do:

- **Do** use warm ground, white working surfaces, and quiet dividers.
- **Do** preserve visible keyboard focus, native field affordances, and reduced-motion behavior.
- **Do** distinguish conversation speakers with labels, alignment, and bubble color.
- **Do** keep real source imagery and honest missing-data states.

### Don't:

- **Don't** add ornamental shadows, gradients, or a separate display typography system.
- **Don't** turn every result into a rounded card or every action into a blue button.
- **Don't** present the chatbot as a separate search form.
- **Don't** imply that metadata or thumbnails verify the footage.

Source evidence: `frontend/style.css`, `frontend/index.html`, `frontend/application.tsx`, `frontend/dates.tsx`, `frontend/footage.tsx`, and `frontend/conversation.tsx`. Ark UI supplies headless interaction primitives; Tailwind and project tokens supply their visual treatment. This is a source-derived record, not visual or compiler signoff.
