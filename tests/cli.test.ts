import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { applicationPacket, portal } from './support.js';

const runProcess = promisify(execFile);
test('built CLI completes onboarding, document build, review and detached bridge submission', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'applykit CLI fixture ')),
    p = await portal();
  const entry = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
  const command = async (...args: string[]) => {
    const { stdout } = await runProcess(process.execPath, [entry, '--workspace', root, ...args], {
      timeout: 90000,
      maxBuffer: 1024 * 1024,
    });
    return JSON.parse(stdout);
  };
  try {
    await command('init', '--allow-localhost');
    await command(
      'profile',
      'import',
      fileURLToPath(new URL('../examples/profile.json', import.meta.url)),
      '--confirm',
    );
    await command('companies', 'import', '--id', 'fixture', '--name', 'CLI Fixture Company');
    const description = path.join(root, 'job-description.txt');
    await writeFile(description, 'Build reliable TypeScript services');
    await command(
      'jobs',
      'add',
      '--id',
      'fixture-job',
      '--company',
      'fixture',
      '--title',
      'Backend Engineer',
      '--url',
      `${p.origin}/apply`,
      '--description',
      description,
    );
    await command('application', 'prepare', 'fixture-job', '--id', 'cli-application');
    const plan = path.join(root, 'proposed-packet.json');
    await writeFile(plan, JSON.stringify(applicationPacket(p.origin, 'cli-application')));
    await command('application', 'update', 'cli-application', '--packet', plan);
    const built = await command('application', 'build', 'cli-application');
    assert.equal(built.build.pages.resume, 1);
    const review = await command('batch', 'review', 'cli-batch', 'cli-application');
    await command('batch', 'approve', 'cli-batch', '--digest', review.reviewDigest, '--confirm');
    const results = await command('batch', 'run', 'cli-batch', '--headless');
    assert.equal(results[0].state, 'submitted');
    assert.equal(p.submissions.length, 1);
    assert.equal((await command('application', 'status', 'cli-application')).state, 'submitted');
    await command('batch', 'run', 'cli-batch', '--headless');
    assert.equal(p.submissions.length, 1);
    const metadata = JSON.parse(await readFile(path.join(root, 'runtime', 'bridge.json'), 'utf8'));
    assert.ok(metadata.port);
  } finally {
    await command('browser', 'close').catch(() => {});
    for (let attempt = 0; attempt < 50; attempt++) {
      const locked = await access(path.join(root, 'runtime', '.bridge.lock')).then(
        () => true,
        () => false,
      );
      if (!locked) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await p.close();
    await rm(root, { recursive: true, force: true });
  }
});
