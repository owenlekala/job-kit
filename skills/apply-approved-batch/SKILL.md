---
name: apply-approved-batch
description: Run a user-approved Job Application Kit batch through the local portal browser, pausing for verification and reconciling uncertain outcomes without blind retries.
---

# Apply an approved batch

Read the batch's complete private review packet and confirm the user explicitly approved its exact jobs, documents, answers, destinations, and any portal signup. General intent to find jobs or generate resumes is not batch approval. Never manufacture approval or reuse approval for changed content.

After explicit approval, run `applykit batch approve <id> --digest <approved-review-digest> --confirm`, then `batch run <id>`. The kit validates source/document hashes before every action and checks the filled form before commits. Keep Bitwarden unlocked in the bridge's terminal environment; credentials are injected without returning their values to the agent. Do not ask the user to paste passwords, MFA secrets, or session keys into chat.

For `handoff`, tell the user the saved step and required action. They handle CAPTCHA, email verification, MFA, and unsupported form interactions in the visible browser. Inspect the page again, confirm all manual answers match the packet, then use `application resume <id> --batch <id>` when authorized. New answers or changed plans require update, rebuild, a new review, and new approval.

If the temporary session expired, `application resume --restart` can replay only reversible preparation before any commit attempt. After completed registration, revise the packet to log in to the existing account, rebuild, and obtain new approval rather than replaying signup. There is no promise of unattended completion on every website.

For `uncertain`, do not retry. Inspect the portal and obtain confirmation evidence. Only after determining the actual outcome use `application reconcile <id> --outcome submitted|registered|not-submitted --evidence <observed-evidence>`. `not-submitted` explicitly permits another attempt and must be supported by the user's verification. Never infer failure merely from a timeout. Existing submitted applications are skipped.

Report confirmed submissions, handoffs, and uncertain outcomes separately. Confirmation selectors are automation evidence, not proof of receipt beyond what the portal displays. Run `browser close` when finished. No email is sent by this workflow.
