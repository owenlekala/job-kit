# Job Application Kit

A local-first job-search toolkit for Codex, Claude Code, and Cursor. Keep a verified profile, discover companies, tailor application documents, review a batch, and apply through a temporary browser. Your coding agent supplies the writing and research; the toolkit needs no additional AI API key.

## Install

Requires Git and Node.js 24 or later. Clone this repository, enter its directory, and run:

```sh
sh setup.sh --agent all
```

On native Windows, use PowerShell:

```powershell
.\setup.ps1 --agent all
```

Setup installs locked npm dependencies, builds the CLI, detects an installed browser, initializes private storage, and installs seven project skills. It does not download a browser. Choose `codex`, `claude`, or `cursor` instead of `all` if preferred. Setup does not install or log in to Bitwarden.

PDF rendering and portal automation share browser detection on macOS, Windows, and Linux. A compatible system default is preferred, followed by installed Chrome, Brave, Edge, Chromium, or Vivaldi, then an existing Playwright Chromium installation. Safari and regular Firefox are incompatible with the PDF workflow; a compatible installed browser is used instead. Browsers launch with a temporary isolated profile, without your personal cookies or saved logins.

For a custom installation or another Chromium-based browser, set `APPLYKIT_BROWSER_PATH` to its absolute executable path before setup and when running the CLI. On macOS, this is the binary inside the app, for example `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`. An invalid explicit path fails with an error instead of silently choosing another browser. `applykit doctor` reports the selected browser.

If no compatible browser is installed, install one or explicitly run `npx playwright install chromium`. On Linux, Playwright Chromium may require system libraries; `npx playwright install --with-deps chromium` installs those too and may require administrator permission.

Use `node dist/cli/index.js <command>` from this directory. Optionally run `npm link` once to expose the shorter `applykit` command used below. On restricted machines, keep using the Node entrypoint instead of linking globally. `npm run dev -- <command>` runs from source.

```sh
applykit --help
applykit doctor
applykit init --interactive
```

Setup can be rerun without replacing profile data or changed skills. It installs missing skill folders, preserves all existing copies, and reports their paths in `skipped`. To update installed skills, review the differences against `skills/` before running `node dist/cli/index.js skills install --agent all --target . --overwrite`. Direct `skills install` still rejects differing copies by default; use `--skip-existing` to preserve them, or `--overwrite` to replace reviewed copies. These two options cannot be combined. Use `--skip-browser` for document-free setup checks; it skips browser validation, and rendering or portal automation still requires a compatible browser.

## Your private workspace

Data lives outside the repository:

- macOS: `~/Library/Application Support/job-application-kit`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/job-application-kit`
- Windows: `%LOCALAPPDATA%\job-application-kit`

`applykit init` reports the exact directory. Use `APPLYKIT_HOME` or the global `--workspace <directory>` option for another location, including separate demo workspaces. Keep it outside Git. Unix directories/files use owner-only permissions; Windows relies on the access controls of your user-data directory.

The workspace contains versioned profile/company/job JSON, private notes, role presets, application drafts/plans, document revisions, full review packets, event histories, and snapshots taken before irreversible browser actions. Back up this directory securely. Bitwarden backups are separate; portal passwords are never included in workspace exports.

Concurrent mutations use a heartbeat lock; a lock abandoned by a crashed process expires after 30 seconds. Retry after that interval rather than deleting an active lock.

## Create and verify a profile

### Fill in a Markdown file instead of terminal prompts

Use [the profile questionnaire](templates/profile-notes-template.md) to enter your information in your editor: contact details, job preferences, experience, projects, skills, education, certifications, languages, and supporting sources. Keep your completed copy in your private workspace, outside the repository. On macOS, a suitable location is `~/Library/Application Support/job-application-kit/profile-notes.md`. Leave unknown details blank and duplicate sections for additional entries.

Then tell your agent: "Read my profile-notes.md, prepare my profile, and show me what needs confirmation before importing it." You do not need to type CLI commands yourself; the agent can handle conversion, import, and validation. Markdown is source notes until it is converted into profile JSON and imported. The agent must obtain your confirmation before verifying facts, and profile setup does not authorize submitting applications. Existing profiles require a reviewed change preview before updating them.

Interactive entry remains available through `init --interactive` or `profile edit`. Work arrangements accept mixed case, such as `Remote, hybrid, onsite`; stored values use lowercase.

### Import structured profile JSON

The files under `examples/` describe a **fictional applicant and employer**. Use them only for learning and offline document demos. Replace their contents with your own verified information before preparing real applications.

```sh
applykit profile import /path/to/my-profile.json
applykit profile validate
applykit profile verify experience-one project-one education-one --confirm
```

Inspect formats with `applykit schema profile`. Imports clear verification flags by default. `profile import <file> --confirm` preserves verification flags only when you explicitly attest you reviewed them.

Markdown and JavaScript imports are stored as **unverified notes**, without executing code. An agent can extract proposed facts into profile JSON; you then resolve conflicting titles, dates, metrics, and education status before confirming them. Your original personal files do not need to enter this repository.

Create reusable role selections from verified facts:

```sh
applykit presets save backend --name "Backend Engineer" --facts backend,delivery,project
applykit presets list
```

Facts support any profession. The software-engineering examples are not built-in eligibility rules. Structured fields preserve the original document blocks: a skill `label`; experience `dates`, `context`, and `bullets`; project `url`, `technologies`, and `description`; education `details` and `description`. The `text` field supplies the entry heading or primary content. `strength` and `availability` facts supply Core Strengths and the centered availability line. Existing flat facts still render without inventing missing details. Correcting any factual field requires updating and re-verifying the profile.

## Add companies and jobs

```sh
applykit companies import /path/to/companies.csv
applykit companies import --id acme --name "Acme" --careers-url https://careers.example.org
applykit jobs add /path/to/job.json
applykit companies list
applykit jobs list
```

CSV columns match company JSON fields; unknown optional values stay empty. Job records include the description, original source URL, and verification time. Use the research skill to discover current openings through your agent's web tools when requested. The kit does not run background searches. Do not guess recruitment email addresses.

## Tailor and build documents

```sh
applykit application prepare job-one --id acme-backend --preset backend
applykit application update acme-backend --draft /private/path/tailored-draft.json
applykit application build acme-backend
```

Preparation reports the private `draft.json` and `packet.json` paths. `--facts <comma-separated-ids>` is an alternative to a preset; without either, all verified facts are selected. The initial letter/email are factual starting points: tailor and review them before use.

`schema draft` shows the content contract. A draft selects verified fact IDs and can add a summary, cover-letter paragraphs, and email paragraphs with supporting evidence IDs. Evidence references establish traceability; a human still needs to verify that paraphrases are accurate. Use the intended local application date explicitly when needed.

Each build writes a new revision containing:

- `resume.md`, `resume.docx`, and `resume.pdf`
- `cover-letter.md`, `cover-letter.docx`, and `cover-letter.pdf`
- `email.md` (a draft only; never sent automatically)

All outputs use the same validated content model. The paired templates preserve the original `resume_build.js` and `cover_letter.js` design and file structure: US Letter paper, Calibri, navy/blue/gray colors, centered uppercase names, one contact/link row, original paragraph spacing, and document-specific margins. The resume uses a 20-point name, ruled 11-point section headings, labelled skill rows, dated job headers, project links/technology, and structured education. The cover letter uses an 18-point name, 11-point body, date/recipient block, four-part body, and separate closing/name paragraphs. Empty resume sections and unknown recipient details are omitted.

The letter explains what the candidate can do, connects verified work to the role, and distinguishes direct experience from transferable foundations and skills to learn. Neither drafts nor skills should inflate seniority, credentials, expertise, tenure, or leadership scope to match a posting. The initial draft is a conservative starting point; the writing skill supplies the final tailored explanation and the applicant reviews it.

Word always requests Calibri. PDF embeds locally available Calibri regular/bold/italic/bold italic faces. To supply your licensed fonts, set `APPLYKIT_FONT_DIR` to their directory before building (standard filenames such as `calibri.ttf`, `calibrib.ttf`, `calibrii.ttf`, and `calibriz.ttf` are recognized). If Calibri is unavailable, PDF embeds metric-compatible Carlito and records a build warning; it does not silently claim exact font fidelity. Invalid explicitly configured fonts fail the build. Browser and Word engines can still paginate differently. Review every page in both formats. Targets are two resume pages and one cover-letter page; overflow blocks approval until content is shortened or you explicitly use `application build --allow-overflow` after reviewing it. Nothing is silently dropped.

The corresponding template modules are `src/adapters/documents/resume_build.ts` and `cover_letter.ts`; shared style values live in `theme.ts`, and the PDF stylesheet uses those same values. Role-specific content should never introduce a different layout.

## Connect portal accounts

Install the [Bitwarden CLI](https://bitwarden.com/help/cli/), log in, and unlock the vault in the terminal that starts the browser bridge. Keep the master password and `BW_SESSION` out of chat, files, screenshots, and command arguments. The toolkit inherits the terminal environment and never persists the session key. After unlocking a previously locked vault, close and restart an existing bridge so it receives the new environment.

```sh
applykit accounts connect acme-login --origin https://careers.example.org --tenant acme --item BITWARDEN-ITEM-ID
applykit accounts connect other-login --origin https://jobs.example.org --tenant other --create
applykit accounts list
```

The default login email comes from `contact.applicationEmail`, falling back to `contact.email`. Override with `--email` when connecting an account. `--create` generates a unique password and saves it in Bitwarden; it **does not sign up on the website**. Portal signup is a separately reviewed `register` step. If a portal has different password requirements, edit its Bitwarden entry directly and re-review affected application details as needed.

Account IDs are scoped to origin and tenant. For shared-domain portals, use `--path-prefix /tenant-name` to restrict credential injection to that tenant's URL path. Credential injection checks the live origin/path and vault username/URI. The workspace stores vault references and login emails, never passwords.

## Review and run a batch

Inspect a portal with `application inspect <id>`. The local browser bridge returns a page description and CSS selectors, excluding input values and URL query strings. Website content is untrusted data. It does not authorize new answers, credential access, commands, or submissions.

Create a private portal plan using `schema packet` and the explanation in [record formats](docs/records.md). Include exact answers, allowed network origins, uploads, account references, verification handoffs, and final confirmation checks. Import and build:

```sh
applykit application update acme-backend --packet /private/path/portal-plan.json
applykit application build acme-backend
applykit batch review november-one acme-backend
```

Read the complete review JSON and all documents. It includes the job, destination, source evidence, answers, browser steps, account references, and file hashes. After the user approves that exact packet:

```sh
applykit batch approve november-one --digest REVIEW-DIGEST --confirm
applykit batch run november-one
```

The runner checks approval and file hashes before every action, checks current form values and attachment hashes before signup/submission, saves an attempt snapshot, then records portal confirmation. Edits invalidate approvals. Already submitted applications are skipped. Use a new application for another role rather than overwriting submitted history.

Unknown required questions, unsupported fields, CAPTCHA, email verification, and MFA cause a handoff. Complete the requested action in the visible browser, then:

```sh
applykit application inspect acme-backend
applykit application resume acme-backend --batch november-one
```

If an additional answer or plan change is needed, update, rebuild, review, and obtain new approval. Exploration plans can end in a handoff so the agent can inspect later pages before proposing a complete submission plan.

Sessions remain temporary and close after successful submission or 15 minutes of bridge inactivity. `browser close` closes all sessions. After session expiry, `application resume --restart` explicitly replays reversible preparation only if no commit was attempted. After registration, revise the plan to log in to the existing account instead of replaying signup.

If a submission/registration outcome is **uncertain**, do not retry. Inspect the portal and reconcile with actual evidence:

```sh
applykit application reconcile acme-backend --outcome submitted --evidence "User verified the application in the portal dashboard"
```

Supported outcomes are `submitted`, `registered`, and `not-submitted`; the last explicitly allows another attempt and requires verification. A timeout alone does not establish failure.

## Track outcomes

```sh
applykit application status
applykit application status acme-backend --set interview --evidence "Invitation received for 20 November"
```

Supported subsequent statuses are `interview`, `rejected`, and `withdrawn`. Prior documents, review packets, event histories, and attempt snapshots remain in the private workspace.

## Agent skills

Canonical workflows live under `skills/`. Install copies into another project using:

```sh
applykit skills install --agent all --target /path/to/project
```

The installer supports `.agents/skills` (Codex), `.claude/skills` (Claude Code), and `.cursor/skills` (Cursor). Use the seven skills to set up a profile, discover companies/jobs, tailor a resume, write a cover letter, prepare a batch, apply an explicitly approved batch, and track outcomes. Skills provide writing/research instructions; deterministic commands perform validation and browser operations. No direct AI-provider integration is included.

## Architecture and verification

`domain` contains schemas and pure content/approval policies. `application` contains use cases, runner orchestration, and injected ports. `adapters` implement private storage, document rendering, Bitwarden, skill installation, and Playwright. `cli` is the composition root. Domain code never reads files, launches a browser, or contacts a vault; application code never imports concrete adapters.

```sh
npm run check
npm run build
npm test
npm run format:check
npm run privacy
```

Tests use fictional profiles, an in-memory vault, and local fixture portals. They cover imports, document extraction/links, account creation/login, uploads, branching forms, handoffs, changed approvals, session loss, and uncertain outcomes. GitHub Actions runs the suite and native setup wrappers on Windows, macOS, and Linux. Live portal variations still need user-supervised validation; fixture success does not establish universal portal compatibility.

## Trust boundaries and limitations

This is a single-user local toolkit, not a sandbox for an untrusted coding agent or local process. Anyone who can alter the private workspace can alter its records. The explicit human-approval step is enforced by workflow instructions plus content fingerprints, not by a separate human identity service.

The bridge binds only to loopback, requires a random token, rejects browser-origin requests, and offers no arbitrary JavaScript execution or free-form credential retrieval. Tokens are stored only in private runtime metadata. Browser network access is restricted to reviewed origins; normal clicks cannot silently POST a form. Some sites need extra API/static origins, autosave requests, iframes, popups, SSO, custom widgets, or consent handling that the generic driver does not support. Pause and hand off rather than claiming success or bypassing protections. There is no CAPTCHA bypass, automatic inbox access, email sending, or guarantee of unattended application completion.

The privacy check catches common tracked-secret/generated-file mistakes. It is not a substitute for inspecting `git diff --cached` before sharing. Your existing resume, cover-letter script, and personal notes remain outside this repository.

## Safe profile changes and provenance

Use `applykit profile edit` for guided entry of identity, preferences, links, experience, projects, skills, and education. Edited facts become unverified. The editor shows a change preview and requires a save decision. `init --interactive` refuses to replace an existing profile.

Existing profiles require a preview before an import can replace or merge data:

```sh
applykit profile import /private/path/profile.json --mode merge --preview
applykit profile import /private/path/profile.json --mode merge --review-digest PREVIEW-DIGEST
applykit profile history
applykit profile restore PROFILE-REVISION --preview
applykit profile restore PROFILE-REVISION --review-digest PREVIEW-DIGEST
```

A merge retains facts whose IDs are absent from the incoming file; incoming identity and preference fields replace their counterparts. Use `--mode replace` for a complete replacement. Imports clear incoming verification flags unless `--confirm` is explicitly supplied to both the preview and save commands. The digest binds the input, current profile, mode, and verification choice. Any intervening edit requires a new preview. Each saved profile and verification change retains a recoverable revision.

Facts can include `sources: [{ "reference": "source-id-or-document", "note": "What this supports" }]`, a verification record, and `conflicts: [{ "field": "education status", "alternatives": ["completed", "incomplete"], "resolved": "Applicant confirmed incomplete" }]`. Sources are references, not credentials or proof of truth. Update the actual fact to match its confirmed resolution. Unresolved conflicts block verification and document use. `profile verify <ids...> --confirm --note "How this was verified"` records the confirmation date and method. `profile validate` reports missing sources and legacy verification metadata.

## Professional wording and claim review

All document formats use professional, direct wording. Em dashes in rendered content are rejected with an actionable error. Use a comma, colon, or separate sentence. Source notes are preserved as supplied; edit and verify the facts selected for output.

```sh
applykit application claims APPLICATION-ID
applykit application claims APPLICATION-ID --confirm --digest CLAIM-DIGEST --note "Evidence reviewed with the applicant"
```

The review places each proposed paragraph beside its referenced verified facts. It flags common unsupported seniority, tenure, qualifications, metrics, and technology claims, plus a changed professional headline. These are conservative review prompts, not a semantic truth detector. Revise unsupported statements. Explicit applicant confirmation can attest to a flagged claim using the exact current digest and an explanation. Profile or draft edits invalidate that attestation. Full batch review is still required even when no flags are reported.

`batch review` writes a private HTML page alongside its JSON packet. Open the reported `reviewPage` in your browser to inspect document links and document previews, form answers, destinations, evidence, account references, page counts, and changes from the previous review. The page contains private information and stays in the private workspace. Embedded HTML previews show the shared document layout without requiring a browser PDF plugin. Use the PDF and Word links to inspect exact pagination. It cannot approve or submit applications. The terminal approval remains bound to the complete review digest.

## Demo and independent Word layout checks

Run `applykit demo` to generate a complete fictional document set in a new temporary workspace. Your real profile is untouched. The command reports the workspace and artifact directories. Temporary demo files remain available for inspection until you remove them or the operating system clears temporary storage.

To check Word pagination separately, install LibreOffice and run:

```sh
applykit application build APPLICATION-ID --check-word
```

If `soffice` is not on your PATH, set `APPLYKIT_SOFFICE` to its executable path. This generates `resume.word-preview.pdf` and `cover-letter.word-preview.pdf`, records independent page counts, and applies the same overflow limits to both rendering paths. Conversion is optional and limited to 60 seconds. The preview measures LibreOffice layout; inspect the DOCX in your intended Word application as well. A normal build explicitly reports when Word pagination has not been checked.

## Workspace recovery and encrypted backups

CLI record updates use a durable transaction journal. A failed operation before commit leaves its staged changes unsaved. An interrupted committed journal is replayed under the workspace lock. `applykit workspace recover` explicitly performs this recovery. Submission attempts are checkpointed before an irreversible browser action so a crash cannot erase the uncertainty record. Browser actions themselves cannot be rolled back.

```sh
applykit workspace migrate
applykit workspace backup /private/backup/location/job-search.applykit
applykit --workspace /private/new-workspace workspace restore /private/backup/location/job-search.applykit --confirm
```

The migration validates portable records and upgrades older workspace metadata without discarding legacy facts. Backup prompts locally for a passphrase of at least 12 characters and encrypts the archive with AES-256-GCM and a scrypt-derived key. Keep the passphrase separately. It is not accepted in command arguments or printed. Backups are limited to 256 MB of workspace file content, reject symbolic links, and exclude runtime sessions, locks, and journals. Existing destination files are never overwritten. Bitwarden backups remain separate.

Restore requires a new workspace, verifies archive integrity, and revokes saved batch approvals. Applications interrupted during an irreversible action remain uncertain. Other active applications return to preparation. Rebuild, review, and approve before automation. Review packets may contain old absolute paths for historical reference; create a new review for current document links.

## Job lifecycle and follow-up planning

```sh
applykit jobs list --status open --query backend
applykit jobs list --company COMPANY-ID --due-before 2026-12-01
applykit jobs update JOB-ID --deadline 2026-12-01
applykit jobs update JOB-ID --status closed
applykit application track APPLICATION-ID --follow-up 2026-12-08 --note "Check for a response"
applykit application status --state submitted --follow-up-before 2026-12-08
```

Duplicate detection removes common tracking parameters from URLs while preserving requisition identifiers. It also flags matching company/title/location records. Closed jobs and jobs past their recorded deadline are blocked from preparation and approval checks. Follow-up dates and notes provide planning support; they do not send messages or create scheduled reminders.

Embedded non-authentication form fields can use a reviewed selector such as `#application-frame >>>frame>>> #name`. Each frame origin must be allowed, and final form checks must belong to the submit button's frame. Inspection reports embedded fields and custom widgets without exposing input values. Unsupported widget selections, embedded authentication, SSO popups, and unreviewed autosave requests retain explicit handoffs. Fixture tests verify these boundaries; they do not establish universal live-portal compatibility. See the official [Playwright frames](https://playwright.dev/docs/frames) and [locator](https://playwright.dev/docs/locators) documentation for the underlying browser behavior.
