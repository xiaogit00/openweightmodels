# Handoff: OpenWeightModels — community comparisons of open-weight model outputs

## Overview
OpenWeightModels is a forum-style web app where people compare the outputs of open-weight LLMs on community-submitted prompts, side by side.

Core features in this handoff:
1. **Board**: a live, dense grid of "comparison" cards with filters.
2. **Comparison view**: the uploaded base response pinned on the left and the other models' responses in tabs on the right. It also has an **annotations overlay** (highlighted spans with threaded comments) and a **discussion** section.
3. **New comparison**: upload a base `.md` file and name the model that generated it, pick the models to compare against, and add details. This schedules a backend **job** that calls each model's hosted API. The job shows live progress, and the comparison is ready when it finishes.

See `BACKEND.md` for the data model, API and job pipeline.

## About the design files
The files in `designs/` are **design references built in HTML**: prototypes that show the intended look and behaviour. They are not production code. Recreate them in the target codebase's environment. If none exists, the recommended stack is Next.js (App Router), React, TypeScript and Tailwind (or CSS variables), with Postgres and a job queue such as BullMQ/Redis or a hosted queue.

Each `.dc.html` file opens directly in a browser. It has a markup template with `{{ }}` holes and `<sc-for>`/`<sc-if>` blocks, plus a `class Component` logic block at the bottom that holds the mock data and state logic. Read the logic block to see the exact behaviour and the sample data. `support.js` is only the prototype runtime; do not port it.

## Fidelity
**High fidelity.** Colours, type, spacing, radii and interactions are final. Recreate them pixel-accurately. The `v2` files are the target. The tokens are the `:root` override at the top of each file's `<style>`, layered on `styles.css`.

---

## Design tokens (v2 — "flat neon")
**Colour**
- Background `--color-bg` #0a0c0b · Surface `--color-surface` #121513 · Text `--color-text` #e8ebe8
- Accent (lime) `--color-accent` #a3e635
- Accent ramp: 100 #ecfccb · 200 #d9f99d · 300 #bef264 · 400 #a3e635 · 500 #84cc16 · 600 #65a30d · 700 #3f6212 · 800 #263c0f · 900 #17240b
- Neutral ramp: 100 #ececec · 200 #d4d6d4 · 300 #a9ada9 · 400 #858a86 · 500 #646966 · 600 #4a4f4c · 700 #2e3330 · 800 #1d211f · 900 #141715

How the ramps are used:
- Tinted fills (selected or hover) use accent-900 or accent-800.
- Accent text sits on those tints: accent-200 or accent-300.
- Borders use neutral-700 or neutral-800. Muted text uses neutral-400 or neutral-500.

**Type**
- Body/UI: **JetBrains Mono** 400/500/600.
- Headings: **Space Grotesk** 500/600.
- Sizes are small and dense:
  - 9–10px: micro labels, uppercase with 0.06–0.08em tracking.
  - 10.5–11px: meta text and chips.
  - 12px: controls.
  - 12.5px: prose and response body, line-height 1.65.
  - Card titles: 12px Space Grotesk.
  - Page H1: 18–20px Space Grotesk 500, letter-spacing −0.015em.
- Code blocks: ui-monospace 11–12px, line-height 1.6.

**Shape and elevation**
- Radius **2px everywhere**, including avatars and dots. There are no pills or circles.
- Shadows only on floating layers: md `0 0 0 1px #2e3330, 0 8px 24px rgba(0,0,0,.5)` · lg `0 0 0 1px #2e3330, 0 16px 40px rgba(0,0,0,.6)`.
- Cards are flat: a surface fill with a 1px transparent border that turns accent on hover.

**Spacing**: a 4px base. Typical values are 6, 8, 10, 12, 14, 16 and 20px. Page gutters are 20px. The card grid gap is 8px.

**Icons**: Phosphor Icons, regular plus fill (`@phosphor-icons/web` 2.1.1).

