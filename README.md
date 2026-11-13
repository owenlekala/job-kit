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

Setup installs locked npm dependencies and Chromium, builds the CLI, initializes private storage, and installs seven project skills. Choose `codex`, `claude`, or `cursor` instead of `all` if preferred. On Linux, Chromium may require system libraries; install them using `npx playwright install --with-deps chromium` with your system administrator's permission. Setup does not install or log in to Bitwarden.

Use `node dist/cli/index.js <command>` from this directory. Optionally run `npm link` once to expose the shorter `applykit` command used below. On restricted machines, keep using the Node entrypoint instead of linking globally. `npm run dev -- <command>` runs from source.

```sh
applykit --help
applykit doctor
applykit init --interactive
```

Setup can be rerun without replacing profile data or changed skills. It reports conflicting installed skills instead of overwriting them; review changes before using `skills install --overwrite`. Use `--skip-browser` only when Chromium is already installed or for document-free setup checks.

## Your private workspace

Data lives outside the repository:

- macOS: `~/Library/Application Support/job-application-kit`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/job-application-kit`
- Windows: `%LOCALAPPDATA%\job-application-kit`

`applykit init` reports the exact directory. Use `APPLYKIT_HOME` or the global `--workspace <directory>` option for another location, including separate demo workspaces. Keep it outside Git. Unix directories/files use owner-only permissions; Windows relies on the access controls of your user-data directory.

The workspace contains versioned profile/company/job JSON, private notes, role presets, application drafts/plans, document revisions, full review packets, event histories, and snapshots taken before irreversible browser actions. Back up this directory securely. Bitwarden backups are separate; portal passwords are never included in workspace exports.

Concurrent mutations use a heartbeat lock; a lock abandoned by a crashed process expires after 30 seconds. Retry after that interval rather than deleting an active lock.

## Create and verify a profile

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

Facts support any profession. The software-engineering examples are not built-in eligibility rules. Each fact is a complete resume entry; include titles/dates and useful details in its text. Correcting a fact requires updating and re-verifying the profile.

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

All outputs use the same validated content model. PDF uses Chromium, bundled Carlito fonts, A4 paper, and navy/blue styling; Word uses the same content and styling with Carlito or a locally available fallback. Word and PDF pagination can differ. Review every page in both formats. Targets are two resume pages and one cover-letter page; overflow blocks approval until content is shortened or you explicitly use `application build --allow-overflow` after reviewing it. Nothing is silently dropped.

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
