# Record formats

All persisted business records use `version: 1`; unknown versions/fields are rejected. Inspect current machine-readable contracts with `applykit schema profile|company|job|draft|packet`. IDs use letters, digits, underscores, and hyphens, up to 100 characters. Inputs and outputs are UTF-8. Private JSON writes are atomic and mutations use a workspace lock.

## Profile and sources

`examples/profile.json` is a complete fictional profile. Each `facts` entry has `id`, `kind`, `text`, and `verified`. Kinds are `summary`, `skill`, `strength`, `availability`, `experience`, `project`, `education`, `achievement`, and `language`. Entries retain their verified wording and selection order within the original section sequence: Professional Summary, Technical Skills, Core Strengths, Professional Experience, Key Projects, Education, and optional Languages. `availability` appears in the resume's second centered contact line; achievements appear with Core Strengths. Empty sections are omitted.

Optional typed fields preserve the original scripts' structure without guessing facts:

- `skill`: `text` contains the skills; `label` supplies the bold category.
- `experience`: `text` is the job title/employer heading; `dates`, `context`, and `bullets` provide the right-aligned dates, italic context line, and responsibilities. Legacy newline-separated text is preserved as heading plus body lines, including when additional explicit bullets exist.
- `project`: `text` is the project name; `url`, `description`, and `technologies` supply its link, explanation, and italic stack.
- `education`: `text` is the qualification; `details` holds institution/date/completion status and `description` holds the explanation. Preserve incomplete education explicitly.

All fields of a fact share its verification flag and are included in evidence and approval fingerprints. Extra fields belonging to a different kind are rejected. Flat version-1 facts remain valid. The toolkit checks references and placeholders throughout structured fields but cannot establish factual truth automatically.

Import a corrected profile JSON and explicitly confirm facts. Text/JavaScript imports are saved as private unverified source records with filename, import timestamp, and content; they are never run. Preserve uncertainty about incomplete education or conflicting titles until the applicant resolves it.

## Companies and jobs

Company: `version`, `id`, `name`, optional `careersUrl`, `sourceUrl`, `verifiedAt`, `recruitmentEmail`, and `notes`. A recruitment email requires a source URL and verification timestamp. CSV imports use those same column names except `version`, which is supplied by the importer. Empty optional columns are omitted.

Job: `version`, `id`, `companyId`, `title`, `url`, `description`, `sourceUrl`, `verifiedAt`, optional `location`. Verification timestamps are ISO 8601 UTC. A company may exist before its jobs are known. Research should update existing IDs rather than creating duplicates.

## Draft

A private application draft selects `factIds` and contains a `headline`, an explicit `date` (`YYYY-MM-DD`), an optional `summary`, `coverLetter`, and `email`. Optional `recipient` contains a known `hiringManager` and `addressLines`; company name comes from the company record. Unknown names/addresses are omitted, with a Hiring Team greeting, instead of rendering placeholders.

Every summary/body paragraph is `{ "text": "…", "evidence": ["verified-fact-id"] }`. Evidence must refer to selected, verified facts. `email` has `subject` and `paragraphs`. Letter and email greetings/sign-offs are added by the renderer. Use `application update --draft` to validate imports; build new documents after changes.

Cover-letter prose should follow the original four-part structure: opening, relevant delivery, transferable capabilities/adaptability, and invitation to discuss the role. Explain specific supported tasks and how they relate to the posting. Do not promote the candidate to the posting's seniority or claim a requested technology from experience with a similar one. For example, verified Node.js API and PostgreSQL work supports a discussion of transferable API/data fundamentals for learning a Python backend; it does not verify Python experience. Evidence IDs are traceability, not semantic proof of a paraphrase. Human review remains required.

Builds use the original US Letter layouts. An optional `warnings` array records font fallback; when Calibri files are absent, PDF uses Carlito while DOCX retains the original Calibri font request. Provide the four licensed faces through `APPLYKIT_FONT_DIR` for matching font rendering. Layout changes take effect on a new build and its new approval fingerprint; existing artifact revisions remain untouched.

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

## Profile revisions and claim review

`profile-history/<revision>.json` contains `{ version: 1, id, at, reason, profile }`. The active profile remains `profile.json`. Existing imports require a preview digest bound to the current profile, incoming input, merge/replace mode, and verification choice. The digest is recomputed before saving.

Fact provenance is additive to v1 records: `sources` holds `{ reference, note? }` entries, `verification` holds `{ at, method, note? }`, and `conflicts` holds `{ field, alternatives, resolved? }` entries. Verification methods are `user-confirmation`, `reviewed-import`, or `legacy`. Old verified facts remain readable without fabricated source information. Unresolved conflicts block verification and selection.

`applications/<id>/claims.json` stores `{ digest, at, note }` after explicit claim verification. The digest binds the full profile, draft, and claim review. This attestation does not authorize submission. Batch review JSON includes each claim, its evidence, heuristic flags, and the claim attestation when present. Its HTML counterpart is a private, read-only view with relative document links.

Jobs optionally include `status`, `deadline`, and `closedAt`. Applications optionally include `followUpAt` and `trackingNote`. Builds optionally include `wordPages`; independent Word preview PDFs are included in `files` and integrity checks. These additions preserve existing version 1 records. Workspace configuration uses optional `schemaVersion: 2` to record the completed additive upgrade.

## Recovery boundaries

Under the workspace lock, writes are staged and reads see staged values. A checkpoint durably writes `.transaction.json` before replaying its records with atomic file replacement. Recovery is idempotent. Reads outside a transaction reject an unfinished journal until recovery. Errors before the first checkpoint discard staged changes. A journal that failed during replay must be recovered before further mutations.

Application execution checkpoints the attempt snapshot and `commit-started` event before account registration or submission. It checkpoints successful commits before continuing. No storage transaction can roll back an external action. An interrupted action with no verified outcome remains uncertain.

Encrypted `.applykit` archives contain versioned, hashed file entries encrypted using AES-256-GCM, a random 16-byte salt, a 12-byte IV, and a 32-byte key derived with scrypt (`N=32768`, `r=8`, `p=1`). Runtime directories, hidden files, locks, journals, and browser sessions are excluded. Restore validates paths and hashes before committing files, revokes batch approvals, and preserves reconciliation requirements. Vault records are references only; back up Bitwarden separately.