**Buttons**
- Primary: solid accent fill, text `--color-bg`, weight 600, 32px high; hover background accent-300. Used for "New comparison", "Schedule comparison" and "Publish to board".
- Secondary: 1px border (accent or neutral-700) on a transparent background; hover background accent-900.
- Ghost: no border; hover background surface.
- Focus: `outline: 2px solid var(--color-accent); outline-offset: 2px`.

**Motion** (lively): see each screen. All transitions are 120–400ms ease-out.

---

## Screens

### 1. Board (`designs/Board v2.dc.html`)
**Purpose:** browse a live feed of comparisons, filter them, and open one.

**Layout**
- A sticky header with two rows:
  - Row 1 (52px, padding 10px 20px): logo · search (max 420px wide, 32px high, surface fill, "/" shortcut hint) · spacer · primary "New comparison" · bell icon button · 28px avatar.
  - Row 2 is the **live ticker** (30px): a "LIVE" label with a pulsing accent dot, then a horizontally scrolling marquee of activity events. The marquee is the event list duplicated, translating 0 → −50% over 45s, linear and infinite. It sits in an `overflow:hidden; flex:1` wrapper so it clips at the label.
- Body: a CSS grid of `216px | 1fr`.
  - **Sidebar** (sticky below the header, scrolls on its own, thin dark scrollbar):
    - CATEGORIES: single-select list with counts. Rows are 28px. The active row has a surface background and text colour.
    - MODELS: multi-select checkboxes with counts, plus a "Clear" link when any are selected.
    - EFFORT: a 3-way segmented control (Low/Med/High). Clicking the active option again clears it.
  - **Main**, from top to bottom:
    - A toolbar: sort tabs (Live ⚡ / Top 🔥 / New 🕒) · "N comparisons" · removable chips for the active filters · and, on the right, a "↑ N new comparisons" pill whenever arrivals are queued.
    - A card grid: `repeat(auto-fill, minmax(270px, 1fr))`, gap 8px. That gives 4 columns at 1440px.

**Card** (whole card is a link to the comparison; padding 11px 12px 10px; gap 9px)
1. Model row:
   - Base model chip: 1px accent-700 border, accent-200 text, 14px accent-800 monogram square (e.g. "L3").
   - Then "vs", then the first challenger chip (neutral-700 border), then "+N" for any extra models.
   - Chips are 20px high and truncate with an ellipsis; the challenger chip shrinks first.
2. Title: Space Grotesk 500 12px/1.3, clamped to 2 lines.
3. Preview: two equal columns separated by a 1px neutral-700 gap. Each cell has the bg colour, padding 6px 7px and 10.5px/1.4 neutral-300 text. Text is clamped to exactly 3 lines; the clamp goes on an inner element so padding doesn't reveal a 4th line.
4. Meta row: category chip (neutral-800 fill) · effort meter · effort label · spacer · 💬 comment count · highlighter annotation count. The effort meter is 3 bars, 3px wide and 5/7/10px tall, filled with accent up to the level and neutral-700 above it.
5. Author row: 14px avatar · @handle · relative time ("just now", "9m", "2h", "3d").

**Card states**
- Hover: border becomes accent, background neutral-800, `translateY(-2px)`, transitioning over 120ms.
- **New arrival:** the card fades and slides in from −8px at 98% scale with an accent-900 background, then settles to the surface colour over 1.4s.

**Behaviour**
- **Live** sort: new comparisons are inserted at the top with the arrival animation. The prototype simulates one every 4.2s; production should push them over WebSocket or SSE.
- **Top/New** sort: arrivals are queued, and the pill shows the count. Clicking the pill, or switching back to Live, flushes the queue to the top.
- Top sorts by `comments + 2 × annotations`. New sorts by creation time.
- Filters combine with AND across groups and OR within the model list (a card matches if it uses any selected model). Search matches the title or any model name, case-insensitive.
- Empty state: "No comparisons match" plus a "Clear filters" link.
- "Ago" times refresh every minute.

