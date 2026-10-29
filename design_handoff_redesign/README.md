# Handoff: OpenWeightModels redesign (Board, New comparison, Comparison)

## Overview
A visual redesign of every OpenWeightModels screen: **Board**, **New comparison** (empty + filled) and **Comparison** (reading, annotated, multi-turn). The current UI (`design_handoff_current/`) is dense — 12px mono body, 2px radii, 8px gaps — and hard to read. This redesign keeps **every feature and interaction** and changes only layout, typography, spacing and color. It follows the "Comparison v3 · Academy" reference: calm, roomy, chat-style responses, one accent, and **dark + light themes**.

**Do not remove or silently change functionality.** If a current feature is not visible in these files, keep it as it is and restyle it with the tokens below.

## About the design files
The files in `designs/` are **design references built in HTML**. They are working prototypes showing the intended look and behavior, not production code. Recreate them in the existing OpenWeightModels codebase (Next.js / React, per the capture script in `design_handoff_current/README.md`), using its components, routing, data fetching and state patterns. Do not ship the HTML.

- Every value is an inline style that reads from CSS variables. Use those variable names as the source of truth for tokens.
- Each file has a template (markup) plus a `class Component` logic block. Read the logic for exact state shapes, derived labels, and what each control does.
- To open a file locally, serve the `designs/` folder (e.g. `npx serve designs`) and open `Index.dc.html`. `support.js` is the small runtime the files need. The files load Google Fonts and Phosphor icons from a CDN, so they need a network connection.
- URL params: `?theme=dark|light`. Comparison also takes `?scenario=turns` and `?ann=1`. New comparison takes `?state=empty|filled`.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii and interactions are final. Recreate them as closely as possible using the codebase's existing primitives. Sample content (models, prompts, comments) is seed-style placeholder data. Wire it to the real API.

---

## Global rules (apply to every screen)
1. **Theme through tokens only.** Every color, radius and shadow is a CSS variable (`tokens.css`). Put the theme on the root as `data-theme="dark|light"`; also set it on `<html>` so the body background matches. Add any new value to **both** themes.
2. **Ramps are inverted in light mode.** The same step means the same role in both themes: 100 is the strongest ink and 900 the faintest fill. Use ramps by role:
   - 700–900: fills, borders, selected backgrounds
   - 500/400: muted text and meta
   - 100–300: text and emphasis
   In light mode, accent-colored **text** must use `accent-200/300` (never the base red) for contrast.
3. **One accent.** Only one solid accent fill per screen, on the primary CTA (header "New comparison", "Schedule comparison"). Every other action is **outlined** (1px `neutral-700`; hover → `accent-900` bg) or **ghost** (transparent; hover → `--color-surface`).
4. **Prefer whitespace over rules.** Use borders only for card outlines, the header bottom, and comment separators (`neutral-800`).
5. **Focus and selection:** `:focus-visible` is a 2px `--color-accent` outline with 2px offset; `::selection` is `accent-700`.
6. **Chat feel (Comparison and turn review):** the user prompt is a right-aligned tinted bubble. The model reply is full-width text with no bubble, with a small avatar and name above it. Actions (copy) sit quietly below.

## Design tokens
The full file is in `tokens.css`; copy it into the global stylesheet.

| Token | Dark | Light |
|---|---|---|
| `--color-bg` | #0a0c0b | #ffffff |
| `--color-surface` | #121513 | #f6f7f7 |
| `--color-text` | #e8ebe8 | #091a23 |
| `--color-accent` (=400) | #a3e635 lime | #dc382c red |
| accent 100→900 | #ecfccb #d9f99d #bef264 #a3e635 #84cc16 #65a30d #3f6212 #263c0f #17240b | #5c130d #a8241a #c42e22 #dc382c #e8574c #f08a82 #f6bdb8 #fbdcd9 #fdeeec |
| neutral 100→900 | #ececec #d4d6d4 #a9ada9 #858a86 #646966 #4a4f4c #2e3330 #1d211f #141715 | #091a23 #2d3b43 #4e5a61 #6b757b #8a9297 #b4babd #d9dddf #ebedee #f4f5f5 |
| `--code-bg` / `--code-fg` | #141715 / #d4d6d4 | #091a23 / #e6ebee |
| `--on-accent` | #0a0c0b | #ffffff |
| `--r` / `--r-lg` | 2px / 4px | 6px / 12px |
| `--r-bubble` | 10px 10px 2px 10px | 18px 18px 4px 18px |
| `--shadow-md` | 0 0 0 1px #2e3330, 0 8px 24px rgba(0,0,0,.5) | 0 0 0 1px #d9dddf, 0 8px 24px rgba(9,26,35,.08) |
| `--shadow-lg` | 0 0 0 1px #2e3330, 0 16px 40px rgba(0,0,0,.6) | 0 0 0 1px #d9dddf, 0 16px 40px rgba(9,26,35,.12) |

