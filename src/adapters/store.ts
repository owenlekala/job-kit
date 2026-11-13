import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { z } from 'zod';
import { id, WorkspaceConfig } from '../domain/models.js';
import type { Workspace } from '../application/ports.js';

export function defaultWorkspace(): string {
  if (process.env.APPLYKIT_HOME) return path.resolve(process.env.APPLYKIT_HOME);
  const base =
    process.platform === 'win32'
      ? (process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'))
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : (process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'));
  return path.join(base, 'job-application-kit');
}
export class Store implements Workspace {
  readonly root: string;
  private checkedPrivateRoot = false;
  private staged?: Map<string, Uint8Array>;
  private commitFailed = false;
  private readonly journalSchema = z
    .object({
      version: z.literal(1),
      entries: z.array(z.object({ path: z.string(), data: z.string() }).strict()).max(50000),
    })
    .strict();
  constructor(root = defaultWorkspace()) {
    this.root = path.resolve(root);
  }
  file(...parts: string[]): string {
    const result = path.resolve(this.root, ...parts);
    if (result !== this.root && !result.startsWith(this.root + path.sep))
      throw new Error('Path escapes private workspace');
    return result;
  }
  record(collection: string, key: string) {
    id.parse(key);
    id.parse(collection);
    return this.file(collection, `${key}.json`);
  }
  private async ensurePrivateRoot(): Promise<void> {
    if (this.checkedPrivateRoot) return;
    let existing = this.root;
    while (true) {
      try {
        existing = await fs.realpath(existing);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        existing = path.dirname(existing);
      }
    }
    // Inspect both lexical and resolved parents so a symlink cannot put private
    // data in a working tree. Apply this to every write entry point, not only init.
    for (const candidate of [this.root, existing]) {
      for (let directory = candidate; ; directory = path.dirname(directory)) {
        try {
          await fs.access(path.join(directory, '.git'));
          throw new Error('Private workspace must be outside every Git working tree');
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
        if (path.dirname(directory) === directory) break;
      }
    }
    try {
      const entries = await fs.readdir(this.root);
      if (
        entries.length &&
        !entries.includes('config.json') &&
        !entries.includes('.transaction.json')
      )
        throw new Error(
          'Use an empty directory or an existing ApplyKit workspace; unrelated directories are not private workspaces',
        );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await fs.chmod(this.root, 0o700);
    this.checkedPrivateRoot = true;
  }
  async initialize(allowLocalhost = false): Promise<void> {
    await this.ensurePrivateRoot();
    try {
      await this.read('config.json', WorkspaceConfig);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      await this.write('config.json', { version: 1, schemaVersion: 2, allowLocalhost });
    }
  }
  async read<T>(relative: string, schema: z.ZodType<T>): Promise<T> {
    return schema.parse(JSON.parse(Buffer.from(await this.readBytes(relative)).toString('utf8')));
  }
  async readBytes(relative: string): Promise<Uint8Array> {
    const pending = this.staged?.get(this.file(relative));
    if (pending) return pending;
    if (!this.staged) {
      const pendingJournal = await fs.access(this.file('.transaction.json')).then(
        () => true,
        () => false,
      );
      if (pendingJournal)
        throw new Error(
          'An interrupted workspace transaction requires recovery. Run applykit workspace recover.',
        );
    }
    return fs.readFile(this.file(relative));
  }
  async get<T>(collection: string, key: string, schema: z.ZodType<T>): Promise<T> {
    return this.read(path.relative(this.root, this.record(collection, key)), schema);
  }
  async write(relative: string, value: unknown): Promise<void> {
    await this.writeBytes(relative, JSON.stringify(value, null, 2) + '\n');
  }
  async put(collection: string, key: string, value: unknown): Promise<void> {
    await this.write(path.relative(this.root, this.record(collection, key)), value);
  }
  async writeBytes(relative: string, data: string | Uint8Array): Promise<void> {
    if (this.commitFailed)
      throw new Error(
        'A durable commit was interrupted. Run applykit workspace recover before making more changes.',
      );
    await this.ensurePrivateRoot();
    const target = this.file(relative);
    if (this.staged) {
      this.staged.set(target, typeof data === 'string' ? Buffer.from(data) : Uint8Array.from(data));
      return;
    }
    for (let parent = target; parent !== this.root; parent = path.dirname(parent)) {
      try {
        if ((await fs.lstat(parent)).isSymbolicLink())
          throw new Error('Symbolic links are prohibited inside the private workspace');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temp, 'wx', 0o600);
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temp, target);
      if (process.platform !== 'win32') {
        const directory = await fs.open(path.dirname(target), 'r');
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
  async list<T>(collection: string, schema: z.ZodType<T>): Promise<T[]> {
    id.parse(collection);
    let entries: string[];
    try {
      entries = await fs.readdir(this.file(collection));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') entries = [];
      else throw e;
    }
    if (this.staged)
      for (const target of this.staged.keys())
        if (path.dirname(target) === this.file(collection)) entries.push(path.basename(target));
    return Promise.all(
      [...new Set(entries)]
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => this.read(path.join(collection, f), schema)),
    );
  }
  async checkpoint(): Promise<void> {
    if (this.commitFailed) throw new Error('A durable commit requires recovery');
    if (!this.staged) return;
    const entries = [...this.staged].map(([target, bytes]) => ({
      path: path.relative(this.root, target),
      data: Buffer.from(bytes).toString('base64'),
    }));
    this.staged = undefined;
    try {
      if (entries.length) {
        await this.write('.transaction.json', { version: 1, entries });
        await this.recoverJournal();
      }
    } catch (error) {
      this.commitFailed = true;
      throw error;
    } finally {
      this.staged = this.commitFailed ? undefined : new Map();
    }
  }
  private async recoverJournal() {
    let journal: z.infer<typeof this.journalSchema>;
    try {
      journal = this.journalSchema.parse(
        JSON.parse(await fs.readFile(this.file('.transaction.json'), 'utf8')),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    for (const entry of journal.entries) {
      if (entry.path.startsWith('.') || entry.path.split(/[\\/]/).includes('..'))
        throw new Error('Invalid transaction path');
      this.file(entry.path);
    }
    for (const entry of journal.entries)
      await this.writeBytes(entry.path, Buffer.from(entry.data, 'base64'));
    await fs.rm(this.file('.transaction.json'));
  }
  async lock<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensurePrivateRoot();
    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(this.root, {
        lockfilePath: this.file('.lock'),
        stale: 30000,
        update: 10000,
        retries: 0,
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ELOCKED')
        throw new Error(
          'Workspace is busy in another process. An abandoned lock expires after 30 seconds.',
        );
      throw e;
    }
    try {
      this.commitFailed = false;
      await this.recoverJournal();
      this.staged = new Map();
      const result = await fn();
      await this.checkpoint();
      return result;
    } finally {
      this.staged = undefined;
      await release();
    }
  }
}
