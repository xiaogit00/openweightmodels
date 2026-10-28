# Spec: multi-turn conversations

## Problem Statement

An author can only publish a Comparison built from a single Prompt and a single uploaded Base output, and the New Comparison form never says what the file should contain beyond "front-matter prompt is read automatically". People who have a real chat with a model — several exchanges, where later answers depend on earlier ones — have no way to publish it, and people who have no file at all have no way to start. The result is either a confusing upload failure or a Comparison that flattens a conversation into one misleading prompt.

## Solution

An author uploads a whole chat exported with the AI Exporter browser extension. The platform reads every Turn, shows a confirmation of what it parsed, and replays the Conversation against the chosen Challengers: each Challenger answers every Turn, with its own earlier replies in context, and the Comparison shows the two transcripts side by side Turn by Turn. A second tab covers the no-file case: type one Prompt, paste the Base reply, and get a one-Turn Comparison. A one-Turn Conversation reads exactly like today's Comparisons.

## User Stories

1. As an author, I want to upload the markdown file my chat exporter produced, so that I do not have to reformat my conversation.
2. As an author, I want the form to tell me which extension produces that file and link to it, so that I know where to get one.
3. As an author, I want a real downloadable sample export, so that I can see the expected shape without uploading my own chat first.
4. As an author, I want the file's URL, timestamps and exporter footer removed, so that the published Comparison contains only the conversation.
5. As an author, I want my private chat URL not to be stored, so that publishing does not leak where the conversation came from.
6. As an author, I want a confirmation step showing how many Turns were found and the start of each message, so that I can catch a bad parse before spending generation calls.
7. As an author, I want the confirmation to flag a final reply that looks cut off, so that I understand why the last comparison may look unfair.
8. As an author, I want a cut-off final reply accepted anyway, so that an interrupted answer is not treated as an error.
9. As an author, I want adjacent user messages merged into one Turn, so that my double-send does not create a Turn with no reply.
10. As an author, I want a Turn with no assistant reply to block creation with a clear message, so that I do not publish a Comparison missing its Base output.
11. As an author, I want to see how many provider calls and roughly how many input tokens the Comparison will cost before I schedule it.
12. As an author, I want a clear refusal when my Conversation exceeds the Turn, size or length limit, so that I do not fail halfway through generation.
13. As an author, I want to choose the Base model even though the file names only the vendor, so that attribution is truthful.
14. As an author, I want the vendor from the file to pre-select the Base model when there is exactly one match, so that I do not repeat obvious work.
15. As an author, I want a default title taken from my first Prompt, so that a filename like `Claude_Public-certificates_20261028` never becomes a published title.
16. As an author, I want to edit that title, so that I can name the Comparison properly.
17. As an author with no file, I want to type one Prompt and paste the Base reply, so that I can publish a quick one-Turn Comparison.
18. As an author, I want to upload a plain markdown file or a legacy front-matter file, so that the files I already have keep working.
19. As an author, I want to see the Job page as one row per Challenger with "turn 3 of 6", so that progress is legible however long the Conversation is.
20. As an author, I want Retry to resume from the Turn that failed, so that a single timeout does not discard the answers already generated.
21. As an author, I want Skip to stop that Challenger's Replay, so that the transcript never contains answers to a conversation that did not happen.
22. As an author, I want a partially replayed Challenger labelled "stopped at turn 4", so that readers understand why it ends early.
23. As an author, I want to publish once every Challenger is done or skipped, so that partial Replays do not block release.
24. As an author, I want to add a Challenger to a published multi-turn Comparison, so that a new model joins the existing Conversation.
25. As an author, I want Add model to tell me it will replay all six Turns, so that the cost is not a surprise.
26. As a reader, I want the Comparison laid out Turn by Turn with the Base output and a Challenger side by side, so that I can compare the answer to the same question.
27. As a reader, I want a sticky "Turn 3 of 6" control with previous and next, so that I can move through a long Conversation without losing my place.
28. As a reader, I want each Turn to show which model is speaking, so that the transcript is unambiguous.
29. As a reader, I want streaming, failed and skipped Turns marked in place, so that I know what is missing rather than guessing.
30. As a reader, I want to annotate any Turn's reply and see which Turn the note belongs to, so that multi-turn notes stay attached to the right answer.
31. As a reader, I want a one-Turn Comparison to render exactly as it does today, so that existing content does not change.
32. As a reader, I want the Board card to show the first Prompt and the number of Turns, so that I know what I am opening.
33. As a reader, I want to filter and search by that first Prompt as before, so that discovery does not change.
34. As an author, I want existing Comparisons to keep working after the change, so that publishing history is not disturbed.
35. As a keyboard user, I want the Turn rail and the transcript controls to work without a mouse, so that I can read and annotate any Turn.
36. As a reader who prefers reduced motion, I want Turn changes and streaming states to avoid animation, so that the transcript does not move unexpectedly.
37. As an author, I want error messages that name the problem ("turn 4 has no reply from Claude"), so that I can fix the file instead of guessing.
38. As an author, I want a message that recognises a raw chat copy-paste, so that I know the exporter is the missing step.