`color-scheme` is set per theme so native controls (scrollbars, file input) match.

### Typography
- **Heading:** Space Grotesk 500
  - H1: 30px / 1.15, −0.02em
  - H2 and Discussion title: 20px, −0.01em
  - Section titles (New comparison steps): 18px
  - Card titles (Board): 17px / 1.35, −0.01em
  - Logo: 14px
- **Body:** Geist 400/500/600
  - Base 14.5px / 1.55; response paragraphs 14.5px / 1.7
  - Secondary text 13–13.5px
  - Meta 12–12.5px
- **Micro-labels:** Geist 500, 10.5–11px, letter-spacing 0.08em, uppercase, `neutral-400`. Examples: "CATEGORIES", "SELECTED", "TURN 1", "ON THE BOARD".
- **Mono:** Space Mono
  - Code blocks: 12px / 1.65
  - Model and user initials badges: 9–11px
  - Keyboard hint `/`: 11px
- These replace the current site set (Space Grotesk / JetBrains Mono at 12.5 / 12 / 11px). Self-host Geist and Space Mono next to the existing fonts.

### Spacing & sizing
- Spacing scale in use: 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48px.
- Control heights:
  - Primary/outlined buttons: 32px
  - Large inputs and primary submit: 40–42px
  - Segmented controls: 28–30px inner buttons with a 3px padded track (`--color-surface` bg, 1px `neutral-800` border, radius `--r-lg`)
  - Chips: 22–32px
- Avatars and initials badges:
  - Header: 28px
  - Comments: 28px; replies and threads: 22px
  - Model avatar in replies: 24px
  - Card model badges: 20px
- **Effort glyph:** three bars 3px wide, 4/7/10px tall, 2px gap, 1px radius. Active bars are `--color-accent`; inactive bars are `neutral-700`. Low = 1 bar, Med = 2, High = 3.

### Icons
Phosphor Icons, regular and fill weights (`@phosphor-icons/web@2.1.1`; use the React package in the codebase). Icons used:
magnifying-glass, plus, bell, arrow-left, lightning, fire, clock, check, x, caret-down/up/left/right, chat-circle, highlighter, check-circle, git-diff, link, copy, circle-notch (spinner), bug, ghost, thumbs-up, question, stack, arrow-fat-up (regular and fill), arrow-bend-up-left, flag (regular and fill), dots-three, trash, paper-plane-right, paper-plane-tilt, upload-simple, pencil-simple, file-text, info, download-simple, arrow-up-right.

### Animations
- `pop`: 150ms ease-out, opacity 0→1 and translateY(−4px)→0. Used for menus and popovers (120ms for small ones).
- `spin`: 1s linear infinite. Used for spinners.
- `shimmer`: 1.2s infinite, opacity .5↔1, staggered 0.15s. Used for skeleton bars.
- `owmTick`: 70s linear infinite, translateX 0→−50%. Used for the live ticker (render the item list twice).
- `owmPulse`: 2s ease-in-out, opacity 1↔.35. Used for the LIVE dot.

---

## Shared header (all screens)
- Sticky (`top:0`, z 20), 53px tall including 10px vertical padding, 24px side padding, bottom border 1px `neutral-800`, bg `--color-bg`. Gap is 20–24px.
- **Logo:** a 22px square with a 1.5px accent border and a 1.5×10px accent bar centered inside, then "OpenWeightModels" in the heading font at 14px. Links to the Board.
- **Board only:** a search field (flex 1, min 120px, max 440px, 34px tall, `--color-surface` bg, 1px `neutral-800` border).
  - Contents: magnifier icon, input with placeholder "Search prompts or models", and a `/` key hint (Space Mono 11px, 1px `neutral-700` border).
  - Pressing **`/`** focuses the input; **Esc** clears it and blurs.
