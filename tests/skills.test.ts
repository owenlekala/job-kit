import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { installSkills } from '../src/adapters/skills.js';

test('setup policy preserves changed skills and support files while installing missing folders', async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'applykit-preserve-skills-'));
  try {
    await installSkills('all', target);
    const existing = path.join(target, '.agents/skills/prepare-application-batch');
    const missing = path.join(target, '.cursor/skills/tailor-resume');
    await writeFile(path.join(existing, 'SKILL.md'), 'Custom batch instructions');
    await writeFile(path.join(existing, 'notes.txt'), 'Keep this support file');
    await rm(missing, { recursive: true });
    const result = await installSkills('all', target, { skipExisting: true });
    assert.deepEqual(result.installed, [missing]);
    assert.equal(result.skipped.length, 20);
    assert.ok(result.skipped.includes(existing));
    assert.equal(
      await readFile(path.join(existing, 'SKILL.md'), 'utf8'),
      'Custom batch instructions',
    );
    assert.equal(
      await readFile(path.join(existing, 'notes.txt'), 'utf8'),
      'Keep this support file',
    );
    assert.match(await readFile(path.join(missing, 'SKILL.md'), 'utf8'), /name: tailor-resume/);
    const rerun = await installSkills('all', target, { skipExisting: true });
    assert.equal(rerun.installed.length, 0);
    assert.equal(rerun.skipped.length, 21);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test('preserving existing folders also protects partial installations', async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'applykit-partial-skills-'));
  try {
    const existing = path.join(target, '.agents/skills/prepare-application-batch');
    await mkdir(existing, { recursive: true });
    await writeFile(path.join(existing, 'notes.txt'), 'Unfinished custom skill');
    const result = await installSkills('codex', target, { skipExisting: true });
    assert.deepEqual(result.skipped, [existing]);
    assert.equal(result.installed.length, 6);
    await assert.rejects(access(path.join(existing, 'SKILL.md')), { code: 'ENOENT' });
    assert.equal(
      await readFile(path.join(existing, 'notes.txt'), 'utf8'),
      'Unfinished custom skill',
    );
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test('conflicting install policies fail before creating skill folders', async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'applykit-invalid-skill-options-'));
  try {
    await assert.rejects(
      installSkills('all', target, { overwrite: true, skipExisting: true }),
      /cannot be used together/,
    );
    await assert.rejects(access(path.join(target, '.agents')), { code: 'ENOENT' });
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test('built CLI supports setup policy and explicit reviewed replacement', async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'applykit-skills-cli-'));
  const run = promisify(execFile);
  const entry = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
  const args = [entry, 'skills', 'install', '--agent', 'codex', '--target', target];
  try {
    await run(process.execPath, args);
    const existing = path.join(target, '.agents/skills/prepare-application-batch');
    await writeFile(path.join(existing, 'SKILL.md'), 'Custom skill');
    const result = await run(process.execPath, [...args, '--skip-existing']);
    assert.ok(JSON.parse(result.stdout).skipped.includes(existing));
    assert.equal(await readFile(path.join(existing, 'SKILL.md'), 'utf8'), 'Custom skill');
    await assert.rejects(run(process.execPath, args), /Existing skill differs/);
    await run(process.execPath, [...args, '--overwrite']);
    assert.match(
      await readFile(path.join(existing, 'SKILL.md'), 'utf8'),
      /name: prepare-application-batch/,
    );
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
