# Models are peers; the catalogue has no release slots

The catalogue used to keep one `current` and one `previous` entry per family, hiding the previous one behind a disclosure in the pickers. Weight classes make size, not recency, the browsing axis, and a Model now stands on its own: every Model the platform can serve is an ordinary entry in its Weight class, and an entry is retired only when the vendor stops serving it. `family` survives as invisible metadata that search can match, but nothing groups or hides by release.

**Considered options**: keeping the release slot and hiding previous entries (rejected: it made two Models of one family look like one product, and an eight-tab class bar with a second "show previous" axis is unreadable); a `legacy` flag applied by hand (rejected: same second axis under a different name); one entry per family with a version list inside it (rejected: Challenges and Responses reference one Model row, so a version list would eventually need the same slots again).

**Consequences**: `docs/MODEL-REGISTRY.md` loses its two-release curation rule; the Step 1 menu groups by Weight class only, and Step 2 loses the previous-release toggle for Frontier too; older Models such as Llama 3.3 70B and MiniMax M2.7 appear as peers; monogram uniqueness is no longer an invariant; the registry tests drop `missing_current` and `duplicate_release`.
