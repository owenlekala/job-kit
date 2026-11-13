import { validateDocumentWording } from './wording.js';
import {
  validateEvidence,
  type Profile,
  type Draft,
  type Job,
  type Company,
  type Fact,
} from './models.js';

export type ResumeEntry =
  | { type: 'paragraph' | 'bullet'; text: string }
  | { type: 'skill'; label?: string; text: string }
  | { type: 'experience'; title: string; dates?: string; context?: string; bullets: string[] }
  | { type: 'project'; name: string; url?: string; technologies?: string; description?: string }
  | { type: 'education'; qualification: string; details?: string; description?: string };
export interface DocumentModel {
  name: string;
  headline: string;
  contact: string[];
  links: { label: string; url: string }[];
  availability?: string;
  sections: { title: string; entries: ResumeEntry[] }[];
  date: string;
  company: string;
  recipient?: Draft['recipient'];
  jobTitle: string;
  coverLetter: string[];
  email: { subject: string; paragraphs: string[] };
}
export const letterGreeting = (model: DocumentModel) =>
  `Dear ${model.recipient?.hiringManager ?? 'Hiring Team'},`;

function resumeEntry(fact: Fact): ResumeEntry {
  switch (fact.kind) {
    case 'skill':
      return { type: 'skill', label: fact.label, text: fact.text };
    case 'experience': {
      // Legacy multiline facts remain usable. No dates, titles, or skills are inferred.
      const [title, ...lines] = fact.text.split('\n');
      return {
        type: 'experience',
        title: title!,
        dates: fact.dates,
        context: fact.context,
        bullets: [...lines.filter(Boolean), ...(fact.bullets ?? [])],
      };
    }
    case 'project':
      return {
        type: 'project',
        name: fact.text,
        url: fact.url,
        technologies: fact.technologies,
        description: fact.description,
      };
    case 'education': {
      const [qualification, ...lines] = fact.text.split('\n');
      return {
        type: 'education',
        qualification: qualification!,
        details: fact.details ?? (lines.length ? lines.join('\n') : undefined),
        description: fact.description,
      };
    }
    case 'summary':
      return { type: 'paragraph', text: fact.text };
    default:
      return { type: 'bullet', text: fact.text };
  }
}
export function documentModel(
  profile: Profile,
  draft: Draft,
  job: Job,
  company: Company,
): DocumentModel {
  validateEvidence(profile, draft);
  const selected = draft.factIds.map((key) => profile.facts.find((f) => f.id === key)!);
  const groups: { title: string; kinds: Fact['kind'][] }[] = [
    { title: 'Professional Summary', kinds: ['summary'] },
    { title: 'Technical Skills', kinds: ['skill'] },
    { title: 'Core Strengths', kinds: ['strength', 'achievement'] },
    { title: 'Professional Experience', kinds: ['experience'] },
    { title: 'Key Projects', kinds: ['project'] },
    { title: 'Education', kinds: ['education'] },
    { title: 'Languages', kinds: ['language'] },
  ];
  const sections = groups
    .map((group) => ({
      title: group.title,
      entries:
        group.title === 'Professional Summary' && draft.summary
          ? [{ type: 'paragraph' as const, text: draft.summary.text }]
          : selected.filter((f) => group.kinds.includes(f.kind)).map(resumeEntry),
    }))
    .filter((s) => s.entries.length);
  const model: DocumentModel = {
    name: profile.name,
    headline: draft.headline,
    contact: [
      profile.contact.location,
      profile.contact.phone,
      profile.contact.applicationEmail ?? profile.contact.email,
    ].filter((v): v is string => Boolean(v)),
    links: profile.contact.links,
    availability:
      selected
        .filter((f) => f.kind === 'availability')
        .map((f) => f.text)
        .join('  •  ') || undefined,
    sections,
    date: draft.date,
    company: company.name,
    recipient: draft.recipient,
    jobTitle: job.title,
    coverLetter: draft.coverLetter.map((p) => p.text),
    email: { subject: draft.email.subject, paragraphs: draft.email.paragraphs.map((p) => p.text) },
  };
  validateDocumentWording(model);
  return model;
}

/** Complete verified evidence, including structured content; never just a job title. */
export function factEvidence(fact: Fact): string {
  switch (fact.kind) {
    case 'skill':
      return fact.label ? `${fact.label}: ${fact.text}` : fact.text;
    case 'experience':
      return [fact.text, fact.dates, fact.context, ...(fact.bullets ?? [])]
        .filter(Boolean)
        .join('\n');
    case 'project':
      return [fact.text, fact.description, fact.technologies].filter(Boolean).join(': ');
    case 'education':
      return [fact.text, fact.details, fact.description].filter(Boolean).join('\n');
    default:
      return fact.text;
  }
}
