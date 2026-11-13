---
name: setup-job-profile
description: Set up a Job Application Kit profile or import existing resume notes, with explicit verification of employment, education, and achievements before document generation.
---

# Set up a job profile

Use `applykit` (or `node <kit>/dist/cli/index.js`) as the toolkit command. Run `doctor` and `init` first; the latter reports the private workspace path. Never place personal files in the shared repository.

1. Ask for profile information that is unavailable in the user's supplied materials. Inspect `applykit schema profile` and the fictional `examples/profile.json` in the kit for the format.
2. Import existing Markdown or JavaScript with `profile import <file>`. This saves unverified notes; never execute imported code. Read the source notes from the private workspace to extract proposed facts.
3. Collect identity, contact/application email, links, role/location/work-arrangement preferences, experience, achievements, projects, skills, education, and languages. Give every factual entry a stable ID. Preserve uncertainty rather than resolving contradictions by inference.
4. Save a proposed profile JSON privately. Import with `profile import <file>`; facts become unverified. Present conflicting titles, dates, metrics, and education completion status to the user.
5. After the user confirms accuracy, use `profile verify <fact-ids...> --confirm`. Alternatively, `profile import <file> --confirm` preserves explicitly reviewed verification flags. Do not attest on the user's behalf without confirmation.
6. Run `profile validate`. Report any unverified facts; downstream skills may use only verified ones.

Passwords, MFA codes, recovery codes, and vault session keys never belong in the profile, chat, or source notes. A default application email is appropriate; each portal password belongs in Bitwarden. No account creation or application submission is authorized by this skill.
