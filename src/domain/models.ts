import { z } from 'zod';
import { createHash } from 'node:crypto';

export const id = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/, 'Use 1–100 letters, digits, underscores or hyphens');
export const WorkspaceConfig = z
  .object({ version: z.literal(1), allowLocalhost: z.boolean().default(false) })
  .strict();
export const text = z.string().trim().min(1).max(20000);
export const url = z
  .string()
  .url()
  .refine((v) => ['https:', 'http:'].includes(new URL(v).protocol), 'Use an HTTP(S) URL')
  .refine((v) => !new URL(v).username && !new URL(v).password, 'URLs may not contain credentials');
const timestamp = z.string().datetime();
export const Fact = z
  .object({
    id,
    kind: z.enum([
      'summary',
      'skill',
      'experience',
      'project',
      'education',
      'achievement',
      'language',
    ]),
    text,
    verified: z.boolean().default(false),
  })
  .strict();
export const Profile = z
  .object({
    version: z.literal(1),
    name: text,
    headline: text,
    contact: z
      .object({
        email: z.email(),
        applicationEmail: z.email().optional(),
        phone: text.optional(),
        location: text.optional(),
        links: z.array(z.object({ label: text, url }).strict()).default([]),
      })
      .strict(),
    preferences: z
      .object({
        roles: z.array(text).default([]),
        locations: z.array(text).default([]),
        arrangements: z.array(z.enum(['remote', 'hybrid', 'onsite'])).default([]),
      })
      .strict()
      .default({ roles: [], locations: [], arrangements: [] }),
    facts: z.array(Fact).min(1),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (new Set(p.facts.map((f) => f.id)).size !== p.facts.length)
      ctx.addIssue({ code: 'custom', message: 'Fact IDs must be unique' });
  });
export type Profile = z.infer<typeof Profile>;
export const Company = z
  .object({
    version: z.literal(1),
    id,
    name: text,
    careersUrl: url.optional(),
    sourceUrl: url.optional(),
    verifiedAt: timestamp.optional(),
    recruitmentEmail: z.email().optional(),
    notes: z.string().default(''),
  })
  .strict();
export type Company = z.infer<typeof Company>;
export const Job = z
  .object({
    version: z.literal(1),
    id,
    companyId: id,
    title: text,
    url,
    description: text,
    sourceUrl: url,
    verifiedAt: timestamp,
    location: text.optional(),
  })
  .strict();
export type Job = z.infer<typeof Job>;
const EvidenceText = z.object({ text, evidence: z.array(id).min(1) }).strict();
export const Draft = z
  .object({
    version: z.literal(1),
    headline: text,
    factIds: z.array(id).min(1),
    summary: EvidenceText.optional(),
    coverLetter: z.array(EvidenceText).min(1),
    email: z.object({ subject: text, paragraphs: z.array(EvidenceText).min(1) }).strict(),
    date: z.iso.date(),
  })
  .strict();
export type Draft = z.infer<typeof Draft>;
export const Account = z
  .object({
    version: z.literal(1),
    id,
    origin: url,
    tenant: text,
    pathPrefix: z.string().startsWith('/').default('/'),
    email: z.email(),
    itemId: text,
    mode: z.enum(['existing', 'create']),
  })
  .strict();
export type Account = z.infer<typeof Account>;
export const RolePreset = z
  .object({ version: z.literal(1), id, name: text, factIds: z.array(id).min(1) })
  .strict();
