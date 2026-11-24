# Handoff: Weight classes on the Board and Comparison pages

## Overview
This is a delta on the previous handoff (`design_handoff_weight_class/README.md`). All of its global rules, tokens, the weight-class definitions, the 6-step size glyph and the New comparison flow still apply. This update makes three changes:

1. **Board sidebar:** the MODELS list is **grouped by weight class**. A header checkbox selects every model in a class.
2. **Board cards:** each model shows its **size glyph** next to its name. A **matchup line** under the prompt says whether the comparison is the same weight class or across weight classes.
3. **Comparison page:** each column header shows the model's **weight class and memory to run it**. So do the response switcher and the "Add a model" menu.

Everything else is unchanged.

## About the design files
The files in this bundle are **design references built in HTML**. They are prototypes that show the intended look and behaviour, not production code to copy. Recreate them in the target codebase using its existing component library, patterns and tokens. All values below are final.

## Fidelity
**High fidelity.** Colours, type, spacing and copy are final. Use the codebase's existing primitives (list button, checkbox, chip, tooltip) and match these specs exactly.

## Files
- `designs/Board.dc.html` has changed: the grouped MODELS sidebar, the card glyphs and the matchup line.
- `designs/Comparison.dc.html` has changed: the weight-class chips in the headers and menus.
- `designs/New Comparison.dc.html`, `Index.dc.html` and `support.js` are unchanged copies, so the links work.
- `tokens.css` is unchanged. There are no new tokens.
- `data/models_by_weight_class_curated.csv` is the source of `Weight_Class` and `Combined_Min_GB`.

To open the files, serve `designs/` and open `Board.dc.html` or `Comparison.dc.html`. Both accept `?theme=dark|light`, and `Comparison.dc.html` also accepts `?scenario=multi-turn`.

## Shared data and primitives

### Weight class on a model
Each model needs `weightClass` (one of the ordered keys below, or `frontier`) and `gb` (`Combined_Min_GB`; null for frontier models and for models with no curated size). Read both from the API. Never bucket `gb` on the client.

| Index | Key | Label | Range copy | Hardware hint |
|---|---|---|---|---|
| 0 | `fly` | Fly | ≤ 12 GB | Phone or laptop |
| 1 | `feather` | Feather | 12–24 GB | 16 GB laptop or mid GPU |
| 2 | `light` | Light | ~32 GB | One 24 GB gaming GPU |
| 3 | `middle` | Middle | 64–104 GB | 80 GB GPU or 96 GB Mac |
| 4 | `heavy` | Heavy | 144–272 GB | GPU + large RAM offload |
| 5 | `super-heavy` | Super Heavy | 300 GB+ | Datacenter cluster |
| 6 | `frontier` | Frontier API | — | Hosted only · size undisclosed |

**Prototype data caveat:** some Board and Comparison models are not in the CSV, so their classes are placeholders. Mistral Large 3/4, GLM 5.2 and Kimi K2.6 are Super Heavy. Llama 4 Maverick and Nemotron 3 Ultra are Heavy. Command A/A+ are Frontier. Gemma 3 27B and Qwen3.6 27B are Light. Phi 4 is Feather at ~20 GB. Use real data in production.

### Mini size glyph (10px)
This is the 10px variant of the size glyph from the previous handoff.
- Inline-flex, `align-items: flex-end`, 1px gap, 10px tall.
- Six bars, each 2px wide with a 1px radius, at heights **2 / 4 / 5 / 7 / 8 / 10px**.
- Bars up to and including the class index are `--color-accent`; the rest are `--color-neutral-600`.
- Frontier models show a Phosphor `cloud` icon (12px) instead of the glyph.
- The glyph is always `aria-hidden`. The class name is always available as text or a tooltip.

### GB formatting
Under 1000 → `"{n} GB"`. From 1000 up → `"{n/1000} TB"` with one decimal place and a trailing `.0` stripped, e.g. "1.5 TB".

## 1 · Board sidebar: MODELS grouped by weight class

Replaces the flat MODELS list. The section header ("MODELS" + "Clear"), the "All N models ▾ / Show fewer ▴" toggle and the visibility rule are unchanged. The visibility rule: show models with ≥ 1 comparison, plus any selected model, unless the toggle is expanded.

