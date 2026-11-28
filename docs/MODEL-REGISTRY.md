# Model registry curation

`packages/core/src/model-registry.ts` is the single source of truth for the
Models the platform can run. The development seed, `pnpm db:init` and
production `pnpm db:bootstrap` all read it. None of them creates users,
Comparisons or other content from it: `db:init` syncs the registry before it
decides whether to seed, so a populated local database still picks up a new
Model. The sync inserts new slugs, disables rows that left the catalogue, and
preserves an Admin-disabled Model.

Every entry records whether its weights are openly available (`openWeights`)
and, for open-weight entries, its **Weight class** and **Run size**. The
catalogue deliberately mixes open-weight families with closed frontier
families — see [ADR 0010](./adr/0010-frontier-models-are-first-class.md) — and
the pickers label the difference as **Open weights** or **Frontier API**.
Frontier Models have no Weight class and no Run size.

## What the catalogue keeps

- **One entry per Model the platform can serve.** Models are peers: there are
  no `current`/`previous` slots, and older Models such as Llama 3.3 70B sit in
  their class beside newer ones — see
  [ADR 0013](./adr/0013-models-are-peers-with-no-release-slots.md). `family`
  survives as metadata that search matches; nothing groups by it.
- **A Weight class and Run size on every open-weight entry.** Both are
  curated, never computed from parameter count, and source ranges are resolved
  to one number before entry. `Previous_Weight_Class` stays a curation note in
  the source data and is not carried by the app.
- **Stable slugs.** A slug identifies a Model for the life of the catalogue.
  Renaming a Model keeps its slug so old Comparisons and Responses continue to
  resolve. A genuinely different Model is a new entry, not a rename.
- **Verified IDs.** `apiModelId` is the exact provider ID. IDs are checked
  against OpenRouter's live `/api/v1/models` list when an entry is added, not
  copied from another registry. The open-weight catalogue was verified on
  **2026-11-23**: 29 of the 42 rows in the design's curated CSV resolved to a
  replayable Model and were added; the remaining thirteen were not. The eleven
  open-weight Models the CSV omits are hand-curated entries. On **2026-11-28**,
  Bonsai 2 27B, Inkling 2 Mini and Qwen3.8 Flash Next were added after the same
  check; Qwen3.8 Flash Next had been unavailable on 2026-11-23 and is now served
  as `qwen/qwen3.8-flash`.
- **Repeating monograms are fine.** The initials tile is decoration beside the
  display name; identity is the slug. Only duplicate slugs and duplicate
  provider IDs are rejected.

Run the registry tests after any edit:

```sh
pnpm --filter @owm/core test model-registry
```

They reject duplicate slugs, duplicate provider model IDs, a missing monogram
or publisher, an unparseable ETA, an open-weight entry with no Weight class,
Run size or parameter count, and a frontier entry that claims any of them.
Repeat monograms are allowed.

## How the pickers present the catalogue

- **Weight class is the browsing axis.** Step 2 opens with an **All sizes**
  tab and one tab per populated Weight class, with Frontier as its own tab.
  Models are grouped into one section per class, each with a size glyph, a
  Memory bar on one global 3 GB–2 TB log scale and its Run size in GB.
- **The Base picker groups by Weight class too.** Its menu has one optgroup
  per class, labelled `Open weights · Fly` through `Open weights · Super
  Heavy`, then Frontier API. There is no current/previous split, so no release
  marker and no disclosure in any picker.
- **Search spans the catalogue.** Typing matches display name, publisher,
  family, slug and class label. Search applies within the active tab, and every
  tab count follows the query so a reader can see where matches live.
- **Long menus scroll.** The Add model popover has its own search field and a
  capped, scrollable list; Base and existing Challengers remain excluded.

## Disabling versus removing

- **Disable** an entry from the Admin surface when it is temporarily
  unavailable or the platform should stop offering it. `enabled = false`
  removes it from pickers and blocks new Runs, but existing Comparisons keep
  their Responses. A registry sync never re-enables a disabled Model.
- **Retire** an entry by removing it from the catalogue when the vendor stops
  serving it. Production sync upserts the current entries and disables rows
  whose slug is no longer in the catalogue; it never deletes rows. Old
  Comparisons keep rendering, while the retired Model disappears from pickers
  and new Runs are rejected. Do not delete the row manually.
- **Rename** a display name or monogram in place. Keep the slug.

## Adding a Model

1. Confirm the provider ID and availability against
   <https://openrouter.ai/api/v1/models>. A Model the platform cannot replay
   does not enter the catalogue.
2. Add the entry with the next slug, the correct `openWeights` flag, family,
   display name, monogram, provider and ETA.
3. For an open-weight Model, add its Weight class and Run size, and the
   parameter counts used for display. Resolve any range in the source data to
   one number.
4. Run `pnpm --filter @owm/core test model-registry` and `pnpm typecheck`.
5. Release with `pnpm db:init` locally, or `pnpm db:bootstrap` (the staging
   deploy runs it) in production. The new entries appear in every picker;
   disabled state is preserved.
