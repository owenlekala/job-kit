import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { randomUUID } from 'node:crypto';
import { Fact, Profile } from '../domain/models.js';

/** Normalize terminal input while the profile schema still validates supported values. */
export function parseWorkArrangements(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/** Terminal presentation only. Saving, revisions, and verification remain application use cases. */
export async function editProfile(current?: Profile) {
  if (!stdin.isTTY) throw new Error('The guided profile editor requires an interactive terminal');
  const prompt = createInterface({ input: stdin, output: stdout });
  const ask = async (label: string, previous = '') =>
    (await prompt.question(`${label}${previous ? ` [${previous}]` : ''}: `)).trim() || previous;
  const list = (value: string) =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  try {
    const name = await ask('Full name', current?.name);
    const headline = await ask('Professional headline', current?.headline);
    const email = await ask('Contact email', current?.contact.email);
    const applicationEmail = await ask(
      'Application email',
      current?.contact.applicationEmail ?? email,
    );
    const phone = await ask('Phone', current?.contact.phone);
    const location = await ask('Location', current?.contact.location);
    const roles = list(
      await ask('Target roles, separated by commas', current?.preferences.roles.join(', ')),
    );
    const locations = list(
      await ask('Target locations, separated by commas', current?.preferences.locations.join(', ')),
    );
    const arrangements = parseWorkArrangements(
      await ask(
        'Work arrangements: remote, hybrid, onsite',
        current?.preferences.arrangements.join(', '),
      ),
    );
    const links = [...(current?.contact.links ?? [])];
    while ((await ask('Add a profile link? yes/no', 'no')).toLowerCase() === 'yes')
      links.push({ label: await ask('Link label'), url: await ask('HTTPS URL') });
    let facts = structuredClone(current?.facts ?? []);
    while (true) {
      stdout.write(
        `\nFacts:\n${facts.map((fact) => `${fact.id}: ${fact.kind}, ${fact.text}, ${fact.verified ? 'verified' : 'unverified'}`).join('\n')}\n`,
      );
      const action = await ask('Choose add, edit, remove, resolve, or done', 'done');
      if (action === 'done') break;
      if (action === 'remove') {
        const id = await ask('Fact ID to remove');
        if (!facts.some((f) => f.id === id)) throw new Error(`Unknown fact: ${id}`);
        facts = facts.filter((fact) => fact.id !== id);
        continue;
      }
      if (action === 'resolve') {
        const id = await ask('Fact ID with a conflict');
        const fact = facts.find((f) => f.id === id);
        if (!fact) throw new Error(`Unknown fact: ${id}`);
        for (const conflict of fact.conflicts ?? []) {
          stdout.write(`${conflict.field}: ${conflict.alternatives.join(' | ')}\n`);
          conflict.resolved = await ask('Confirmed resolution, or leave blank');
        }
        fact.verified = false;
        delete fact.verification;
        stdout.write(
          'Update the factual fields to match the resolution using edit before verifying.\n',
        );
        continue;
      }
      if (!['add', 'edit'].includes(action)) {
        stdout.write('Choose one of the listed actions.\n');
        continue;
      }
      // Ask for an ID separately to keep all edits explicit.
      const factId = action === 'edit' ? await ask('Fact ID to edit') : `fact-${randomUUID()}`;
      const previous = facts.find((f) => f.id === factId);
      if (action === 'edit' && !previous) throw new Error(`Unknown fact: ${factId}`);
      const kind = await ask(
        'Kind: summary, skill, strength, achievement, experience, project, education, language, availability',
        previous?.kind ?? 'experience',
      );
      const record: Record<string, unknown> = {
        id: factId,
        kind,
        text: await ask('Fact text or entry heading', previous?.text),
        verified: false,
      };
      const details = previous as unknown as Record<string, unknown> | undefined;
      const field = async (key: string, label: string) => {
        const value = await ask(
          label,
          typeof details?.[key] === 'string' ? (details[key] as string) : '',
        );
        if (value) record[key] = value;
      };
      if (kind === 'skill') await field('label', 'Skill category');
      if (kind === 'experience') {
        await field('dates', 'Dates');
        await field('context', 'Employer, location, or context');
        const bullets: string[] = [];
        stdout.write('Enter responsibility or achievement bullets. Leave blank to finish.\n');
        while (true) {
          const bullet = await ask('Bullet');
          if (!bullet) break;
          bullets.push(bullet);
        }
        record.bullets = bullets.length
          ? bullets
          : previous?.kind === 'experience'
            ? previous.bullets
            : [];
      }
      if (kind === 'project') {
        await field('url', 'Project HTTPS URL');
        await field('technologies', 'Tools or technologies');
        await field('description', 'What you built and contributed');
      }
      if (kind === 'education') {
        await field('details', 'Institution and actual completion status');
        await field('description', 'Relevant study or qualification details');
      }
      const source = await ask(
        'Source reference, such as an imported source ID or supporting document',
      );
      if (source) record.sources = [{ reference: source }];
      else if (previous?.sources) record.sources = previous.sources;
      if (previous?.conflicts) record.conflicts = previous.conflicts;
      const fact = Fact.parse(record);
      facts = [...facts.filter((f) => f.id !== factId), fact];
    }
    return Profile.parse({
      version: 1,
      name,
      headline,
      contact: {
        email,
        applicationEmail,
        ...(phone ? { phone } : {}),
        ...(location ? { location } : {}),
        links,
      },
      preferences: { roles, locations, arrangements },
      facts,
    });
  } finally {
    prompt.close();
  }
}