- **Comparison and New comparison:** a "← Board" ghost link (13px, `neutral-400`; hover → text color) instead of search.
- **Right side, gap 12px:**
  - **New comparison** primary button: accent bg, `--on-accent` text, 32px tall, 14px horizontal padding, 13px/500, `nowrap`; hover → `accent-300`. Hidden on the New comparison page.
  - Notifications: 32px ghost icon button. When there are unread notifications, show a badge: 15px tall pill, accent bg, `--on-accent` text, 10px/600, positioned top-right.
  - Account: 28px square `neutral-700` button with mono initials.
  - Keep the existing popovers for notifications and account; restyle them as a `--color-bg` card with radius `--r-lg`, `--shadow-lg`, and the `pop` animation.

## Shared footer
- 24px padding, top border `neutral-800`, 12px `neutral-400` text.
- Left: "OpenWeightModels", then Terms and Privacy links in `neutral-300`.
- Right: "Community comparisons of open-weight and frontier model outputs."

---

## Screen 1 — Board (`designs/Board.dc.html`)
**Purpose:** browse, search, filter and sort community comparisons.

**Live ticker** (below the header; can be switched off):
- 38px row, 24px side padding, bottom border `neutral-800`, 12px `neutral-300` text.
- Left: "LIVE" label (11px/500, 0.08em, `accent-300`) with a 6px pulsing accent dot.
- Then a horizontally scrolling list of events with Phosphor icons, gap 36px, and a mask that fades both edges.

**Layout:**
- Grid `clamp(200px, 22vw, 248px) | minmax(0,1fr)`, max-width 1440px, centered.
- **Sidebar:** sticky at `top:91px` (header + ticker) with `max-height: calc(100vh - 91px)` and its own thin scrollbar (`scrollbar-width: thin`). Padding 36px 16px 40px 24px; sections 32px apart.
  - **CATEGORIES:** list buttons, 34px tall, 10px padding, 13.5px text, count on the right at 12px.
    - Active: `neutral-800` bg, text color, count in `accent-300`.
    - Inactive: transparent bg, `neutral-300` text.
    - Hover: `--color-surface`.
  - **MODELS:** a "Clear" ghost link appears in the label row when models are selected. Rows are 32px tall with a 15px checkbox:
    - Unchecked: 1px `neutral-600` border.
    - Checked: accent fill, accent border, `--on-accent` check icon.
    - Then the model name (ellipsis) and count on the right.
    - Name color: `neutral-300` when the model has comparisons, `neutral-500` when its count is 0.
    - **By default only models with ≥1 comparison are listed.** A ghost toggle "All N models ▾" / "Show fewer ▴" reveals all of them. This is a change from the current UI, which lists every model, and cuts sidebar noise.
  - **EFFORT:** a 3-column grid of 32px outlined toggles (Low / Med / High), multi-select.
    - Active: `accent-900` bg, `accent-600` border, `accent-200` text.
- **Main:** padding 36px 32px 72px; vertical gap 24px.
  - **Title row:** H1 "Board" with a count line beneath it (13px `neutral-300`; aria-live polite).
    - Count reads "16 comparisons", or "N of 16 comparisons" when filtered.
    - Right side: Sort segmented control **Live / Top / New** with icons lightning / fire / clock.
  - **Active-filter chips row** (only when any filter is set):
    - One removable outlined chip (26px) per filter: search query in quotes, category, each model, each effort ("Med effort").
    - Then a "Clear all" ghost button.
  - **Card grid:** `repeat(auto-fill, minmax(min(320px,100%), 1fr))`, gap 16px.
  - **Empty state:** dashed 1px `neutral-700` box, 72px padding, centered.
    - Title "No comparisons match" (heading font, 20px).
    - Body "Try a different search or loosen the filters."
    - Outlined "Clear filters" button.

