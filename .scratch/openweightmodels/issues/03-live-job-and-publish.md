# 03: Watch a Job live, recover failures, and Publish

**What to build:** The Author watches a Job progress in real time, recovers provider failures, and publishes the Comparison. The Job page shows the four-stage strip and per-Run status, updates over SSE, survives a reload, and offers Retry/Skip on failures. When the Job settles, a ready banner offers Review first and Publish to board; publishing makes the card appear on the Board live and opens the Comparison.

**Blocked by:** 01 — Run a scheduled Challenger through the worker; 02 — Schedule a Comparison from the New Comparison form.

**Status:** ready-for-agent

- [ ] The Job page shows Scheduled → Resolving models → Calling hosted APIs → Ready with the specified bar and icon states.
- [ ] Each Challenger row shows Queued, Calling API…, Generating · N tok, Done · N tok · Ns, API timeout or Skipped, with a progress bar.
- [ ] Updates arrive over SSE without reload or polling; reconnecting shows a clear state and resumes from the last event.
- [ ] Retry and Skip appear only on failed rows and update the row in place.
- [ ] A reload resumes the Job, its current Runs and live updates.
- [ ] When every Run is Done or Skipped, the ready banner appears and Publish is disabled with an explanation when zero Challengers are Done.
- [ ] Publish is atomic, appears on the Board for every reader via SSE, and navigates to the Comparison.
- [ ] A draft is 404 to non-authors; the published Comparison is readable by everyone.
- [ ] While running, the page states that the Author may leave and will be notified.
