# Model registry curation

`packages/core/src/model-registry.ts` is the single source of truth for the
Models the platform can run. Both the development seed and production
`pnpm db:bootstrap` read it; neither creates users, Comparisons or other
content from it.

Every entry records whether its weights are openly available (`openWeights`).
The catalogue deliberately mixes open-weight families with closed frontier
families — see [ADR 0010](./adr/0010-frontier-models-are-first-class.md) — and
the pickers label the difference as **Open weights** or **Frontier API**.

## What the catalogue keeps

- **Two releases per family where both are callable.** Each family has one
  `release: 'current'` entry and, while the vendor still serves it, one
  `release: 'previous'` entry. Older releases are retired from the catalogue.
- **One line per family.** For families with several sizes or specialisations,
  the catalogue follows the flagship *open-weight* line (for example Qwen3.8
  27B rather than the closed Qwen Max/Plus/Flash API, and Kimi K3 rather than
  K3.1 Pro). Phi and GPT-OSS have a single callable generation, so they carry
  only a current entry.
- **Stable slugs.** A slug identifies a Model for the life of the catalogue.
  A new release gets a new slug; renaming a Model keeps its slug so old
  Comparisons and Responses continue to resolve.
- **Verified IDs.** `apiModelId` is the exact provider ID. IDs are checked
  against OpenRouter's live `/api/v1/models` list when an entry is added, not
  copied from another registry. The current catalogue was verified on
  **2026-10-29**.

Run the registry tests after any edit:

```sh
pnpm --filter @owm/core test model-registry
```

They reject duplicate slugs, duplicate provider model IDs, missing monograms,
an unparseable ETA, a family with no current release and duplicate releases.

## Disabling versus removing

- **Disable** an entry from the Admin surface when it is temporarily unavailable
  or the platform should stop offering it. `enabled = false` removes it from
  pickers and blocks new Runs, but existing Comparisons keep their Responses.
  A registry release never re-enables a disabled Model.
- **Retire** an entry by removing it from the catalogue. Production sync upserts
  the current entries and disables rows whose slug is no longer in the
  catalogue; it never deletes rows. Old Comparisons keep rendering, while the
  retired Model disappears from pickers and new Runs are rejected. Do not delete
  the row manually.
- **Rename** a display name or monogram in place. Keep the slug. A genuine
  model change (a new provider ID) is a new entry, not a rename.

## Adding a new release

1. Confirm the provider ID and availability against
   <https://openrouter.ai/api/v1/models>.
2. Add the new entry with the next slug, `release: 'current'`, the correct
   `openWeights` flag, family, display name, monogram, provider and ETA.
3. Change the family's former current entry to `release: 'previous'`, or remove
   it if the vendor no longer serves it.
4. Keep monograms unique and ETAs positive integers; the registry tests fail on
   duplicate or missing monograms and unusable ETAs.
5. Run `pnpm --filter @owm/core test model-registry` and `pnpm typecheck`.
6. Release with `pnpm db:bootstrap` (or the staging deploy, which runs it). The
   new entries appear in every picker; disabled state is preserved.