### 2. Comparison (`designs/Comparison v2.dc.html`)
**Purpose:** read the responses side by side, annotate them, discuss them, and add models.

**Layout** (main area max 1480px wide, padding 18px 20px)
1. Header block (max 860px wide):
   - A meta row: category chips · effort meter · author · time.
   - H1 (prompt title).
   - A "Prompt ▸" disclosure that expands into a surface box holding the full prompt text.
2. **Sticky toolbar** (top 53px, bottom border):
   - An "Annotations [count]" toggle. When on, it has an accent border, accent-900 background and accent-200 text.
   - When on, it also shows kind filter segments (All · Bug · Hallucination · Good · Question, each with an icon) and the hint "Select any text to annotate it".
   - On the right, a ghost "Copy link" button.
3. **Panes grid:** `repeat(auto-fit, minmax(380px, 1fr))`, gap 12px. That is two columns on desktop, stacked on narrow screens.
   - **Left, base pane:** a surface card. Its 42px header holds a "BASE" micro-label (accent-700 border), monogram, model name and meta (tokens · seconds).
   - **Right, challenger pane:** a horizontally scrollable tab bar. Tabs don't shrink and the scrollbar is hidden. Each tab has a monogram and name, and the active tab has a 2px accent underline. A "+ Add model" tab opens a menu (240px wide) titled "GENERATE ANOTHER RESPONSE" that lists models not yet run, each with an ETA. Picking one adds a tab with a spinner and a "Calling {model} hosted API…" shimmer skeleton; when generation completes, the response replaces it. Response meta sits at the top of the body.
   - Response body: padding 14px 16px. Paragraphs are 12.5px/1.65 neutral-100. Code blocks have the bg colour, 12px padding, a mono font, `white-space: pre` and horizontal scroll.
4. **Discussion** (max 860px wide):
   - Header: "Discussion · N", with filter segments on the right (All · Llama · each challenger · General).
   - Composer: a surface box with a textarea, an "About" chip row (General or a model), and a secondary "Post" button.
   - Comments: a 28px avatar · handle · time · an optional "on {Model}" chip · body text (13px/1.55) · ▲ vote (fills accent when voted) · Reply. Replies are indented 12px with a 1px left rule. Reply prefills "@handle " and sets "About" to that comment's model.

**Annotations overlay** (from option 3b in the wireframes)
- Off: plain text, nothing is clickable.
- On: each annotated span gets an accent-900 background plus an inset 1.5px accent underline (`box-shadow: inset 0 -1.5px 0 accent`) and a pointer cursor. The span whose thread is open turns accent-800. The kind filter hides highlights of other kinds.
- **Click a span** to open a popover (300px wide, neutral-800 background, lg shadow, a 150ms pop-in). It's anchored under the span and clamped inside the grid. It contains:
  - A kind tag with icon, "N people", and a close button.
  - The quoted text: mono 11.5px with a 2px accent left rule, max 3 lines.
  - The thread messages.
  - A footer: ▲ vote · "Reply…" input (Enter sends) · send icon button.
- **Select text** inside a single text run, while annotations are on, to show a floating "Annotate" button above the selection. It opens the popover in "new" mode: kind picker (Bug, Hallucination, Good, Question), a textarea, and an "Add annotation" button. Saving splits the run into before / annotated / after and opens the new thread. In production, store annotations as **character offsets into the response's canonical markdown** (see BACKEND.md), not DOM ranges.

### 3. New comparison (`designs/New Comparison v2.dc.html`)
**Purpose:** create a comparison and watch the job run.

**Layout:** grid `1fr | 300px`, gap 32px, max 1120px wide. The right column is a sticky **"ON THE BOARD" live card preview**: the same card as the Board, built from the form state. A status dot shows Draft, Generating x/y (pulsing) or Ready.

