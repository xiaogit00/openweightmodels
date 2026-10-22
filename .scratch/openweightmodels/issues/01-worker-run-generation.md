# 01: Run a scheduled Challenger through the worker

**What to build:** A scheduled Comparison's queued Challenger Runs are processed without manual intervention. Each Run moves through Queued → Calling API → Generating → Done, persists its Response, and emits live status. A failed Run can be Retried or Skipped, or is auto-skipped after 24 hours. When every Run in the Job is Done or Skipped, the Job and Comparison become Ready and the Author receives an in-app notification.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A worker process starts from the documented development command and consumes the generation queue.
- [ ] A queued Run calls the mock provider, persists streamed content, token count and latency, and reaches Done.
- [ ] Job and Comparison become Ready only when every Run in that Job is Done or Skipped.
- [ ] A forced mock failure produces Failed with an error; Retry increments the attempt and succeeds; Skip settles the Run.
- [ ] A failed Run left untouched is auto-skipped after the configured 24-hour delay.
- [ ] Job events are persisted and emitted for Calling, Generating, Done/Failed and Job Ready.
- [ ] The Author receives one in-app job-ready notification when the Job settles.
- [ ] No duplicate Response row or duplicate notification is created by retries or concurrent completion.