**Board card** (the whole card is a link to the comparison):
- `--color-surface` bg, 1px `neutral-800` border, radius `--r-lg`, padding 20px 20px 18px, vertical gap 18px.
- Hover: border `neutral-700`, bg `neutral-900`.
- **Top meta row** (12px, `neutral-300`):
  - Category chip (22px, `neutral-800` bg, `neutral-200` text)
  - Effort glyph + "Med effort"
  - Spacer
  - "1 turn" (nowrap)
- **Title:** the prompt in heading font, 17px, clamped to 2 lines.
- **Response previews, stacked** (the approved default):
  - **Base row:** 20px accent-800 initials badge, model name, then a **BASE** tag (9px/600, 0.08em, `accent-200` text, 1px `accent-700` border).
  - **Challenger row:** 20px `neutral-700` badge, model name, and "+N more" (12px `neutral-400`, nowrap) when there are extra challengers.
  - Each row has a preview of 13.5px / 1.6 `neutral-300` text clamped to 2 lines.
  - A side-by-side variant exists as a prop but was **not** chosen.
- **Footer row:** top border `neutral-800`, 14px padding-top, 12.5px.
  - Left: 20px user initials badge, @handle, "·", relative time.
  - Right: comment count (chat-circle icon) and annotation count (highlighter icon).
- Keep the existing `data-card-*` attributes.

**Behavior:**
- Search matches prompt text and model names.
- Category filter is single-select ("All" resets it). Models and effort are multi-select.
- A comparison matches the model filter if its base or any challenger is selected.
- Sort:
  - **Live:** the feed's default order.
  - **Top:** comments + annotations, descending (use the real ranking from the API).
  - **New:** newest first.
- All filter state should map to URL query params in production.

## Screen 2 — New comparison (`designs/New Comparison.dc.html`)
**Purpose:** create a comparison from an uploaded conversation or a written prompt, pick challengers, add details, and schedule it.

**Layout:**
- Wrapping flex container, max-width 1200px, padding 40px 32px 80px, gap 40/48px.
- **Form** (flex `999 1 520px`): vertical gap 24px.
- **Aside** (flex `1 1 280px`, max 360px): sticky at `top:93px`; drops under the form on narrow viewports.
- **Intro:** H1 "New comparison", then a 14.5px `neutral-300` subtitle, max 600px: "Upload a conversation or write one prompt, then pick who to compare it against. We'll send every turn to each model's hosted API."
- **Step cards:** three `<section>` cards with `--color-bg` bg, 1px `neutral-700` border, radius `--r-lg`, padding 24px, gap 20px.
  - Each header has a 26px step marker: a number on `neutral-800`, which changes to a check on `accent-800` / `accent-100` when the step is complete. Then the title (heading font, 18px, nowrap).
  - **Completion rules:**
    - Step 1: file + generated-by + prompt (upload mode), or prompt + base model (write mode).
    - Step 2: ≥1 model selected.
    - Step 3: a title and ≥1 category.

**Step 1 — Base output**
- **Header right:** segmented control **Upload a conversation** (upload-simple icon) / **Write a prompt** (pencil-simple icon).
- **Upload mode, no file yet:**
  - **Dropzone:** a full-width button with a 1.5px dashed `neutral-600` border, radius `--r-lg`, `--color-surface` bg, 40px padding, centered.
    - Content: upload icon (26px), "Drop a .md file, or **browse**" (15px/500; "browse" in `accent-300`), and helper text: "AI Exporter, front-matter `prompt:` and plain markdown are read automatically".
    - While dragging: accent border, `accent-900` bg.
    - Click opens the hidden `<input type=file accept=".md,.markdown,.txt">`.
  - **"How to get this file"** panel: `--color-surface`, radius `--r-lg`, padding 20px 22px.
    - Info icon + title, then a numbered list with 20px number badges:
      1. Install AI Exporter from the Chrome Web Store (external link) in Chrome, Edge or another Chromium browser.
      2. Open the chat you want to compare, click the AI Exporter button and save the conversation as Markdown.
      3. Upload the `.md` file here, then check every turn before scheduling.
    - Links: "Download a sample export" and "Read the export guide". In the prototype, "Download a sample export" loads the sample into the form for demo purposes; in production it downloads `/samples/deepseek-export.md`.
