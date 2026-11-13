import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageRoot } from './package.js';

export async function installSkills(
  agent: string,
  target: string,
  options: { overwrite?: boolean; skipExisting?: boolean } = {},
) {
  const { overwrite = false, skipExisting = false } = options;
  if (overwrite && skipExisting)
    throw new Error('--overwrite and --skip-existing cannot be used together');
  const agents: Record<string, string> = { codex: '.agents', claude: '.claude', cursor: '.cursor' };
  const selected = agent === 'all' ? Object.keys(agents) : [agent];
  if (selected.some((a) => !agents[a]))
    throw new Error('Agent must be codex, claude, cursor, or all');
  const source = fileURLToPath(new URL('skills/', packageRoot));
  const names = (await fs.readdir(source, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const destinations = selected.flatMap((a) =>
    names.map((name) => ({ name, directory: path.resolve(target, agents[a]!, 'skills', name) })),
  );
  const skipped: string[] = [];
  // Preflight everything before writing so a conflict does not partially install.
  for (const d of destinations) {
    if (skipExisting) {
      try {
        await fs.lstat(d.directory);
        skipped.push(d.directory);
        continue;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    if (!overwrite) {
      try {
        const existing = await fs.readFile(path.join(d.directory, 'SKILL.md'), 'utf8');
        const expected = await fs.readFile(path.join(source, d.name, 'SKILL.md'), 'utf8');
        if (existing !== expected)
          throw new Error(
            `Existing skill differs: ${d.directory}. Use --overwrite after reviewing it.`,
          );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
  }
  const pending = destinations.filter((d) => !skipped.includes(d.directory));
  for (const d of pending)
    await fs.cp(path.join(source, d.name), d.directory, {
      recursive: true,
      force: overwrite,
      errorOnExist: false,
    });
  return { installed: pending.map((d) => d.directory), skipped };
}
