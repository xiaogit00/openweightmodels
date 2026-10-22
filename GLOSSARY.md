# OpenWeightModels

A forum where people publish side-by-side comparisons of open-weight model responses to the same prompt.

## Comparisons

**Comparison**:
A user-authored post pairing one Base output with one or more Challenger responses to the same Prompt. Duplicates of a Prompt across Comparisons are allowed.
_Avoid_: thread, entry, run

**Prompt**:
The instruction that every Response in a Comparison answers.
_Avoid_: question, task, input

**Base output**:
The author-supplied Response, uploaded as markdown.
_Avoid_: base response, upload, reference answer

**Base model**:
The Model that generated the Base output.
_Avoid_: source model, primary model

**Challenger**:
A Model whose Response the platform generates for the Comparison's Prompt.
_Avoid_: competitor, opponent, comparison model

**Response**:
One Model's output within a Comparison, whether uploaded as the Base output or generated as a Challenger.
_Avoid_: output (unqualified), completion, answer

**Author**:
The user who created a Comparison.
_Avoid_: owner, poster, submitter

**Category**:
A topical tag from the fixed Category list, used for filtering the Board. A Comparison may have several.
_Avoid_: tag, topic

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

**Admin**:
A user with the `admin` role, able to enable or disable Models, hide content, review Reports and suspend accounts.
_Avoid_: moderator, staff

## Generation

**Model**:
An entry in the Model registry: an open-weight LLM available as a Base model or Challenger.
_Avoid_: provider, endpoint

**Model registry**:
The curated catalogue of Models the platform can run.
_Avoid_: model list, provider list

**Job**:
One batch of generation work for a Comparison: the initial Challenger set, or a later add-model request.
_Avoid_: task, batch, run

**Run**:
One attempt to generate one Challenger's Response within a Job. A retry creates another attempt of the same Run.
_Avoid_: task, job

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