**Form phase.** Three numbered sections; each step badge turns accent with ✓ when its section is complete.
1. **Base output**
   - A dashed drop zone that accepts `.md`, `.markdown` and `.txt`. Drag-over highlights it with an accent border and accent-900 background. Also "browse" and "Use a sample file".
   - After upload: a file row (name, size, "Replace"), a **Generated by** select (its border is accent until a value is chosen), and a **Prompt** textarea auto-filled from the YAML front-matter key `prompt:`.
2. **Compare against**
   - A tile grid, `auto-fill minmax(190px, 1fr)`. Each tile has a monogram, name, "Hosted · ~Ns" and a checkbox.
   - Selected tiles get an accent border and accent-900 background.
   - The base model's tile is disabled and labelled "Base model". All tiles are disabled at **4 selected**. A counter reads "N of 4 selected".
3. **Details**
   - Title: auto-filled from the sample or the filename.
   - Category chips: multi-select.
   - Effort: a segmented control with sublabels. Low "Quick prompt", Med "Multi-step", High "Hard / long".

Submit: primary "Schedule comparison", disabled at 45% opacity until a file, a base model and at least one challenger are set. The helper text explains what's missing, or estimates the job: "N hosted API calls · ~Ns", using the slowest model's ETA.

**Job phase** (it replaces the form with a 250ms rise animation)
- Header: "JOB #id · SCHEDULED hh:mm", then the title.
- A 4-stage progress strip: Scheduled → Resolving models → Calling hosted APIs → Ready. Each stage has a 3px bar (accent when done, accent-700 when active) and an icon (✓, spinner or circle).
- A model list card: a base row ("Uploaded ✓"), then one row per model with a status and a 3px progress bar. Statuses:
  - `Queued` (clock icon)
  - `Calling API…` (spinner)
  - `Generating · N tok` (spinner; the bar follows token progress)
  - `Done · N tok · Ns` (✓)
  - `API timeout` (warning icon, with secondary **Retry** and neutral **Skip** buttons)
  - `Skipped`
- While running: "You can leave this page — we'll notify you when it's done."
- When everything is done or skipped, a ready banner appears: accent border, accent-900 background, "Your comparison is ready", "N responses generated…", a neutral **Review first** button (goes to the Comparison page) and a primary **Publish to board** button.
- Until it is published, the comparison is visible only to its author.

---

## State (per screen, summarised)
- **Board:** `items[]`, `pending[]` (queued arrivals), `cat`, `models[]`, `effort|null`, `sort: live|top|new`, `q`, `events[]` (ticker).
- **Comparison:** `responses{modelId → blocks}`, `annotations{id → {kind, responseId, start, end, votes, thread[]}}`, `tabs[]`, `activeTab`, `generating{modelId}`, `annOn`, `kindFilter`, `popover {mode: thread|new, anchor}`, `selection`, `comments[]`, `commentFilter`, `draft`, `about`.
- **New comparison:** `file`, `baseModel`, `prompt`, `picked[] (≤4)`, `title`, `cats[]`, `effort`, `phase: form|job`, `job {stages, runs[]}`.

## Files
- `designs/Board v2.dc.html`, `designs/Comparison v2.dc.html`, `designs/New Comparison v2.dc.html`: hi-fi targets. Open them in a browser; they link to each other.
- `designs/styles.css`: base stylesheet. The v2 files override its tokens.
- `designs/support.js`: prototype runtime only.
- `designs/Forum Compare Wireframes.dc.html`: the low-fi exploration. The chosen options are 5a (board), 2c (comparison), 3b (annotations), and 4b + 4c (new comparison).
- `BACKEND.md`: data model, REST/stream endpoints and job pipeline.

## Assets
There are no images. Icons are Phosphor (CDN). Fonts are JetBrains Mono and Space Grotesk (Google Fonts). Model "logos" are 2-letter monograms; swap in real provider marks if licensing allows.
