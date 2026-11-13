import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Profile, WorkspaceConfig, assertNoSecrets, checkWebUrl } from '../domain/models.js';
import { proposeProfile, type ImportMode } from '../domain/profile-changes.js';
import type { Workspace } from './ports.js';

export const ProfileRevision = z
  .object({
    version: z.literal(1),
    id: z.string(),
    at: z.string().datetime(),
    reason: z.string(),
    profile: Profile,
  })
  .strict();
export class Profiles {
  constructor(private readonly store: Workspace) {}
  async current(): Promise<Profile | undefined> {
    try {
      return await this.store.read('profile.json', Profile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  private async proposal(value: unknown, mode: ImportMode, confirm: boolean) {
    assertNoSecrets(value);
    const config = await this.store.read('config.json', WorkspaceConfig);
    const result = proposeProfile(await this.current(), value, mode, confirm, new Date().toISOString());
    result.proposed.contact.links.forEach((link) => checkWebUrl(link.url, config.allowLocalhost));
    result.proposed.facts.forEach((fact) => {
      if (fact.kind === 'project' && fact.url) checkWebUrl(fact.url, config.allowLocalhost);
    });
    for (const fact of result.proposed.facts)
      if (fact.verified && fact.conflicts?.some((conflict) => !conflict.resolved))
        throw new Error(`Resolve conflicts for fact ${fact.id} before verifying it`);
    return result;
  }
  async preview(value: unknown, mode: ImportMode, confirm = false) {
    const result = await this.proposal(value, mode, confirm);
    return { digest: result.digest, changes: result.changes, mode };
  }
  async import(
    value: unknown,
    confirm = false,
    options: { mode?: ImportMode; reviewDigest?: string } = {},
  ) {
    const mode = options.mode ?? 'create';
    const result = await this.proposal(value, mode, confirm);
    const current = await this.current();
    if (current && options.reviewDigest !== result.digest)
      throw new Error(
        'Profile changes require the current preview digest. Run profile import --preview first, then pass --review-digest.',
      );
    if (current && !(await this.store.list('profile-history', ProfileRevision)).length)
      await this.saveRevision(
        current,
        'Preserved existing profile before first tracked change',
        false,
      );
    await this.saveRevision(result.proposed, `Profile ${mode}`);
    return {
      facts: result.proposed.facts.length,
      verified: result.proposed.facts.filter((f) => f.verified).length,
      notice:
        'Profile saved with a recoverable revision. Imported facts require explicit verification.',
    };
  }
  async saveRevision(profile: Profile, reason: string, activate = true) {
    const revision = {
      version: 1,
      id: `profile-${randomUUID()}`,
      at: new Date().toISOString(),
      reason,
      profile,
    };
    await this.store.put('profile-history', revision.id, revision);
    if (activate) await this.store.write('profile.json', profile);
    return revision;
  }
  async verify(factIds: string[], note?: string) {
    const profile = await this.store.read('profile.json', Profile);
    for (const key of factIds) {
      const fact = profile.facts.find((f) => f.id === key);
      if (!fact) throw new Error(`Unknown fact: ${key}`);
      if (fact.conflicts?.some((conflict) => !conflict.resolved))
        throw new Error(`Resolve conflicts for fact ${key} before verification`);
      fact.verified = true;
      fact.verification = {
        at: new Date().toISOString(),
        method: 'user-confirmation',
        ...(note ? { note } : {}),
      };
    }
    if (!(await this.store.list('profile-history', ProfileRevision)).length)
      await this.saveRevision(
        (await this.current())!,
        'Preserved profile before verification',
        false,
      );
    await this.saveRevision(profile, `Verified facts: ${factIds.join(', ')}`);
    return { verified: factIds };
  }
}