- **Upload mode, with a file:**
  - **File row:** `--color-surface`, 1px `neutral-800` border, radius `--r-lg`, padding 14px 16px.
    - 36px file-text tile (`accent-900` bg / `accent-200` icon).
    - Filename (14.5px/500) with "0.8 KB · 35 lines · 1 turn" underneath.
    - Outlined **Replace** button.
  - **Two-column field grid** (`auto-fit, minmax(240px,1fr)`, gap 16px):
    - **Generated by:** a custom listbox button, 40px tall, showing the model's initials badge, name and caret. Open state: accent border.
      - The menu is grouped as OPEN WEIGHTS · CURRENT / OPEN WEIGHTS · PREVIOUS / FRONTIER API · CURRENT / FRONTIER API · PREVIOUS.
      - Previous models are suffixed "(previous)". The selected option has a `neutral-800` bg and an accent check.
      - A native `<select>` with these optgroups is also acceptable if it is styled with the tokens.
    - **Prompt · from front-matter:** textarea, 2 rows, `maxlength=10000`, prefilled from the file's front-matter.
  - **"Check every turn before scheduling"** label with the turn count on the right. Each imported turn (up to 6) is a `--color-surface` card containing:
    - "TURN n" micro-label
    - The user prompt as a right-aligned bubble (`neutral-800`, `--r-bubble`)
    - "Reply" label with the reply clamped to 3 lines
- **Write mode:**
  - **Base model** listbox (same component as "Generated by"; the base response is generated).
  - **Prompt** textarea: 5 rows, placeholder "Write the prompt every model will answer…", with a "N / 10,000" counter.
- **Estimate** (shown once there is a base and ≥1 model):
  - "1 turn × 3 models = 3 calls · ~14 input tokens per model" (13px `neutral-300`).
  - "Limits: Up to 6 turns · 0.5 MB file · 100,000 characters" (`neutral-400`).

**Step 2 — Compare against**
- **Header right:** "3 of 4 selected" (**max 4**).
- **Controls row:**
  - Search input: 40px, magnifier icon, placeholder "Search by name, family or slug…", with a visually hidden label "Search models".
  - Weights segmented control: **All / Open weights / Frontier API**.
- **SELECTED** chips: 32px, `accent-900` bg, `accent-700` border. Each shows an initials badge, the name and an ×; clicking removes the model.
- **Model sections:** "OPEN WEIGHTS", "FRONTIER API", plus "… · PREVIOUS RELEASES" sections when expanded.
  - Grid `auto-fill, minmax(230px,1fr)`, gap 8px.
  - **Model card:** a button 56px+ tall, padding 10px 12px, 1px `neutral-700` border, radius `--r`.
    - Content: 28px initials tile, then the name (14px/500) with "Open weights · ~6s" under it (12px `neutral-400`), and an 18px round check on the right.
    - **Selected:** `accent-900` bg, `accent-600` border, accent-filled check, `accent-800` tile.
    - **At the max of 4:** unselected cards are disabled (opacity .45, `not-allowed` cursor).
- "No models match “q”." shows when the search hides everything.
- Ghost toggle "Show previous releases (14) ▾" / "Hide previous releases ▴".

**Step 3 — Details**
- **Title:** input 42px tall, `maxlength=200`, placeholder "What's being compared?", with a "N / 200" counter.
  - Auto-filled from the prompt until the user edits it (`titleTouched`).
- **Categories:** multi-select toggle chips, 32px: Coding, Reasoning, Creative, Math, Long-context, Language.
  - Active: `accent-900` bg, `accent-600` border, `accent-200` text.
- **Effort level:** 3-column cards. Each shows the effort glyph and label (14px/500) with a description underneath (12.5px `neutral-400`):
  - Low — Quick prompt
  - Med — Multi-step
  - High — Hard / long

**Submit row**
- **Schedule comparison** primary button: 42px tall, 20px padding, paper-plane-tilt icon.
- To its right, a hint (13px `neutral-400`).
- **Disabled state:** `neutral-800` bg, `neutral-400` text, `not-allowed` cursor. The hint explains what's missing:
  - "Upload a base output to continue"
  - "Select which model generated the base output"
  - "Add the prompt to continue"
  - "Write a prompt to continue"
  - "Pick a base model to continue"
  - "Pick at least one model to compare against"