### Structure
- Groups are listed in class order (Fly → Super Heavy), then Frontier API, in a column with an 8px gap.
- Each group is `role="group"` with `aria-label="{Class} weight"`.
- **Hide a group when it has no visible models.** In the prototype, Fly never shows and Frontier shows only when the toggle is expanded.

### Group header row
The row is a flex container with a 2px gap and holds two buttons.
1. **Select-all button** (`flex:1`, 30px tall, padding `0 10px`, 10px gap, radius `--r`, transparent; hover `--color-surface`). It is `role="checkbox"` with `aria-checked = true | mixed | false` and `aria-label="Select all {Class} weight models"`. Its native `title` is "{Class} weight · {range} · {hint}". Contents, left to right:
   - A 15×15 checkbox: 1px border, radius `--r`. When nothing is selected it has a `neutral-600` border and is transparent. When some or all are selected it has an `accent` fill and border, with an `on-accent` icon at 11px: `minus` when some are selected, `check` when all are.
   - The mini glyph, or the `cloud` icon for Frontier.
   - The label: 10.5px/500, 0.08em letter-spacing, uppercase, `neutral-300`, nowrap. For example "LIGHT".
   - The range: 11.5px `neutral-500`, `flex:1`, ellipsis. For example "~32 GB". Frontier shows "API".
   - The selection count, only when some are selected: 11.5px `accent-300`, `"{selected}/{visible}"`, e.g. "2/3".
2. **Collapse button:** 26×30, transparent, `neutral-400` (hover `--color-surface` background, text colour). It has `aria-expanded` and `aria-label="Toggle {Class} weight"`. Its icon is `caret-up` when open and `caret-down` when collapsed, at 12px. All groups start open.

### Model rows inside a group
- The rows sit in a container with `margin-left:17px` and `border-left:1px solid neutral-800`. This rule lines up under the centre of the header checkbox.
- Each row is the existing model list button with padding changed to `4px 10px 4px 12px`. It has a 15px checkbox, the name (ellipsis) and the count (12px `neutral-400`). States are unchanged.

### Behaviour
- Clicking the header selects **all visible models in the group**, or deselects them all if every one is already selected. Hidden zero-count models are not touched.
- Clicking a model toggles just that model, as before.
- Collapsing hides the rows only. The selection is kept.
- **Filter chips:** when every model with comparisons in a class is selected and the class has more than one such model, the chips collapse into one chip, "{Class} weight · {n} models". Removing that chip deselects them all. Otherwise each model gets its own chip, as before. Chips are `white-space:nowrap; flex-shrink:0`.
- The card filter logic is unchanged: a card matches if its base or challenger is a selected model.

## 2 · Board cards: size glyph and matchup line

The default card layout is now **side-by-side**. Stacked still exists and gets the same treatment.

### Size glyph next to model names
- In each model header row (base and challenger), place the mini glyph **directly after the name** (inside the existing 6–8px gap flex row), before "+N more" on the challenger.
- Wrap it in a `flex-shrink:0` span coloured `neutral-400` (this colours the `cloud` icon). Give it a `title` and `aria-label` of "{Class} weight · {GB} to run at 4-bit". Without a GB, use "· {range}". Frontier models read "Frontier API".
- The name still truncates with an ellipsis. The glyph never shrinks.