export type RolePreset = z.infer<typeof RolePreset>;
// Every executable browser action is reviewed as part of the packet. Values are
// resolved from answer keys or vault entries, never from website instructions.
export const Step = z
  .object({
    action: z.enum([
      'navigate',
      'fill',
      'check',
      'select',
      'upload',
      'click',
      'login',
      'wait',
      'handoff',
      'credential',
      'submit',
      'register',
    ]),
    selector: text.optional(),
    url: url.optional(),
    answer: id.optional(),
    document: z
      .enum(['resume.pdf', 'resume.docx', 'cover-letter.pdf', 'cover-letter.docx'])
      .optional(),
    credential: z.enum(['email', 'password']).optional(),
    accountId: id.optional(),
    message: text.optional(),
    confirmationSelector: text.optional(),
    confirmationText: text.optional(),
    checks: z
      .array(
        z
          .object({
            selector: text,
            answer: id.optional(),
            document: z
              .enum(['resume.pdf', 'resume.docx', 'cover-letter.pdf', 'cover-letter.docx'])
              .optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict()
  .superRefine((s, ctx) => {
    const need = (ok: unknown, field: string) => {
      if (!ok) ctx.addIssue({ code: 'custom', message: `${s.action} requires ${field}` });
    };
    if (s.action === 'navigate') need(s.url, 'url');
    if (
      [
        'fill',
        'check',
        'select',
        'upload',
        'click',
        'login',
        'wait',
        'credential',
        'submit',
        'register',
      ].includes(s.action)
    )
      need(s.selector, 'selector');
    if (['fill', 'check', 'select'].includes(s.action)) need(s.answer, 'answer');
    if (s.action === 'upload') need(s.document, 'document');
    if (s.action === 'credential') {
      need(s.accountId, 'accountId');
      need(s.credential, 'credential');
    }
    if (s.action === 'handoff') need(s.message, 'message');
    if (['submit', 'register'].includes(s.action)) {
      need(s.confirmationSelector, 'confirmationSelector');
      need(s.checks.length, 'checks');
    }
  });
export type Step = z.infer<typeof Step>;
export const Packet = z
  .object({
    version: z.literal(1),
    applicationId: id,
    destination: url,
    allowedOrigins: z.array(url).min(1),
    accountIds: z.array(id).default([]),
    answers: z.record(id, z.union([text, z.boolean()])),
    steps: z.array(Step).default([]),
  })
  .strict();
export type Packet = z.infer<typeof Packet>;
export const Application = z
  .object({
    version: z.literal(1),
    id,
    jobId: id,
    state: z.enum([
      'preparing',
      'review',
      'approved',
      'running',
      'handoff',
      'submitted',
      'uncertain',
      'failed',
      'interview',
      'rejected',
      'withdrawn',
    ]),
    nextStep: z.number().int().nonnegative().default(0),
    updatedAt: timestamp,
    events: z.array(z.object({ at: timestamp, type: text, message: text }).strict()).default([]),
  })
  .strict();
export type Application = z.infer<typeof Application>;
export const Batch = z
  .object({
    version: z.literal(1),
    id,
    applicationIds: z.array(id).min(1),
    reviewed: z.record(id, text),
    approved: z.record(id, text).optional(),
    reviewedAt: timestamp,
    approvedAt: timestamp.optional(),
  })
  .strict();
export type Batch = z.infer<typeof Batch>;
export const Build = z
  .object({
    version: z.literal(1),
    revision: id,
    sourceDigest: text,
    files: z.record(text, text),
    pages: z.object({ resume: z.number().int(), coverLetter: z.number().int() }),
    overflowAccepted: z.boolean(),
    builtAt: timestamp,
  })
  .strict();
export type Build = z.infer<typeof Build>;
export interface DocumentModel {
  name: string;
  headline: string;
  contact: string[];
  links: { label: string; url: string }[];
  summary?: string;
  sections: { title: string; paragraphs: string[] }[];
  date: string;
  company: string;
  jobTitle: string;
  coverLetter: string[];
  email: { subject: string; paragraphs: string[] };
}
export function documentModel(
  profile: Profile,
  draft: Draft,
  job: Job,
  company: Company,
): DocumentModel {
  validateEvidence(profile, draft);
  const labels = {
    skill: 'Technical Skills',
    experience: 'Professional Experience',
    project: 'Selected Projects',
    education: 'Education',
    achievement: 'Achievements',
    language: 'Languages',
    summary: 'Additional Background',
  };
  const selected = draft.factIds.map((key) => profile.facts.find((f) => f.id === key)!);
  return {
    name: profile.name,
    headline: draft.headline,
    contact: [
      profile.contact.location,
      profile.contact.phone,
      profile.contact.applicationEmail ?? profile.contact.email,
    ].filter((v): v is string => Boolean(v)),
    links: profile.contact.links,
    summary: draft.summary?.text,
    sections: Object.entries(labels)
      .map(([kind, title]) => ({
        title,
        paragraphs: selected.filter((f) => f.kind === kind).map((f) => f.text),
      }))
      .filter((s) => s.paragraphs.length),
    date: draft.date,
    company: company.name,
    jobTitle: job.title,
    coverLetter: draft.coverLetter.map((p) => p.text),
    email: { subject: draft.email.subject, paragraphs: draft.email.paragraphs.map((p) => p.text) },
  };
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export const digest = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
export function assertNoSecrets(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoSecrets);
    return;
  }
  if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      if (/password|secret|token|cookie|authorization|bw_session/i.test(k))
        throw new Error(`Secret field "${k}" is prohibited; use Bitwarden references`);
      assertNoSecrets(v);
    }
}
export function validateEvidence(profile: Profile, draft: Draft): void {
  const selected = new Set(draft.factIds);
  if (selected.size !== draft.factIds.length) throw new Error('Duplicate selected facts');
  const verified = new Set(profile.facts.filter((f) => f.verified).map((f) => f.id));
  for (const factId of selected)
    if (!verified.has(factId)) throw new Error(`Fact ${factId} is missing or unverified`);
  for (const passage of [draft.summary, ...draft.coverLetter, ...draft.email.paragraphs].filter(
    Boolean,
  )) {
    for (const factId of passage!.evidence)
      if (!selected.has(factId))
        throw new Error(`Evidence ${factId} must be selected and verified`);
  }
  const rendered = [
    draft.headline,
    draft.summary?.text,
    ...draft.coverLetter.map((p) => p.text),
    draft.email.subject,
    ...draft.email.paragraphs.map((p) => p.text),
    ...profile.facts.filter((f) => selected.has(f.id)).map((f) => f.text),
  ].join('\n');
  if (
    /\[(?:date|company[^\]]*|job[^\]]*|hiring[^\]]*|insert[^\]]*|your[^\]]*)\]|\{\{|\bTODO\b|\bTBD\b/i.test(
      rendered,
    )
  )
    throw new Error('Unresolved placeholder in document content');
}
export function checkWebUrl(value: string, allowLocalhost = false): void {
  const u = new URL(value);
  if (u.username || u.password) throw new Error('URLs may not contain credentials');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(allowLocalhost && local && u.protocol === 'http:'))
    throw new Error('Use HTTPS (localhost HTTP requires init --allow-localhost)');
}