- **Ready state:** the hint reads "3 hosted API calls · ~10s". This is turns × models (+1 in write mode, for the generated base) and the slowest selected model's ETA.
- **Submitting state:** spinner + "Scheduling…", then navigate to the new comparison.

**Aside — "ON THE BOARD" live preview**
- The exact Board card component, fed from the form:
  - Category: the first selected category, or a muted "Category" placeholder.
  - Effort and turn count.
  - Title, or a muted "Your title appears here".
  - Base model badge and name (or "– Base model"), with the base reply excerpt (or "Base output preview").
  - First challenger (or "– Compare to…") with "+N more"; its preview text is the muted italic "Generated after scheduling".
- Footer: @mira · "Draft", with a 6px `neutral-500` dot.
- Caption below the card: "Live preview of the card other people will see."

## Screen 3 — Comparison (`designs/Comparison.dc.html`)
**Purpose:** read the base response beside a switchable challenger, annotate text, and discuss.

**Layout:** main max-width 1280px, padding 36px 32px 72px, vertical gap 20px.

**Page head:**
- **Meta row** (13px `neutral-400`):
  - Category chips (22px, `neutral-800` bg)
  - Effort glyph + "Med effort"
  - "·"
  - 18px author initials badge, @handle (`neutral-200`), "· 7m ago"
- **H1:** the comparison title (max 900px, `text-wrap: pretty`).
- **Actions** (right-aligned on the same row; wrap under on narrow screens):
  - **Annotations** toggle (outlined, highlighter icon, count pill). When on: accent border, `accent-900` bg, `accent-200` text.
  - **Copy link** ghost button. After clicking it shows "Copied" with a check icon for 1.5s.
- **When annotations are on**, a row appears:
  - Kind filter segmented control **All / Bug / Hallucination / Good / Question**, with icons stack / bug / ghost / thumbs-up / question and a per-kind count.
  - Hint: "Select any text in a response to annotate it".
- **Multi-turn only — turn rail:** a `--color-surface` bar (1px `neutral-800` border, radius `--r-lg`).
  - Left: ‹ / › ghost buttons (disabled at the ends, opacity .35) around "Turn 1 of 2".
  - Right: "Jump to" with a segmented control (Turn 1, Turn 2, …).
  - Clicking smooth-scrolls so the turn sits under the sticky headers (offset 53 + 48 + 8px).
  - The current turn follows the scroll position: it is the last turn whose top is above 200px.

**Response grid:**
- CSS grid `repeat(2, minmax(0,1fr))`, column gap 16px, row gap 0, `position: relative` (popovers are positioned against it).
- It renders as **two continuous cards**: a header row, then **one grid row per turn**, so turn N starts at the same height in both columns. The last row is a 16px footer that closes each card's bottom border and radius.
- Card cells: `--color-bg`, 1px `neutral-700` left/right borders.
- **Card headers:** sticky at `top:53px`, 48px tall, `--color-surface` bg, 1px `neutral-700` border, top corners `--r-lg`.
  - **Left (z 14):** BASE tag, model name (14.5px/500, ellipsis), and on the right the meta "197 tok" (12px `neutral-400`).
  - **Right (z 15):** the **model picker** button (32px, outlined; open state: accent border and `accent-900` bg) showing the active model name, a spinner while generating, and a caret. Then "3 responses", then the active model's meta ("133 tok · 4.2s") on the right.
  - The right header's z-index keeps its menu above the left header.
- **Model picker menu:** absolute, 290px wide, `--shadow-lg`, `pop` animation.
  - **RESPONSES:** existing responses. Each row is 36px with an initials tile and name; the active row has a `neutral-800` bg and an accent check; generating rows show a spinner. Clicking switches the right column and closes the menu.
  - **ADD A MODEL** (hidden when none are left): rows show "+", the model name and an ETA, e.g. Gemma 4 31B ~6s, Phi 4 ~4s, Kimi K3 ~20s. This replaces the current "+ Add model" tab.
    - Clicking adds the model, selects it, and sets it to generating. The production call is the model's hosted API; the prototype fakes it with a 3.6s timeout.
  - Footnote: "Runs the same prompt through the model's hosted API."