## Implementation Decisions

**Domain model.** Comparison = one Conversation. Conversation = ordered Turns. Turn = one user message (its Prompt) plus one Response per Model. Base output = the Base model's Response for a Turn. Challenger = a Model replayed through every Turn. Run = one attempt to produce one Response. Replay = one Challenger's Responses across the whole Conversation, generated in Turn order. The first Turn's Prompt is the headline. A single-Turn Comparison is the degenerate case; there is no separate post type.

**Persistence.** Turns are stored once per Comparison and referenced by Responses, so the script is never duplicated per Model. Each Response is one Model's reply to one Turn, uniquely `(comparison, model, turn)`, and the Base model has one Base Response per Turn. Annotations attach to a Response, which is now turn-scoped, so offsets remain absolute within a single markdown string. Existing Comparisons are backfilled to a one-Turn Conversation during migration; there is no dual-read path.

**Replay contract.** Providers accept a message array rather than a single prompt. For Turn *n* the array holds the Conversation's user messages 1..*n* and **that Model's own** Responses 1..*n-1*; a Challenger never sees the Base model's replies. Reasoning content is never replayed. Turns within one Replay are strictly sequential; Replays run in parallel. Each Response carries its own status, tokens, latency, error and attempt count, and a failed Turn does not fail its neighbours. Retry re-queues the failed Response and continues the Replay; Skip marks that Response skipped and cascades skipped to every later Turn of the same Replay. A Replay is finished when all of its Responses are done or skipped.

**Parser.** The importer recognises AI Exporter sections by the `# you asked` and `# <vendor> response` headers, matched only outside fenced code blocks; `---` separators are decoration and never delimiters. The leading `> From:` line, every `message time:` line and the trailing exporter footer are discarded and never persisted. Adjacent user messages with no reply between them merge into one Turn. A response header with no body, or a user section with no following response, blocks creation with a Turn-specific error. The final response may be truncated: when it fails a conservative heuristic, the confirmation shows a warning and allows the author to proceed. Legacy YAML front-matter files and bare markdown become a one-Turn Conversation with the body as the Base output and the Prompt either taken from `prompt:` or typed in the form. Errors are specific: missing reply, no recognisable sections, raw chat paste, empty body, oversized file.

**Limits.** A Conversation may contain at most 6 Turns, the uploaded file at most 0.5 MB, and the replayed text at most 100,000 characters across all Turns. Limits are enforced at creation, before any Job is queued, and the confirmation shows the estimated call count and input tokens. The estimate is derived from Turns × Challengers and the accumulated prompt lengths; it is a warning, not a billing guarantee.

**Creation flow.** Two tabs in the base-output step: **Upload a conversation** and **Write a prompt**. Upload runs detection, then a confirmation step with per-Turn previews, merge notes, truncation warnings and the estimate. Write takes a Prompt and a pasted Base reply, producing one Turn with no confirmation beyond the normal form. The Base model picker stays required; the export's vendor is a hint that pre-selects only when exactly one registry Model matches it. The title defaults to a summary of the first Prompt and remains editable.

