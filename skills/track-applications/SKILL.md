---
name: track-applications
description: Inspect and update Job Application Kit application outcomes while preserving submitted documents, approval history, and confirmation evidence.
---

# Track applications

Run `applykit application status` or `application status <id>`. Read the selected private application and event history as needed. Do not expose account credentials or mix one applicant's workspace with another's.

Summarize active preparations, reviews, approvals, handoffs, confirmed submissions, interviews, rejections, withdrawals, and uncertain outcomes. A prepared file is not a submitted application; a clicked button is not confirmation.

Record a known outcome using `application status <id> --set interview|rejected|withdrawn --evidence <user-provided-or-observed-evidence>`. Updates require a submitted/interviewing application. For uncertain browser commits, inspect and reconcile the actual result using the approved-batch workflow; never mark a timeout as failure or blindly resubmit.

Preserve prior artifact revisions, submitted answers, review packets, and events. Tailoring another role creates a new application rather than overwriting submitted material. Draft follow-up text only when requested; this skill does not send messages or schedule recurring research.

Record a requested follow-up date and private note with `application track <id> --follow-up YYYY-MM-DD --note <text>`. Filter with `application status --state submitted --follow-up-before YYYY-MM-DD`. Dates are local planning data and do not send reminders or messages.

For backups, guide the user to `workspace backup <file.applykit>`. The terminal asks for an encryption passphrase without echoing it. Never request or handle that passphrase in chat. Restore into a new workspace using `--workspace <new-directory> workspace restore <file.applykit> --confirm`; the user enters the passphrase locally. Restored approvals are revoked and uncertain commits still require reconciliation. `workspace recover` completes interrupted local record transactions; `workspace migrate` validates and upgrades older storage metadata.
