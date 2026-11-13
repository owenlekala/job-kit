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
      if (entries.length && !entries.includes('config.json'))
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
      await this.write('config.json', { version: 1, allowLocalhost });
    }
  }
  async read<T>(relative: string, schema: z.ZodType<T>): Promise<T> {
    return schema.parse(JSON.parse(await fs.readFile(this.file(relative), 'utf8')));
  }
  async readBytes(relative: string): Promise<Uint8Array> {
    return fs.readFile(this.file(relative));
  }
  async get<T>(collection: string, key: string, schema: z.ZodType<T>): Promise<T> {
    return schema.parse(JSON.parse(await fs.readFile(this.record(collection, key), 'utf8')));
  }
  async write(relative: string, value: unknown): Promise<void> {
    await this.writeBytes(relative, JSON.stringify(value, null, 2) + '\n');
  }
  async put(collection: string, key: string, value: unknown): Promise<void> {
    await this.write(path.relative(this.root, this.record(collection, key)), value);
  }
  async writeBytes(relative: string, data: string | Uint8Array): Promise<void> {
    await this.ensurePrivateRoot();
    const target = this.file(relative);
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
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    return Promise.all(
      entries
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => this.read(path.join(collection, f), schema)),
    );
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
      return await fn();
    } finally {
      await release();
    }
  }
}
