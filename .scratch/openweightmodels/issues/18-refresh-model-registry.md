# 18: Refresh the Model registry

**What to build:** The Model registry stops being a nine-entry demo list and becomes a curated catalogue of the models people actually compare. It covers the major open-weight families (Llama, Qwen, DeepSeek, Mistral, Gemma, Phi, Kimi, GLM, MiniMax, GPT-OSS, Nemotron) and the major closed frontier families (Claude, GPT, Gemini, Grok, Command), each at its current version plus the previous one where both are still callable. Every entry records whether its weights are openly available, so the interface can keep the site's open-weight promise visible rather than quietly abandoning it.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] The registry carries the current version and the previous version of each supported family, with a slug, display name, monogram, provider, model ID and ETA for each.
- [ ] Every entry records whether its weights are openly available.
- [ ] Model IDs and availability are verified against the provider's model list at implementation time, not copied from memory or another registry.
- [ ] Base model and Challenger pickers show closed models distinctly from open-weight ones, so a reader is never misled about what ran.
- [ ] Development seed and production bootstrap read the same catalogue; no fake Comparisons or users are added.
- [ ] A short curation rule is documented: which versions are kept, when an entry is disabled, and how a new release is added.
- [ ] Registry tests fail on duplicate slugs, duplicate model IDs, missing monograms or an unparseable ETA.
- [ ] Removing or renaming an entry does not break existing Comparisons that reference it.

## Comments

The catalogue deliberately mixes both classes; ADR 0010 records why. Copy that still describes the product as open-weight only must be corrected as part of this ticket, and the open/closed flag is what keeps the distinction visible rather than implied.
