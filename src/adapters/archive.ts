import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'node:crypto';
import { z } from 'zod';
import { migrateWorkspace } from '../application/maintenance.js';
import type { Workspace } from '../application/ports.js';
import { Application, Batch, WorkspaceConfig } from '../domain/models.js';

const maximumBytes = 256 * 1024 * 1024;
const Archive = z
  .object({
    version: z.literal(1),
    entries: z
      .array(z.object({ path: z.string(), data: z.string(), sha256: z.string() }).strict())
      .max(20000),
  })
  .strict();
const Envelope = z
  .object({
    version: z.literal(1),
    cipher: z.literal('aes-256-gcm'),
    salt: z.string(),
    iv: z.string(),
    tag: z.string(),
    data: z.string(),
  })
  .strict();
const excluded = (relative: string) =>
  relative.split('/').some((part) => part.startsWith('.') || part === 'runtime');
function safePath(relative: string) {
  if (
    !relative ||
    relative.includes('\\') ||
    relative.startsWith('/') ||
    relative.includes(':') ||
    relative
      .split('/')
      .some(
        (part) =>
          /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      ) ||
    relative.split('/').some((p) => !p || p === '..' || p === '.')
  )
    throw new Error('Invalid archive path');
  if (excluded(relative)) throw new Error('Archives may not contain runtime state or hidden files');
}
function key(passphrase: string, salt: Buffer) {
  if (passphrase.length < 12)
    throw new Error('Use a backup passphrase with at least 12 characters');
  return scryptSync(passphrase, salt, 32, { N: 32768, maxmem: 64 * 1024 * 1024 });
}
export async function createBackup(store: Workspace, destination: string, passphrase: string) {
  const target = path.resolve(destination);
  if (target === store.root || target.startsWith(store.root + path.sep))
    throw new Error('Save backups outside the active workspace');
  await store.read('config.json', WorkspaceConfig);
  const entries: z.infer<typeof Archive>['entries'] = [];
  let size = 0;
  async function walk(directory: string, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (excluded(relative)) continue;
      safePath(relative);
      if (entry.isSymbolicLink()) throw new Error('Backups cannot include symbolic links');
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + '/');
      else if (entry.isFile()) {
        const bytes = await store.readBytes(relative);
        size += bytes.length;
        if (size > maximumBytes || entries.length >= 20000)
          throw new Error('Workspace exceeds the 256 MB backup limit');
        entries.push({
          path: relative,
          data: Buffer.from(bytes).toString('base64'),
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      } else throw new Error('Backup contains an unsupported file type');
    }
  }
  await walk(store.root);
  const salt = randomBytes(16),
    iv = randomBytes(12),
    derived = key(passphrase, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', derived, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify({ version: 1, entries })),
      cipher.final(),
    ]);
    const handle = await fs.open(target, 'wx', 0o600);
    try {
      await handle.writeFile(
        JSON.stringify({
          version: 1,
          cipher: 'aes-256-gcm',
          salt: salt.toString('base64'),
          iv: iv.toString('base64'),
          tag: cipher.getAuthTag().toString('base64'),
          data: data.toString('base64'),
        }),
      );
      await handle.sync();
    } catch (error) {
      await handle.close();
      await fs.rm(target, { force: true });
      throw error;
    }
    await handle.close();
    return {
      file: target,
      files: entries.length,
      notice:
        'Encrypted backup created. Runtime sessions and browser credentials were excluded. Store the passphrase separately.',
    };
  } finally {
    derived.fill(0);
  }
}
export async function restoreBackup(store: Workspace, source: string, passphrase: string) {
  const existing = await fs.readdir(store.root);
  if (existing.some((name) => !['config.json', '.lock'].includes(name)))
    throw new Error('Restore requires a new workspace. Use --workspace with an empty directory.');
  if ((await fs.stat(source)).size > maximumBytes * 2) throw new Error('Backup is too large');
  const envelope = Envelope.parse(JSON.parse(await fs.readFile(source, 'utf8')));
  const salt = Buffer.from(envelope.salt, 'base64'),
    iv = Buffer.from(envelope.iv, 'base64'),
    tag = Buffer.from(envelope.tag, 'base64');
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16)
    throw new Error('Invalid backup encryption metadata');
  const derived = key(passphrase, salt);
  let archive: z.infer<typeof Archive>;
  try {
    const cipher = createDecipheriv('aes-256-gcm', derived, iv);
    cipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      cipher.update(Buffer.from(envelope.data, 'base64')),
      cipher.final(),
    ]);
    archive = Archive.parse(JSON.parse(plaintext.toString('utf8')));
  } catch {
    throw new Error(
      'Backup could not be decrypted or validated. Check the passphrase and file integrity.',
    );
  } finally {
    derived.fill(0);
  }
  let size = 0;
  const seen = new Set<string>();
  for (const entry of archive.entries) {
    safePath(entry.path);
    if (seen.has(entry.path.toLowerCase())) throw new Error('Backup contains duplicate paths');
    seen.add(entry.path.toLowerCase());
    const bytes = Buffer.from(entry.data, 'base64');
    size += bytes.length;
    if (size > maximumBytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
      throw new Error('Backup file integrity check failed');
    if (entry.path === 'config.json') WorkspaceConfig.parse(JSON.parse(bytes.toString()));
  }
  if (!seen.has('config.json')) throw new Error('Backup has no workspace configuration');
  for (const entry of archive.entries) {
    let bytes = Buffer.from(entry.data, 'base64');
    if (/^batches\/[^/]+\.json$/.test(entry.path)) {
      const batch = Batch.parse(JSON.parse(bytes.toString()));
      delete batch.approved;
      delete batch.approvedAt;
      bytes = Buffer.from(JSON.stringify(batch));
    }
    if (/^applications\/[^/]+\.json$/.test(entry.path)) {
      const app = Application.parse(JSON.parse(bytes.toString()));
      if (app.state === 'running' && app.events.at(-1)?.type === 'commit-started')
        app.state = 'uncertain';
      else if (
        app.events.some((event) => event.type === 'commit-started') &&
        ['running', 'handoff'].includes(app.state)
      )
        app.state = 'uncertain';
      else if (['approved', 'running', 'handoff', 'review'].includes(app.state)) {
        app.state = 'preparing';
        app.nextStep = 0;
      }
      bytes = Buffer.from(JSON.stringify(app));
    }
    await store.writeBytes(entry.path, bytes);
  }
  await migrateWorkspace(store);
  return {
    restored: archive.entries.length,
    notice:
      'Approvals were revoked. Rebuild and review before browser operations. Uncertain outcomes still require reconciliation.',
  };
}
