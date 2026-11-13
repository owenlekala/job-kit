import { z } from 'zod';
import type { Workspace } from '../application/ports.js';
import { digest, Job, Company, Draft, Packet, Account, id } from '../domain/models.js';

const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const pretty = (value: unknown) => `<pre>${escape(JSON.stringify(value, null, 2))}</pre>`;
const rows = (values: [string, unknown][]) =>
  `<dl>${values.map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('')}</dl>`;
const Claims = z.array(
  z.object({
    location: z.string(),
    claim: z.string(),
    evidence: z.array(z.object({ id: z.string(), text: z.string() }).passthrough()),
    flags: z.array(z.string()),
  }),
);
const pages = z.object({ resume: z.number(), coverLetter: z.number() });
const Review = z
  .object({
    applications: z.array(
      z
        .object({
          id,
          fingerprint: z.string(),
          job: Job,
          company: Company,
          draft: Draft,
          packet: Packet,
          accounts: z.array(Account),
          claims: Claims.optional(),
          claimAttestation: z.unknown().optional(),
          documents: z
            .object({
              revision: id,
              files: z.record(z.string(), z.string()),
              pages,
              wordPages: pages.optional(),
              warnings: z.array(z.string()).optional(),
            })
            .passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export async function writeReviewPage(store: Workspace, batchId: string) {
  id.parse(batchId);
  const packet = await store.read(`reviews/${batchId}.json`, Review);
  let previous: z.infer<typeof Review> | undefined;
  try {
    previous = await store.read(`reviews/${batchId}.previous.json`, Review);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const cards = packet.applications
    .map((entry) => {
      const old = previous?.applications.find((p) => p.id === entry.id);
      const differences = old
        ? ['job', 'company', 'draft', 'packet', 'accounts', 'documents', 'claims'].filter(
            (field) => digest(old[field] ?? null) !== digest(entry[field] ?? null),
          )
        : ['New application in this batch'];
      const documents = Object.keys(entry.documents.files)
        .map((file) => {
          const href = `../artifacts/${encodeURIComponent(entry.id)}/${encodeURIComponent(entry.documents.revision)}/${encodeURIComponent(file)}`;
          return `<li><a href="${href}">${escape(file)}</a>${file === 'resume.preview.html' || file === 'cover-letter.preview.html' ? `<iframe title="${escape(file)}" src="${href}"></iframe>` : ''}</li>`;
        })
        .join('');
      const claims = (entry.claims ?? [])
        .map(
          (claim) =>
            `<section class="claim"><h4>${escape(claim.location)}</h4><p>${escape(claim.claim)}</p>${claim.flags.length ? `<ul class="flags">${claim.flags.map((flag) => `<li>${escape(flag)}</li>`).join('')}</ul>` : '<p class="muted">No automatic flags. Confirm the wording against the evidence.</p>'}<details><summary>Supporting facts (${claim.evidence.length})</summary>${claim.evidence.map((fact) => `<h5>${escape(fact.id)}</h5><p class="evidence">${escape(fact.text)}</p><details><summary>Source and verification details</summary>${pretty(fact)}</details>`).join('')}</details></section>`,
        )
        .join('');
      const accountDetails = entry.accounts.length
        ? entry.accounts
            .map((account) =>
              rows([
                ['Account', account.id],
                ['Portal', account.origin + account.pathPrefix],
                ['Tenant', account.tenant],
                ['Email', account.email],
                [
                  'Action',
                  account.mode === 'create'
                    ? 'Vault entry prepared for reviewed registration or login'
                    : 'Existing account',
                ],
                ['Vault reference', account.itemId],
              ]),
            )
            .join('')
        : '<p>No portal accounts are included.</p>';
      const answers = Object.entries(entry.packet.answers).length
        ? rows(Object.entries(entry.packet.answers))
        : '<p>No answers are included.</p>';
      const steps = entry.packet.steps.length
        ? `<ol>${entry.packet.steps.map((step) => `<li><strong>${escape(step.action)}</strong>${step.message ? `: ${escape(step.message)}` : ''}${rows(Object.entries(step).filter(([key, value]) => key !== 'action' && key !== 'message' && typeof value === 'string'))}${step.checks.length ? `<details><summary>Form checks</summary>${pretty(step.checks)}</details>` : ''}</li>`).join('')}</ol>`
        : '<p>No browser actions are planned.</p>';
      return `<article><h2>${escape(entry.job.title)}</h2><p class="subtitle">${escape(entry.company.name)} · ${escape(entry.id)}</p><p>Changes since the previous review: ${escape(differences.length ? differences.join(', ') : 'None')}</p><h3>Job and company</h3>${rows(
        [
          ['Company', entry.company.name],
          ['Location', entry.job.location ?? 'Not recorded'],
          ['Job status', entry.job.status ?? 'open'],
          ['Deadline', entry.job.deadline ?? 'Not recorded'],
          ['Last verified', entry.job.verifiedAt],
          ['Source', entry.job.sourceUrl],
        ],
      )}<details><summary>Job description</summary><p class="evidence">${escape(entry.job.description)}</p></details><h3>Destination and answers</h3>${rows(
        [
          ['Destination', entry.packet.destination],
          ['Allowed network origins', entry.packet.allowedOrigins.join(', ')],
        ],
      )}${answers}<h3>Browser actions</h3>${steps}<h3>Account references</h3>${accountDetails}<h3>Documents</h3>${rows(
        [
          [
            'PDF pages',
            `Resume: ${entry.documents.pages.resume}; cover letter: ${entry.documents.pages.coverLetter}`,
          ],
          [
            'Word pages',
            entry.documents.wordPages
              ? `Resume: ${entry.documents.wordPages.resume}; cover letter: ${entry.documents.wordPages.coverLetter}`
              : 'Not checked',
          ],
        ],
      )}${(entry.documents.warnings ?? []).map((warning) => `<p class="notice">${escape(warning)}</p>`).join('')}<ul class="documents">${documents}</ul><h3>Claims and supporting facts</h3>${claims}${entry.claimAttestation ? `<details><summary>Applicant claim verification</summary>${pretty(entry.claimAttestation)}</details>` : ''}<details><summary>Complete review data</summary>${pretty(entry)}</details></article>`;
    })
    .join('');
  const reviewDigest = digest(packet);
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; frame-src 'self' file:; font-src data:; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Application batch review</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#1f2937;background:#f1f5f9;max-width:1100px;margin:32px auto;padding:0 20px}article,header{background:white;padding:28px;margin:24px 0;border:1px solid #cbd5e1;border-radius:8px}h1,h2,h3,h4,h5{line-height:1.25}h3{margin-top:32px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f8fafc;padding:16px}a{color:#1d4ed8}iframe{display:block;width:100%;height:1060px;border:1px solid #cbd5e1;margin:16px 0}li{margin:12px 0}dl{display:grid;grid-template-columns:minmax(150px,1fr) 3fr;gap:8px 20px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}.subtitle,.muted{color:#4b5563}.evidence{white-space:pre-wrap;overflow-wrap:anywhere}.claim{border-left:3px solid #2563eb;padding:4px 20px;margin:24px 0}.flags,.notice{background:#fff7ed;padding:16px 28px;color:#7c2d12}summary{cursor:pointer;color:#1d4ed8;padding:8px 0}.documents{padding:0;list-style:none}@media(max-width:600px){dl{grid-template-columns:1fr}dd{margin-bottom:12px}article,header{padding:20px}}</style><header><h1>Application batch review</h1><p>Batch: ${escape(batchId)}</p><p>Review every document, answer, destination, and account action. Evidence flags require human judgment. This private page does not submit or approve applications.</p><details><summary>Approval details</summary><p>Review digest:</p><pre>${escape(reviewDigest)}</pre><p>After explicitly approving this content, use:</p><pre>applykit batch approve ${escape(batchId)} --digest ${escape(reviewDigest)} --confirm</pre></details></header>${cards}</html>`;
  await store.writeBytes(`reviews/${batchId}.html`, html);
  return { reviewPage: store.file(`reviews/${batchId}.html`), reviewDigest };
}
