# OpenWeightModels

A forum where people publish side-by-side comparisons of open-weight and frontier models answering the same conversation.

## Comparisons

**Comparison**:
A user-authored post pairing one Conversation's Base outputs with one or more Challengers' replies for every Turn. Its first Turn's Prompt is the headline shown on the Board. Duplicates of a Conversation across Comparisons are allowed.
_Avoid_: thread, entry, run

**Conversation**:
The ordered Turns that every Model in a Comparison answers. A Conversation with a single Turn is still a Conversation.
_Avoid_: chat, thread, transcript

**Turn**:
One user message and the assistant reply it elicits from each Model.
_Avoid_: message (unqualified), exchange, round

**Prompt**:
The user message of a Turn.
_Avoid_: question, task, input, instruction

**Base output**:
The author-supplied assistant reply for each Turn, captured from the author's own session with the Base model.
_Avoid_: base response, upload, reference answer

**Base model**:
The Model that produced the Base outputs.
_Avoid_: source model, primary model

**Challenger**:
A Model replayed through the whole Conversation by the platform.
_Avoid_: competitor, opponent, comparison model

**Response**:
One Model's assistant reply for one Turn, whether uploaded as a Base output or generated as a Challenger.
_Avoid_: output (unqualified), completion, answer

**Author**:
The user who created a Comparison.
_Avoid_: owner, poster, submitter

**Category**:
A topical label used to describe and filter Comparisons. A Comparison may have several. The preset Categories are curated; every other Category is created by an Author.
_Avoid_: tag, topic

**Preset category**:
One of the curated Categories offered first in the category picker, where it is labelled *Featured*.
_Avoid_: default category, fixed category, featured category

**Community category**:
A Category created by an Author rather than curated by the platform.
_Avoid_: custom category, user category, tag

**Effort**:
The Low/Med/High classification of how demanding a Prompt is.
_Avoid_: difficulty, complexity

**Board**:
The public feed of published Comparisons.
_Avoid_: feed, home, index

**Publish**:
Make a Comparison visible on the Board.
_Avoid_: release, post, go live

**Draft**:
A Comparison that has not been published. It is visible only to its Author.
_Avoid_: unpublished post, private comparison

**Unpublish**:
Return a published Comparison to the Author-only state without deleting it.
_Avoid_: retract, hide, unpublish post

**Takedown**:
An Admin action that removes a Comparison from public view.
_Avoid_: ban, delete (when the content is only hidden)

**Hidden content**:
A comment or Annotation an Admin removed from public view without the Author deleting it.
_Avoid_: deleted, banned, takedown (for comments or Annotations)

**Report**:
A reader's request for an Admin to review a Comparison, comment or Annotation.
_Avoid_: flag, complaint

**Suspension**:
An Admin action that blocks a user's writes while leaving their reads and existing content in place until each item is hidden separately.
_Avoid_: ban, deactivation, lockout

**Handle**:
A user's unique public identity, shown as `@handle`. Email addresses are never public.
_Avoid_: username, login, display name

**Deleted account**:
An account whose owner deleted it. Email, handle and sessions are erased; published Comparisons stay attributed to `[deleted]`, and its comments and Annotations become tombstones so other people's replies remain.
_Avoid_: deleted user, ghost user, anonymised account

**Admin**:
A user with the `admin` role, able to enable or disable Models, hide content, review Reports and suspend accounts.
_Avoid_: moderator, staff

## Generation

**Model**:
An entry in the Model registry, available as a Base model or Challenger. It is either open-weight or frontier.
_Avoid_: provider, endpoint

**Open-weight model**:
A Model whose weights are published, so it can be run by a provider or self-hosted.
_Avoid_: open model, open-source model

**Weight class**:
The hardware tier of an open-weight Model. The tiers are defined by Run size, but the registry stores the curated class rather than recomputing it, so reclassifying is a curation change. It is a fixed property of the Model, not of a Comparison, and frontier Models have none. The UI presents frontier Models as a separate *Frontier API* group; that grouping is display, not a Weight class.
_Avoid_: size class, tier, size bucket

**Run size**:
The memory an open-weight Model needs to run at 4-bit, counting both VRAM and system RAM. It is not a parameter count.
_Avoid_: model size, model weight, model footprint

**Publisher**:
The lab or vendor that published a Model, e.g. Alibaba or Anthropic. It is display and search metadata, distinct from the routing provider that serves the API.
_Avoid_: provider, endpoint, vendor (as the preferred term)

**Frontier model**:
A closed Model available only through its vendor's API, at the current top capability tier.
_Avoid_: proprietary model, commercial model, closed model (as the preferred term)

**Model registry**:
The curated catalogue of Models the platform can run.
_Avoid_: model list, provider list

**Model family**:
A line of Models that shares a name and a history, e.g. Llama or Claude. It is search metadata; the catalogue does not group or hide by it.
_Avoid_: vendor, brand

**Job**:
One batch of generation work for a Comparison: the initial Challenger set, or a later add-model request. A Job contains one Replay per Challenger.
_Avoid_: task, batch, run

**Run**:
One attempt to produce one Response: a single Model's reply to a single Turn. A retry creates another attempt of the same Run.
_Avoid_: task, job, generation

**Replay**:
One Challenger's Responses across every Turn of a Comparison, generated in Turn order. A Replay that is skipped stops at the first skipped Turn and leaves the later Turns unattempted.
_Avoid_: chain, run (unqualified), conversation replay

**Notification**:
An in-app alert to a user. In v1 it exists only to tell an Author that a Job is ready.
_Avoid_: email, alert, toast

## Discussion

**Annotation**:
A threaded note attached to a character range of a Response.
_Avoid_: highlight, comment (unqualified), note

**Annotation kind**:
The classification of an Annotation: Bug, Hallucination, Good or Question.
_Avoid_: tag, label, category

**Annotation thread**:
The messages attached to one Annotation. The first message is created with the Annotation.
_Avoid_: comment thread

**Discussion**:
The Comparison-level conversation. A Discussion comment may be about a specific Model, and replies are one level deep.
_Avoid_: comments, replies, thread

**Vote**:
A user's upvote on a Discussion comment or an Annotation. A user cannot vote on their own content.
_Avoid_: like, score, upvote (as a noun)
