# Privacy, retention and account lifecycle

The member-facing copy lives at `/privacy` and `/terms`
(`apps/web/src/app/privacy/page.tsx`, `apps/web/src/app/terms/page.tsx`). This file
is the internal reference behind that copy: the data inventory, the retention
windows, the deletion policy and what still needs owner/legal review.

Status: **implemented behaviour, legal copy unreviewed**. The legal pages carry a
visible draft banner and bracketed placeholders.

---

## 1. Data inventory

| Data | Table | Public? | Personal? | Notes |
|---|---|---|---|---|
| Email address | `users.email` | no | yes | sign-in only; released on deletion |
| Handle | `users.handle` | yes | pseudonymous | shown on every published item; released on deletion |
| Session token, IP, user agent, expiry | `auth_sessions` | no | yes | Better Auth owns the row; removed on sign-out expiry or deletion |
| Hashed magic-link token | `auth_verifications` | no | yes | single use, 15 minutes; the email is inside the JSON `value` |
| Prompt, title, Categories, Effort | `comparisons` | published only | user content | prompt freezes at scheduling |
| Uploaded Base output | `responses` (`is_base`) | published only | user content | never sent to a model provider |
| Generated Response, tokens, latency, provider cost | `responses` | published only | user content | generated from the Prompt |
| Discussion comment / reply | `comments` | published only | user content | tombstoned on delete |
| Annotation (quote, range, kind) and thread | `annotations`, `annotation_messages` | published only | user content | hidden with the Annotation |
| Vote | `votes` | counts only | activity | who voted is not rendered |
| Notification and read state | `notifications` | no | yes | `job.ready` only |
| Report filed by a reader | `reports` | no | activity | removed with the reporting account |
| Public ticker line | `activity_events` | yes | pseudonymous | summary includes the handle |
| Moderation action | `admin_actions` | no | actor id only | retained for accountability |

Not collected: name, avatar uploads, analytics, advertising identifiers,
third-party cookies. `users.name`, `users.image` and `users.avatar_url` exist for
schema compatibility but the product does not populate them; deletion clears them
anyway.

## 2. Retention

| Data | Retention | Enforced by |
|---|---|---|
| Account (email, handle) | until deletion | `deleteAccount` |
| Anonymised account row (id, role, join date, `deleted_at`) | retained after deletion only to attribute published work | `deleteAccount` |
| Session | Better Auth expiry (7 days), or sign-out/deletion | Better Auth + `deleteAccount` |
| Magic-link token | 15 minutes, single use | Better Auth `expiresIn`; `deleteAccount` clears pending rows |
| Unpublished Comparison and its Responses | until the author deletes it or the account is deleted | `softDeleteComparison` / `deleteAccount` |
| Published Comparison | for the life of the Comparison | stays after account deletion |
| Comments | for the life of the Comparison; tombstoned when deleted or when the author leaves | author delete + `deleteAccount` |
| Annotations and thread messages | for the life of the Comparison; a deleted Annotation hides its thread | author delete + `deleteAccount` |
| Votes, notifications, reports filed | until the account is deleted | `deleteAccount` |
| Activity events | retained for SSE replay; rows for removed content/accounts are deleted | `retractActivity`, `deleteAccount` |
| Admin audit | append-only, retained after account deletion | `admin_actions` has no cascade |

There is **no scheduled pruning job** yet. The intended window once one exists is 90
days for activity events and immediate removal of expired sessions and verification
rows; today those rows are inert but remain until their account is deleted (or, for
verification rows, until used). The privacy page says so rather than claiming a
cleanup that does not exist. Adding a retention job belongs with the operational
work in ticket 16.

## 3. Account deletion policy

`deleteAccount(userId, confirmation)` in
`packages/core/src/services/account.ts`. The member types `DELETE`; the account is
then changed in one transaction:

1. **Unpublished Comparisons are deleted** — `status !== 'published'` or already
   soft-deleted. Their Jobs, Responses (including the uploaded Base output),
   Annotations, Discussion and Job events go with them.
2. **Published Comparisons stay.** The account row is kept with
   `deleted_at` set, and its author renders as `[deleted]` everywhere
   (`DELETED_AUTHOR_HANDLE` in `packages/core/src/domain/types.ts`).
3. **Comments are tombstoned**: body blanked, `deleted_at` set, replies by other
   people untouched; `comment_count` decremented once per visible comment. Every
   comment the account wrote is tombstoned, including childless ones, so the
   conversation and its ordering stay stable rather than changing shape at the
   moment an account leaves.
4. **Annotations are soft-deleted** (highlight and thread disappear, following the
   existing author-delete rule) and `annotation_count` decremented. Other people's
   thread messages remain in the database but are no longer rendered; the account's
   own thread messages are blanked.
5. **Annotation messages authored by the account are blanked.**
6. **Votes are removed**: the account's own votes and votes on its content.
7. **Sign-in identity is removed**: sessions, auth accounts and pending
   magic-link verification rows; the browser cookies are expired by the route.
8. **Notifications and reports filed by the account are deleted.**
9. **Personal fields are cleared**: email, handle, name, image, avatar, suspension
   fields; `role` resets to `user`; `deleted_at` is set. Handle and email are then
   free for reuse.
10. **Ticker rows that name the account or point at removed content are deleted.**
    One summary-less `account.deleted` event per affected Comparison updates open
    Boards through SSE.

Guards: wrong confirmation (`400 confirmation_required`), already deleted
(`409 account_deleted`), last remaining Admin (`409 last_admin`). Any signed-in
account can delete itself, including one that is suspended or has not chosen a
handle yet.

This mirrors the existing author-delete rules: Discussion comments keep a tombstone so
the conversation and other people's replies survive, and Annotations disappear with
their highlight and thread. Counts stay exact in both cases.

## 4. Data export

`GET /api/account/export` (signed-in) returns
`openweightmodels-<handle>-<date>.json` with `formatVersion: 1`:

```json
{
  "exportedAt": "ISO-8601",
  "formatVersion": 1,
  "account": { "id", "handle", "email", "displayName", "role", "createdAt", "updatedAt", "suspendedAt", "deletedAt" },
  "comparisons": [{ "id", "title", "prompt", "categories", "effort", "status", "base", "responses" }],
  "comments": [{ "id", "comparisonId", "comparisonTitle", "body", "createdAt", "deletedAt" }],
  "annotations": [{ "id", "quote", "kind", "startOffset", "endOffset", "messages" }],
  "annotationReplies": [{ "id", "annotationId", "comparisonId", "comparisonTitle", "body", "createdAt", "deletedAt" }],
  "votes": [{ "targetType", "targetId", "createdAt" }],
  "notifications": [{ "id", "kind", "payload", "readAt", "createdAt" }],
  "reports": [{ "id", "targetType", "targetId", "reason", "detail", "status", "createdAt" }]
}
```

Only rows authored by the account are included. Other people's emails, comment
bodies and thread replies are excluded by construction (there is a test for it).

## 5. Before launch: owner/legal review

- Replace `[legal entity name]`, `[contact email]`, `[minimum age]`,
  `[jurisdiction]`, `[courts or arbitration]` and the liability-cap wording.
- Decide the actual retention windows (especially activity events and DB backups)
  and whether a pruning job is needed before public traffic.
- Confirm the processor list (SES sender/domain, hosting region, model provider
  terms) and whether a data processing agreement is required.
- Confirm the age gate and any jurisdiction-specific consumer/privacy wording.
- Remove the draft banner and the "unreviewed" status only after that review.