- **Turn cell** (padding 24px 24px 12px, gap 20px):
  - **Multi-turn only:** a "TURN n" micro-label with that turn's token meta on the right. Turns after the first get a 1px `neutral-800` top rule and 20px padding-top.
  - **Prompt bubble:** right-aligned, max-width 85%, padding 12px 16px, `neutral-800` bg, radius `--r-bubble`, 14.5px / 1.55.
  - **Reply:**
    - 24px model avatar with mono initials (base: `accent-800` / `accent-100`; others: `neutral-700` / `neutral-100`) and the model name (13px/500 `neutral-300`).
    - Content blocks, in order:
      - Paragraphs: 14.5px / 1.7, `neutral-100`; bold segments at 600.
      - List items: a bullet "•" or number "1." marker (16px wide, `neutral-400`) and text in the paragraph style.
      - Code blocks: `--code-bg` / `--code-fg`, Space Mono 12px / 1.65, padding 14px 16px, radius `--r`, horizontal scroll, **never wrap**.
      - Sources: a "Sources" micro-label and accent links with arrow-up-right icons.
    - Then a ghost **copy** icon button (28px). It copies that turn's reply and shows a check for 1.5s.
  - **Generating state** (right column), in place of the reply:
    - An `accent-200` line: spinner + "Calling <model> hosted API…"
    - Skeletons with the `shimmer` animation: bars 9px tall at 92% and 78% width, a 72px block, and a bar at 64%.
- **Narrow screens:** the prototype keeps two columns. In production, below ~800px either stack the columns or switch to a Base/Compare toggle, with headers staying sticky.

**Annotations**
- **Annotated spans** (when annotations are on and the span matches the kind filter):
  - Prose: `accent-900` bg, `inset 0 -1.5px 0 var(--color-accent)` underline, pointer cursor.
  - **Inside code blocks:** use a translucent accent background instead, `color-mix(in oklab, var(--color-accent) 30%, transparent)`, so `--code-fg` stays legible in light mode.
  - The span whose thread is open uses `accent-800` (code: 48% mix).
- **Select to annotate:** with annotations on, selecting text inside a single un-annotated text segment shows a floating **Annotate** button 38px above the selection: 30px tall, accent border, `--color-bg`, `accent-200` text, `--shadow-md`.
  - Use `mousedown` + `preventDefault` so the selection survives the click.
- **New-annotation popover:** 320px, placed 6px below the selection and clamped to the grid's width.
  - Content: "New annotation" title, quote, kind chips (Bug / Hallucination / Good / Question; selected = accent border, `accent-900` bg), a textarea with placeholder "What stands out here?", and an outlined **Add annotation** button.
  - Saving splits the text segment around the selection, creates the annotation, and opens its thread.
- **Thread popover:** 320px, below the clicked span.
  - Header: kind badge (icon + kind, `accent-700` border), "N people" (participant count), and a close button.
  - Quote: 2px accent left rule, Space Mono 11.5px, max 54px tall.
  - Messages: 22px avatar, author · time, body at 13.5px.
  - Footer: an upvote toggle (filled icon and `accent-900` bg when voted; +1), a reply input ("Reply…"; **Enter** sends), and an outlined send button.

**Discussion** (max-width 800px, padding-top 32px)
- **Title row:** H2 "Discussion" with the total count (comments + replies), and on the right a segmented filter: **All / <base model> / <each ready challenger> / General**, using full model names.
- **Composer card:** `--color-surface`, 1px `neutral-700` border, radius `--r-lg`, padding 14px.
  - Textarea (no border) with placeholder "Share what you noticed across the outputs…".
  - "About" chips: General + each model; selected = accent border, `accent-900` bg, `accent-200` text.
  - Outlined **Post** button. Posting prepends the comment and resets the filter to All.
- **Empty state:** "No comments yet. Be the first to share what you noticed."
- **Comment** (padding 20px 0, bottom border `neutral-800`):
  - 28px avatar.
  - Header: author (500, `neutral-100`), time, and an optional "on <model>" chip (22px, `neutral-800` bg).
  - **Own comments** get a "…" menu with **Delete**.
  - Body: 14.5px / 1.65.
  - Actions row: **upvote** toggle (arrow-fat-up; when voted, the filled icon in `accent-300` and the count +1), **Reply**, and **Report** for other people's comments (toggles to "Reported" with a filled flag).
    - Reply pre-fills the composer with "@handle ", sets About to the comment's model, and focuses the composer.
  - **Replies:** indented 16px with a 1px `neutral-700` left rule. Each has a 22px avatar, author · time, body at 14px, and its own upvote. Own replies get a delete (trash) button.

