import { Draft, type Profile, type Job, type Company, type Fact } from './models.js';
import { factEvidence } from './documents.js';

function practicalParagraph(fact: Fact): string {
  const statements =
    fact.kind === 'experience'
      ? [...fact.text.split('\n').slice(1), ...(fact.bullets ?? [])]
      : fact.kind === 'project' && fact.description
        ? [fact.description]
        : [];
  if (statements.length)
    return statements
      .map((statement) => {
        const trimmed = statement.trim();
        // Resume bullets conventionally omit their first-person subject. Restore it
        // only for explicit action verbs; do not infer a new capability or employer.
        const sentence =
          /^(?:built|designed|developed|delivered|implemented|maintained|managed|led|supported|tested|deployed|created|improved)\b/i.test(
            trimmed,
          )
            ? 'I ' + trimmed[0]!.toLowerCase() + trimmed.slice(1)
            : trimmed;
        return /[.!?]$/.test(sentence) ? sentence : sentence + '.';
      })
      .join(' ');
  return `My background includes ${factEvidence(fact)}.`;
}

/** A conservative starting draft. Agent skills supply the final role-specific explanation. */
export function startingDraft(
  profile: Profile,
  job: Job,
  company: Company,
  factIds: string[],
  date: string,
): Draft {
  if (!factIds.length) throw new Error('Select at least one verified fact');
  const facts = factIds.map((id) => profile.facts.find((f) => f.id === id));
  if (facts.some((f) => !f?.verified)) throw new Error('Selected facts must exist and be verified');
  const keywords = new Set(
    (job.title + ' ' + job.description).toLowerCase().match(/[a-z0-9+#.]{3,}/g) ?? [],
  );
  const ranked = facts
    .map((fact, index) => ({
      fact: fact!,
      index,
      score: [
        ...new Set(
          factEvidence(fact!)
            .toLowerCase()
            .match(/[a-z0-9+#.]{3,}/g) ?? [],
        ),
      ].filter((word) => keywords.has(word)).length,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const practical = ranked.find(({ fact }) => ['experience', 'project'].includes(fact.kind))?.fact;
  const capability = ranked.find(({ fact }) => fact.kind === 'skill')?.fact ?? ranked[0]!.fact;
  const example = practical ?? capability;
  return Draft.parse({
    version: 1,
    headline: profile.headline,
    factIds,
    date,
    coverLetter: [
      {
        text: `I am writing to apply for the ${job.title} position at ${company.name}. My ${capability.kind === 'skill' ? 'relevant skills' : 'background'} include${capability.kind === 'skill' ? '' : 's'} ${capability.text}.`,
        evidence: [capability.id],
      },
      { text: practicalParagraph(example), evidence: [example.id] },
      {
        text: 'I would welcome the opportunity to connect this experience to the responsibilities in your posting and learn the tools and processes specific to your team.',
        evidence: [example.id],
      },
      {
        text: `I would appreciate the opportunity to discuss where my background can contribute to the ${job.title} role. Thank you for your time and consideration. My resume is attached.`,
        evidence: [capability.id, example.id].filter(
          (key, index, list) => list.indexOf(key) === index,
        ),
      },
    ],
    email: {
      subject: `Application for ${job.title}: ${profile.name}`,
      paragraphs: [
        {
          text: `Please find my application for the ${job.title} position attached. My background includes ${factEvidence(capability)}.`,
          evidence: [capability.id],
        },
      ],
    },
  });
}
