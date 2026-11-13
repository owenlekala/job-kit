---
name: write-cover-letter
description: Write a role-specific cover letter and application-email draft in Job Application Kit with verified supporting evidence and reviewable document outputs.
---

# Write a cover letter

Read the private profile, job/company records, and existing application draft. If needed, run `applykit application prepare <job> --id <application>`. Inspect `applykit schema draft`.

Write a concise letter explaining interest in the actual role and connecting selected verified experience to its requirements. Each `coverLetter` paragraph and `email.paragraphs` entry includes `text` and supporting selected fact IDs in `evidence`. Keep company statements grounded in the posting or official research; omit unverified praise and claims. Do not invent a manager's name, address, skills, employment, metrics, or qualifications. The renderer supplies contact details, date, greeting, and sign-off, so draft paragraphs contain only the body.

Use the user's local application date in `YYYY-MM-DD` format. Preserve resume selections and summary unless the user requested changes. Update the draft with `application update <id> --draft <private-file>` and run `application build <id>`.

Review the generated Markdown, Word, and PDF letter plus `email.md`. Inspect page layout and verify the one-page letter target. Remove unresolved placeholders and generic claims. If additional profile facts are necessary, obtain verification before selecting them. Report the output directory and remaining questions. Do not approve applications, send email, or submit portal forms.