---

## Interactions summary (must all keep working)
- **Board:** search plus `/` and Esc shortcuts; category, model and effort filters; filter chips and clear; sort; show all models; card links; live ticker.
- **New comparison:**
  - Mode switch; drag-and-drop or browse upload (parse front-matter `prompt:`, turns ≤6); Replace.
  - Generated-by / base model picker; prompt edit.
  - Turn review; estimate; limits.
  - Model search, weights filter, select/deselect (max 4), selected chips, previous releases.
  - Title auto-fill, categories, effort.
  - Submit validation, disabled hints, submitting state.
  - Live preview.
- **Comparison:**
  - Annotations toggle, kind filter, select-to-annotate, new annotation, threads (vote, reply).
  - Model picker: switch response, add model, generating state.
  - Per-turn copy; copy link.
  - Turn rail (prev/next/jump plus scroll tracking).
  - Discussion: filter, About, post, vote, reply, report, delete own comment/reply.
  - Notifications badge.

## State (from the prototypes' logic classes)
- **Board:** `q`, `cat` ('All' | category), `models[]`, `efforts[]`, `sort` ('live' | 'top' | 'new'), `allModels` (boolean).
- **New comparison:**
  - `mode` ('upload' | 'write'), `file` ({name, size, lines, turns[{you, reply}]} | null), `gb` (base model id), `prompt`
  - `sel[]` (≤4), `q`, `weight` ('all' | 'open' | 'frontier'), `showPrev`
  - `title`, `titleTouched`, `cats[]`, `effort` (0–2)
  - `pickerOpen`, `drag`, `submitting`
- **Comparison:**
  - Data: `resp` (model → {name, mono, meta, turnMeta[], turns[][] of blocks; blocks carry segments with an optional annotation id}), `anns` (id → {kind, votes, thread[]}), `comments[]` ({id, by, ago, on, votes, t, replies[]})
  - Picker: `tabs[]` (challenger ids in order), `tab` (active), `gen` (model → generating)
  - Annotations: `annOn`, `kind`, `menuOpen`, `pop` (thread | new + position), `selBtn`
  - Drafts: `replyDraft`, `newDraft`, `newKind`, `draft`, `about`, `filter`
  - Votes and flags: `voted`, `cvoted`, `rvoted`, `reported`, `menuFor`
  - Feedback: `copied`, `linkCopied`, `curTurn`
- **Production:** fetch responses, annotations and comments from the API. "Add a model" calls the hosted endpoint and streams or polls until done. Votes, reports and posts are optimistic mutations. Theme preference: system default plus a user toggle, persisted.

## Files
- `designs/Index.dc.html`: links to every screen and state, in both themes.
- `designs/Board.dc.html`: Board. Props: `theme`, `previewLayout` (keep 'stacked'), `showTicker`.
- `designs/New Comparison.dc.html`: New comparison. Props: `theme`, `initialState` ('filled' | 'empty').
- `designs/Comparison.dc.html`: Comparison. Props: `theme`, `scenario` ('single' | 'multi-turn'), `annotationsOn`.
- `designs/support.js`: runtime needed to open the files.
- `tokens.css`: both themes' CSS variables, base resets and keyframes. Drop it into the global stylesheet.
- Original references: `design_handoff_current/` (the current UI, for feature parity) and `redesigned_reference/` (Comparison v3 Academy, the style source). Both are in the parent project.

## Suggested implementation order
1. Add `tokens.css`, the fonts, and a theme provider (`data-theme` on `<html>`).
2. Restyle shared primitives: header, buttons (primary / outlined / ghost), segmented control, chip, initials badge, effort glyph, popover.
3. Board: card, sidebar, filter chips.
4. Comparison: grid, sticky headers, picker, annotation layer, discussion, turn rail.
5. New comparison: step cards, dropzone, model grid, live preview using the Board card.
6. Check each screen in both themes against the prototypes, including light-mode accent text contrast and code-block annotations.
