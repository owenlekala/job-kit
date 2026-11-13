import { type Draft, type Profile, type Fact, digest } from './models.js';
import { factEvidence } from './documents.js';

export interface ClaimReview {
  location: string;
  claim: string;
  evidence: {
    id: string;
    text: string;
    sources?: Fact['sources'];
    verification?: Fact['verification'];
  }[];
  flags: string[];
}
const qualifications =
  /\b(?:senior|principal|lead|expert|expertise|mastery|led|managed|certified|certification|bachelor|master|doctorate|phd|diploma|\d+(?:\.\d+)?\s*(?:years?|%|percent|million))\b/gi;
const technologies =
  /\b(?:Python|Django|Java|Kotlin|Rust|Go|Ruby|Rails|React|Angular|Vue|TypeScript|JavaScript|Node\.js|PostgreSQL|MySQL|MongoDB|AWS|Azure|GCP|Kubernetes|Docker|Terraform|C\+\+|C#)\b/gi;
const learning =
  /\b(?:learn|learning|develop|transferable|foundation|adapt|interested|posting|position|role|apply|application)\b/i;
export function reviewClaims(profile: Profile, draft: Draft): ClaimReview[] {
  const selected = profile.facts.filter((fact) => draft.factIds.includes(fact.id));
  const passages = [
    { location: 'headline', text: draft.headline, evidence: selected.map((f) => f.id) },
    ...(draft.summary ? [{ location: 'summary', ...draft.summary }] : []),
    ...draft.coverLetter.map((p, i) => ({ location: `coverLetter.${i + 1}`, ...p })),
    { location: 'email.subject', text: draft.email.subject, evidence: selected.map((f) => f.id) },
    ...draft.email.paragraphs.map((p, i) => ({ location: `email.${i + 1}`, ...p })),
  ];
  return passages.map((passage) => {
    const evidence = passage.evidence.map((id) => ({
      id,
      sources: selected.find((fact) => fact.id === id)?.sources,
      verification: selected.find((fact) => fact.id === id)?.verification,
      text: selected.find((f) => f.id === id)
        ? factEvidence(selected.find((f) => f.id === id)!)
        : 'Missing verified evidence',
    }));
    const support = evidence
      .map((e) => e.text)
      .join(' ')
      .toLowerCase();
    const flags: string[] = [];
    for (const sentence of passage.text.split(/(?<=[.!?])\s+/)) {
      for (const term of [
        ...sentence.matchAll(qualifications),
        ...sentence.matchAll(technologies),
      ].map((m) => m[0])) {
        if (
          !support.includes(term.toLowerCase()) &&
          !(
            learning.test(sentence) &&
            !/\b(?:expert|expertise|mastery|certified|led|managed|\d+\s*years?)\b/i.test(sentence)
          )
        )
          flags.push(`Confirm support for "${term}" or revise the wording`);
      }
    }
    if (
      passage.location === 'headline' &&
      draft.headline !== profile.headline &&
      !support.includes(draft.headline.toLowerCase())
    )
      flags.push('The tailored headline differs from the verified profile headline');
    return {
      location: passage.location,
      claim: passage.text,
      evidence,
      flags: [...new Set(flags)],
    };
  });
}
export function claimReviewDigest(profile: Profile, draft: Draft) {
  return digest({ profile, draft, claims: reviewClaims(profile, draft) });
}
