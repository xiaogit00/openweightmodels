# A Comparison is a user-authored post

A Comparison pairs one uploaded Base output with platform-generated Challenger responses to the same Prompt. Every upload creates a new Comparison, and duplicates of a Prompt are allowed. We chose this over canonical Prompt pages that many users attach responses to, because the upload flow, author-only drafts and explicit Publish step all assume a single owner, and the schema records one `base_model_id`.

**Considered options**: a canonical Prompt page with many contributors would make Prompt the unit of discussion and require merging or moderating duplicate prompts. We rejected it because "base output" and "author" lose meaning when anyone can attach the first response.

**Consequences**: duplicate Prompts will appear on the Board and there is no shared discussion per Prompt. If prompt-level discussion is wanted later, it is a new aggregate, not a change to Comparison.
