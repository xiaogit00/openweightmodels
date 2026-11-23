# Categories are entities with stable slugs

Six fixed Categories used to be stored by name in a `text[]` on each Comparison. Authors can now create Categories, so a Category needs its own row with a stable slug, a display name, a creator and a `featured` flag marking the curated presets. Comparisons reference Categories by id, so renaming a Category renames it everywhere instead of forking it into a near-duplicate, and merging two spellings of one idea is a reassignment rather than a rewrite of every row.

**Considered options**: keeping bare names and validating them against the table (rejected: a rename or merge would have to rewrite every Comparison, Board facet and bookmark, and "Front end" and "Front-end" stay indistinguishable); a table only for community Categories beside the six constants (rejected: pickers must rank presets and community in one list, and two sources for one concept drift).

**Consequences**: a migration backfills the preset Categories and converts existing `text[]` values into join rows; category counts and Board facets now join; renaming a preset relabels historical Comparisons; deleting a Category is an Admin action that must clear or reassign its references.
