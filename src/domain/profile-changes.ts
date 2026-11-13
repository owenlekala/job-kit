import { digest, Profile } from './models.js';

export type ImportMode = 'create' | 'merge' | 'replace';
export function proposeProfile(
  current: Profile | undefined,
  input: unknown,
  mode: ImportMode,
  confirm: boolean,
  verifiedAt: string,
) {
  const incoming = Profile.parse(input);
  incoming.facts = incoming.facts.map((fact) => ({
    ...fact,
    verified: confirm && fact.verified,
    verification:
      confirm && fact.verified
        ? { at: verifiedAt, method: 'reviewed-import' as const }
        : undefined,
  }));
  if (current && mode === 'create')
    throw new Error(
      'A profile already exists. Preview a merge or replacement with profile import --mode merge|replace --preview.',
    );
  const proposed =
    mode === 'merge' && current
      ? Profile.parse({
          ...incoming,
          facts: [
            ...current.facts.filter((f) => !incoming.facts.some((i) => i.id === f.id)),
            ...incoming.facts,
          ],
        })
      : incoming;
  const fields = ['name', 'headline', 'contact', 'preferences'] as const;
  const changes = {
    fields: fields
      .filter((key) => digest(current?.[key] ?? null) !== digest(proposed[key]))
      .map((key) => ({ field: key, before: current?.[key], after: proposed[key] })),
    added: proposed.facts.filter((f) => !current?.facts.some((old) => old.id === f.id)),
    changed: proposed.facts
      .filter((f) => current?.facts.some((old) => old.id === f.id && digest(old) !== digest(f)))
      .map((f) => ({ before: current!.facts.find((old) => old.id === f.id), after: f })),
    removed: current?.facts.filter((f) => !proposed.facts.some((next) => next.id === f.id)) ?? [],
  };
  // The preview digest binds the incoming data and current version, independent of a generated verification time.
  return { proposed, changes, digest: digest({ current: current ?? null, input, mode, confirm }) };
}
