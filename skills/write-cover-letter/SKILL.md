---
name: write-cover-letter
description: Write a role-specific cover letter and application-email draft in Job Application Kit with verified supporting evidence and reviewable document outputs.
---

# Write a cover letter

Read the private profile, job/company records, and existing application draft. If needed, run `applykit application prepare <job> --id <application>`. Inspect `applykit schema draft`.

Write a concise letter explaining interest in the actual role and connecting selected verified experience to its requirements. Each `coverLetter` paragraph and `email.paragraphs` entry includes `text` and supporting selected fact IDs in `evidence`. Keep company statements grounded in the posting or official research; omit unverified praise and claims. Do not invent a manager's name, address, skills, employment, metrics, or qualifications. The renderer supplies contact details, date, greeting, and sign-off, so draft paragraphs contain only the body.

Calibrate the candidate to the evidence. Never promote their title, seniority, expertise, years, leadership scope, or qualification status to match a posting. Keep genuine experience accurate, and emphasize relevant work rather than listing every capability or describing the person as overqualified. Avoid unsupported labels such as expert, perfect fit, or ready to lead.

Explain what the person can do: connect two or three actual responsibilities in the posting to concrete tasks they have performed and how those capabilities could help the team. Distinguish direct experience from transferable experience and skills still to learn. For a different tool or industry, name the closest verified work and explain the specific common task; do not turn similarity into a claim of having used the requested tool. For example, verified Node.js REST API and PostgreSQL work can support an explanation of API/data fundamentals that would help someone learn a Python backend. It does not establish Python or Django experience. If no useful similarity is supported, flag the gap during review rather than inventing one. Describe willingness to adapt without promising immediate mastery or unsupported outcomes.

Follow the original `cover_letter.js` structure: a focused opening, concrete relevant work, transferable capabilities/adaptability, and a short invitation to discuss the role. Keep the tone capable and measured. Add a hiring manager and address in optional `recipient` fields only when known; omit unknown details. The shared template handles the centered contact header, recipient block, greeting, and signature. Do not redesign it in generated prose or add extra decorative sections.

Use the user's local application date in `YYYY-MM-DD` format. Preserve resume selections and summary unless the user requested changes. Update the draft with `application update <id> --draft <private-file>` and run `application build <id>`.

Review the generated Markdown, Word, and PDF letter plus `email.md`. Inspect page layout and verify the one-page letter target. Remove unresolved placeholders and generic claims. If additional profile facts are necessary, obtain verification before selecting them. Report the output directory and remaining questions. Do not approve applications, send email, or submit portal forms.
