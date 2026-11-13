# Record formats

All persisted business records use `version: 1`; unknown versions/fields are rejected. Inspect current machine-readable contracts with `applykit schema profile|company|job|draft|packet`. IDs use letters, digits, underscores, and hyphens, up to 100 characters. Inputs and outputs are UTF-8. Private JSON writes are atomic and mutations use a workspace lock.

## Profile and sources

`examples/profile.json` is a complete fictional profile. Each `facts` entry has `id`, `kind`, `text`, and `verified`. Kinds are `summary`, `skill`, `experience`, `project`, `education`, `achievement`, and `language`. Resume facts render exactly as supplied, in the selected order within their sections. The toolkit checks evidence IDs and placeholders but cannot establish factual truth automatically.

Import a corrected profile JSON and explicitly confirm facts. Text/JavaScript imports are saved as private unverified source records with filename, import timestamp, and content; they are never run. Preserve uncertainty about incomplete education or conflicting titles until the applicant resolves it.

## Companies and jobs

Company: `version`, `id`, `name`, optional `careersUrl`, `sourceUrl`, `verifiedAt`, `recruitmentEmail`, and `notes`. A recruitment email requires a source URL and verification timestamp. CSV imports use those same column names except `version`, which is supplied by the importer. Empty optional columns are omitted.

Job: `version`, `id`, `companyId`, `title`, `url`, `description`, `sourceUrl`, `verifiedAt`, optional `location`. Verification timestamps are ISO 8601 UTC. A company may exist before its jobs are known. Research should update existing IDs rather than creating duplicates.

## Draft

A private application draft selects `factIds` and contains a `headline`, an explicit `date` (`YYYY-MM-DD`), an optional `summary`, `coverLetter`, and `email`.

Every summary/body paragraph is `{ "text": "…", "evidence": ["verified-fact-id"] }`. Evidence must refer to selected, verified facts. `email` has `subject` and `paragraphs`. Letter and email greetings/sign-offs are added by the renderer. Use `application update --draft` to validate imports; build new documents after changes.

## Portal packet

This fictional one-page plan illustrates the contract. It contains no password values; adapt selectors and answers to the real portal and obtain review before execution.

```json
{
  "version": 1,
  "applicationId": "application-one",
  "destination": "https://careers.example.org/apply",
  "allowedOrigins": ["https://careers.example.org"],
  "accountIds": [],
  "answers": {
    "fullName": "Alex Morgan",
    "email": "alex.jobs@example.com",
    "consent": true
  },
  "steps": [
    { "action": "navigate", "url": "https://careers.example.org/apply" },
    { "action": "fill", "selector": "#name", "answer": "fullName" },
    { "action": "fill", "selector": "#email", "answer": "email" },
    { "action": "check", "selector": "#consent", "answer": "consent" },
    { "action": "upload", "selector": "#resume", "document": "resume.pdf" },
    {
      "action": "submit",
      "selector": "#submit",
      "checks": [
        { "selector": "#name", "answer": "fullName" },
        { "selector": "#email", "answer": "email" },
        { "selector": "#consent", "answer": "consent" },
        { "selector": "#resume", "document": "resume.pdf" }
      ],
      "confirmationSelector": "#confirmation",
      "confirmationText": "Application received"
    }
  ]
}
```

`allowedOrigins` are exact HTTP(S) origins without trailing slashes or paths. HTTPS is required, except localhost fixture HTTP explicitly enabled by `init --allow-localhost`. Include all required portal API/asset origins in the review; unrelated analytics may remain blocked.

Available actions:

- `navigate`: reviewed URL.
- `fill`, `check`, `select`: CSS selector and an answer key. Text/select values are strings; checkbox values are booleans.
- `upload`: CSS selector and `resume.pdf`, `resume.docx`, `cover-letter.pdf`, or `cover-letter.docx`.
- `credential`: selector, `accountId`, and `credential` set to `email` or `password`. The account must appear in `accountIds`. No literal secret is allowed.
- `click`: ordinary navigation. Native submit buttons and mutating requests are blocked.
- `login`: explicitly reviewed authentication action; it may send a form request.
- `wait`: selector and optional `confirmationText`.
- `handoff`: a message explaining the manual step. Progress pauses after this step; resume continues at the next step.
- `register` and `submit`: selector, nonempty `checks`, `confirmationSelector`, and optional `confirmationText`. Checks identify an answer key or uploaded document. List every non-secret populated/required field in the current form. Form values must match; attachment bytes are hashed, not merely matched by filename.

Application submission occurs at most once and must be the final step. An exploration plan may end with `handoff` instead, preserving progress for additional research and a new review. Empty plans can be built/reviewed as documents but cannot execute.

The driver uses one top-level page per application. Cross-origin redirects need explicit origins; popups close automatically. Iframes and portal-specific custom widgets may need a manual handoff or a future dedicated adapter. Missing fields, invalid forms, and selector changes stop the workflow.

## Approval, progress, and recovery

A batch review includes source profile/job/company records, tailored draft, portal plan, account references, and the artifact revision and hashes. Approval records the reviewed fingerprint for each application. Any change to those inputs invalidates it. A new build resets reversible progress and requires a new review.

Before register/submit, the kit saves a private attempt snapshot and a `commit-started` event. If confirmation cannot be verified or the process exits during the commit, the result is uncertain. No automatic retry occurs. Reconciliation requires observed evidence and a matching outcome; registration cannot be reconciled as a submitted application.

Temporary browser state is not saved for restart. Reversible preparation can be explicitly restarted before any commit. Once an account has been created, use a revised plan that logs in rather than repeating registration. All source snapshots and artifact revisions are retained so later profile/job edits do not erase what was submitted.