### Matchup line (under the prompt)
This is a new row directly below the prompt title, pulled up with `margin-top:-10px` (the card's column gap is 18px). It shows one inline-flex tag per card, `max-width:100%`, 24px tall, 6px gap, radius `--r`, 12.5px, nowrap, `overflow:hidden`. The label span has `min-width:0; padding-right:1px; text-overflow:ellipsis`. The 1px stops a sub-pixel ellipsis.

| | Same weight class | Across weight classes |
|---|---|---|
| Condition | base class = challenger class | the classes differ (including open vs frontier) |
| Icon (13px) | `ph ph-equals` | `ph-fill ph-lightning` |
| Copy | `Same weight · {Class}` | `Across weight class · {Base class} vs {Challenger class}` + ` + {n} more` if the card has extra models |
| Padding | 0 | `0 9px 0 8px` |
| Background | transparent | `--color-accent-900` |
| Border | transparent | 1px `--color-accent-700` |
| Text | `--color-accent-300`, 400 | `--color-accent-200`, 500 |
| Tooltip (`title`) | "Same weight class: both models are {Class} weight" | "Across weight classes: {Class} weight vs {Class} weight + {n} more" |

- Class names in the copy are the short labels (Light, Super Heavy). A frontier model reads **API**, e.g. "Across weight class · Light vs API".
- Examples: "Same weight · Light", "Across weight class · Middle vs Light + 2 more".
- The emphasis is on purpose: same-weight comparisons stay quiet, and across-weight comparisons get the filled accent tag.
- **Scope:** the matchup compares **only the base and the first challenger**. Extra models are counted, not classified. If the API exposes every model on a card, consider "same weight" to mean that all of them share a class.
- Long labels truncate with an ellipsis at narrow card widths. The full text is always in the tooltip.

## 3 · Comparison page: weight class indicators

### Column header chip
- **Base header:** place the chip after the model name, before the spacer and the token meta.
- **Challenger header:** place it after the model switcher button, before "N responses".
- Chip: inline-flex, `flex-shrink:0`, 22px tall, padding `0 8px`, 6px gap, 1px `neutral-700` border, radius `--r`, 12px `neutral-300`, nowrap.
  - Contents: the mini glyph (or `cloud` for frontier), the short class label ("Middle", or "Frontier API" for frontier models), then the GB if known in Space Mono 11px `neutral-400` (e.g. "64 GB").
  - `title`: "Middle weight · 64 GB to run at 4-bit". Without a GB, use "Super Heavy weight · 300 GB+". Frontier reads "Frontier API · hosted only · size undisclosed".
- The challenger chip updates when the active response changes. It also works while a response is generating.

### Response switcher and "Add a model" menu
- The menu width changes from 290px to **340px**.
- Each row gets a trailing class label after the name (before the spinner or check on the RESPONSES rows, and before the ETA on the ADD A MODEL rows). The label is inline-flex with a 6px gap, the mini glyph (or `cloud`) and the short label, at 11.5px/400 `neutral-400`, nowrap, with the same `title` as the chip.

## State changes
- Board: add `collapsed: { [classKey]: boolean }` for the sidebar groups (session-only; it can stay in local state). Model selection stays `models: string[]`.
- Board cards need `weightClass` and `gb` for the base and each challenger, plus the extra-model count. They already have that count.
- Comparison: each response or model object needs `weightClass` and `gb`.

## Accessibility
- The group header is a real tri-state checkbox (`aria-checked="mixed"`). The collapse button has `aria-expanded`.
- Glyphs are `aria-hidden`. The class is always present as text (sidebar headers, the matchup line, the Comparison chip) or as a tooltip plus `aria-label` (the card glyph).
- The matchup tag does not rely on colour alone: the icon and copy differ too.
- Check light-theme contrast for the `accent-200` text on `accent-900` and for the `accent` bars against `neutral-600`.

## Interactions to verify
**Sidebar**
- The header checkbox moves through none → all, and shows the partial state once a model is unchecked. "2/3" appears while partial.
- With "Show fewer", select-all touches only the visible models. After expanding to all models, select-all covers the full class.
- Collapsing a group with selected models keeps them selected and keeps the cards filtered.
- Selecting all of Light shows a single "Light weight · 3 models" chip. Removing it clears all three.
- Empty classes (Fly) never render a header.

**Cards**
- Same-class pairs show the quiet "= Same weight · {Class}" line. Different classes show the filled ⚡ tag.
- Cards with extra models append " + N more".
- Glyphs sit right after the names in both side-by-side and stacked layouts, and the names still truncate.
- At a 320px card width, short labels such as "Across weight class · Light vs Middle" render without an ellipsis. Longer ones truncate cleanly.

**Comparison**
- Both headers show a chip. Switching or adding a response updates the challenger chip.
- The menu rows show class labels without overflowing at 340px.
- Check both themes.

## Assets
- Icons: Phosphor Icons 2.1.1, regular and fill weights (`squares-four`, `cloud`, `check`, `minus`, `caret-up`, `caret-down`, `equals`, `lightning` (fill)).
- Fonts are unchanged: Geist, Space Grotesk and Space Mono.
- No images.
