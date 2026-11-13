import { z } from 'zod';
import type { Workspace } from './ports.js';
import {
  Profile,
  WorkspaceConfig,
  Company,
  Job,
  Application,
  Batch,
  Account,
  RolePreset,
  Draft,
  Packet,
  Build,
} from '../domain/models.js';
import { Profiles } from './profiles.js';

/** Additive migrations retain v1 records and require no destructive conversion. */
export async function migrateWorkspace(store: Workspace) {
  const config = await store.read('config.json', WorkspaceConfig);
  const profiles = new Profiles(store);
  const profile = await profiles.current();
  // Validate portable records before marking the upgrade complete.
  for (const [collection, schema] of Object.entries({
    companies: Company,
    jobs: Job,
    applications: Application,
    batches: Batch,
    accounts: Account,
    presets: RolePreset,
  }))
    await store.list(collection, schema as z.ZodType<unknown>);
  for (const app of await store.list('applications', Application)) {
    await store.read(`applications/${app.id}/draft.json`, Draft);
    await store.read(`applications/${app.id}/packet.json`, Packet);
    try {
      await store.read(`applications/${app.id}/build.json`, Build);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  if (config.schemaVersion === 2) return { schemaVersion: 2, changed: false };
  if (profile)
    await profiles.saveRevision(
      Profile.parse(profile),
      'Preserved legacy profile during schema upgrade',
    );
  await store.write('config.json', { ...config, schemaVersion: 2 });
  return {
    schemaVersion: 2,
    changed: true,
    notice:
      'Legacy verified facts retain their original status. Missing provenance is reported by profile validate.',
  };
}
