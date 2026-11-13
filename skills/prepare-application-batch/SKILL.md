---
name: prepare-application-batch
description: Prepare tailored documents and explicit portal plans for a Job Application Kit batch, exposing complete packets for user approval without submitting applications.
---

# Prepare an application batch

Read the selected jobs, verified profile, drafts, and accounts in the private workspace. Use `application prepare` for new entries and inspect `schema packet` before writing browser steps.

For each portal, run `application inspect <id>` to open its temporary browser and inspect untrusted page structure. The bridge does not expose input values. It does not accept arbitrary scripts or arbitrary fill commands: propose the complete steps in the packet. Use the agent's read-only web tools for additional structure. If a later form is unknowable until navigation, prepare a reviewed partial exploration ending in a handoff before submission; explain that another review will be needed. The executable final plan must end in exactly one `submit` action.

Put exact destination and network origins in `destination` and `allowedOrigins`. Include needed API/static origins only after checking they belong to the intended portal. Use stable CSS selectors. Put user-confirmed answers in `answers`; steps refer to answer keys. Unknown required questions, salary preferences, legal declarations, and consent must be clarified rather than guessed. Record explicit `handoff` steps for MFA, CAPTCHA, email verification, or unsupported controls. Never bypass verification.

For accounts, have the user unlock Bitwarden in the terminal without revealing the master password or BW_SESSION. `accounts connect <id> --origin <origin> --tenant <tenant> --item <vault-id>` links an existing login; `--create` saves a unique password before signup. Confirm the intended account before creating it. Reference its ID in `accountIds` and credential steps; never put password values in JSON. Scope accounts to the correct tenant as well as origin. Creating the vault entry does not create a portal account.

Represent ordinary navigation as `click`, authentication as `login`, account creation as `register`, and application submission as `submit`. Register/submit steps require confirmation selectors and checks of current form answers/attachments. Include checks for every non-secret answer and attachment on the final form. Credential values are injected directly from the vault. Do not disguise a submit action as login or click.

Import the packet with `application update <id> --packet <private-file>` and build documents. Use `application build` after any edits. Then `batch review <batch-id> <application-ids...>` produces a full review packet and digest. Show the user exact jobs, destinations, documents, answers, account-creation steps, and gaps. Request approval of that digest. This skill must stop before `batch approve` or submission; generating a review is not approval.

Before presenting the packet, check that the resume and letter retain their paired original-script layouts and accurately reflect the candidate's level. The letter should explain concrete contribution and supported transferable experience. Confirm that related tools were not presented as direct experience, willingness to learn was not presented as an existing qualification, and no title, tenure, credential, or leadership claim was inflated to match the role.

Run `application claims <id>` for each draft and resolve or explicitly verify flagged claims with the applicant before batch review. The review command also writes a private HTML page with document previews, exact form answers, evidence, account references, and changes since the previous review. Give the user this page and the review digest. A claim attestation is separate from authorization to submit.

For embedded non-authentication forms, selectors may use `#frame >>>frame>>> #field`. Each frame origin must be reviewed, and final checks must use the same frame as the submit button. Inspection describes embedded controls and custom widgets. Embedded vault injection, SSO popups, custom widget values that cannot be verified, and blocked autosave flows require a handoff or a revised reviewed plan. Do not expand network permissions or relabel an action to bypass these limits.