**Reading.** The Comparison is a stacked transcript grouped by Turn: user message full width, Base output and the active Challenger side by side beneath it, a sticky "Turn n of m" rail with previous/next and jump, and challenger tabs unchanged. Per-Turn states render in place (queued, streaming, failed, skipped, stopped here). A one-Turn Comparison renders with the same structure and spacing as today. Annotations show the Turn they belong to.

**Board and discovery.** Cards show the first Prompt as the headline, a Turn count badge, and the first Base Response as the preview. Search, filters and ordering keep using the Comparison's headline Prompt.

**Job page.** One row per Replay, showing model, "turn n of m", aggregate progress and the current error. Actions are Retry from the failed Turn and Skip remaining. Publish unlocks when every Replay is done or skipped; a partially replayed Challenger must be visible as such on the published Comparison.

**Add model.** Adding a Challenger to a published Comparison replays every stored Turn using the stored user messages; the confirmation states the Turn count and the call estimate, and the new Replay streams into the published Comparison with a "Replay in progress" marker.

**Wording.** "Replay" and "Run" are internal vocabulary. The interface says "turn", "comparing 6 turns", and the model's name; it never says "run" or "replay".

**Accessibility.** The Turn rail is keyboard operable with visible focus; moving between Turns does not move focus unexpectedly, and the transcript is reachable in reading order. Streaming and arrival motion honour reduced motion, and 10px type and contrast rules continue to apply.

## Testing Decisions

A good test here asserts externally visible behaviour: what the parser returns for a given file, which messages a provider receives for a Turn, what statuses a Job exposes after a failure, and what a reader can see and act on. Tests must not assert internal table shapes or component internals.

Five seams, in order of preference:

1. **Parser** — a pure function over file text producing Turns plus warnings/errors. Unit tested with the two real exports in `test_md/` as fixtures, plus synthetic files for merged user messages, a missing reply, a raw paste, a fence that contains a fake header, and a truncated tail. This is the highest-value seam and the one to build first.
2. **Creation** — the service that turns a parsed Conversation into a Comparison with Base Responses and a Job. Integration tested for limits, Base model validation, title defaulting, and one-Turn parity.
3. **Provider message contract** — assert the exact message array sent for Turn *n*: user messages 1..n, the Model's own prior Responses only, no reasoning, no Base model replies. This is the fairness contract, so it gets a direct test through the provider seam with a recording fake.
4. **Replay state machine** — integration through the real job service with the mock provider: failure at Turn 4 leaves 1–3 done, Retry resumes at 4, Skip cascades, and the Replay is finished only when all its Responses are terminal.
5. **Browser flow** — Playwright: upload → confirmation (warnings visible) → schedule → Job shows "turn n of 6" → publish → Comparison shows the transcript and Turn navigation. Existing visual baselines for a one-Turn Comparison guard parity.

Prior art: core Vitest suites for upload parsing and Job transitions with the mock provider, and the existing Playwright suites for create → publish → read, keyboard use and visual baselines.

## Out of Scope

- Editing or deleting individual Turns or Replies after import; a broken export is re-exported.
- Images, attachments, tool calls or artefacts embedded in an export.
- More than 6 Turns, or raising limits dynamically.
- Per-Model context-window warnings or truncation by the provider.
- Retroactive changes to already published Comparisons beyond the one-Turn backfill.
- Spend caps, rate limits and provider budgets (ticket 16).
- Discussion changes, or annotations that span Turns.
- Expanding the Model registry itself (separate ticket), beyond the Claude entry needed to demo this.

## Further Notes

- The AI Exporter format is owned by a third party; ADR 0009 records why we accepted that and how fixtures protect us.
- The two sample exports are doing different jobs: the DeepSeek file is complete and should become the downloadable sample; the Claude file is truncated at the end and makes the better parser fixture, because it exercises the warning path and contains `---` and headings inside message bodies.
- Fence-awareness is a correctness requirement, not a nicety: a user message that quotes code can legitimately contain a line starting with `# you asked`.
- Creating a Claude Base model in the registry is a prerequisite for the flagship demo (upload a Claude chat, replay it against the others); without it the vendor hint leads nowhere. ADR 0010 records why frontier closed models belong in the catalogue at all.
- `BACKEND.md` describes the current single-Prompt pipeline and must be updated alongside ticket 20.
