# 02: Schedule a Comparison from the New Comparison form

**What to build:** An Author can create a Comparison entirely from the New Comparison screen: upload a Base output, confirm the auto-filled Prompt and title, choose the Base model and up to four Challengers, add Categories and Effort, see a live Board card preview, schedule the Job, and land on an author-only Job summary showing the queued Runs.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Drag-and-drop or browse accepts `.md`, `.markdown` and `.txt` up to 1 MB and rejects invalid type, size, encoding or empty body with a specific inline error.
- [ ] Prompt auto-fills from YAML front matter and title auto-fills from the sample or filename; both remain editable.
- [ ] A front-matter `model:` that matches the Model registry preselects the Base model; an unknown value is ignored with a clear prompt to choose.
- [ ] The Base model tile is disabled as a Challenger, all tiles are disabled at four selected, and the counter reads “N of 4 selected”.
- [ ] Categories are multi-select from the fixed list; Effort uses Low/Med/High with the specified sublabels.
- [ ] The sticky “ON THE BOARD” preview reflects the form state and shows Draft, Generating or Ready.
- [ ] Submit is disabled at 45% opacity until a file, Base model and at least one Challenger exist, with helper text explaining what is missing or estimating calls and the slowest ETA.
- [ ] A successful schedule navigates to an author-only Job summary listing the queued Runs; an API failure keeps the form intact and shows an inline error.
- [ ] A non-author receives 404 for the Job summary.
