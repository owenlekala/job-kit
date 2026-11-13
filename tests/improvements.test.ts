import { z } from 'zod';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setup, seed, replaceProfile, approve } from './support.js';
import { ProfileRevision } from '../src/application/profiles.js';
import { migrateWorkspace } from '../src/application/maintenance.js';
import {
  Application,
  Batch,
  Profile,
  WorkspaceConfig,
  validateEvidence,
  Draft,
} from '../src/domain/models.js';
import { reviewClaims } from '../src/domain/claims.js';
import { canonicalJobUrl } from '../src/domain/jobs.js';
import { Store } from '../src/adapters/store.js';
import { createBackup, restoreBackup } from '../src/adapters/archive.js';
import { writeReviewPage } from '../src/adapters/review-page.js';

test('profile replacements require a current preview, retain revisions, and reject stale previews', async () => {
  const s = await setup();
  try {
    const original = await s.kit.profile();
    const value = { ...original, headline: 'Updated headline' };
    await assert.rejects(s.kit.importProfile(value), /already exists/);
    const preview = await s.kit.previewProfile(value, 'replace', true);
    assert.equal(preview.changes.fields[0]?.field, 'headline');
    await assert.rejects(
      s.kit.importProfile(value, true, { mode: 'replace', reviewDigest: 'stale' }),
      /preview digest/,
    );
    await s.store.lock(() =>
      s.kit.importProfile(value, true, { mode: 'replace', reviewDigest: preview.digest }),
    );
    assert.equal((await s.kit.profile()).headline, 'Updated headline');
    assert.equal((await s.store.list('profile-history', ProfileRevision)).length, 2);
    await assert.rejects(
      s.kit.importProfile(value, true, { mode: 'replace', reviewDigest: preview.digest }),
      /preview digest/,
    );
    const restore = await s.kit.previewProfile(original, 'replace', true);
    await s.kit.importProfile(original, true, { mode: 'replace', reviewDigest: restore.digest });
    assert.equal((await s.kit.profile()).headline, original.headline);
  } finally {
    await s.cleanup();
  }
});

test('profile merges keep unrelated facts and unresolved conflicts prevent verification', async () => {
  const s = await setup();
  try {
    const profile = await s.kit.profile();
    const incoming = {
      ...profile,
      facts: [
        {
          id: 'new',
          kind: 'education',
          text: 'Diploma studies',
          verified: false,
          sources: [{ reference: 'source-one', note: 'Applicant supplied transcript' }],
          conflicts: [{ field: 'completion', alternatives: ['incomplete', 'completed'] }],
        },
      ],
    };
    const preview = await s.kit.previewProfile(incoming, 'merge');
    await s.kit.importProfile(incoming, false, { mode: 'merge', reviewDigest: preview.digest });
    assert.equal((await s.kit.profile()).facts.length, profile.facts.length + 1);
    await assert.rejects(s.kit.verifyFacts(['new']), /Resolve conflicts/);
    const updated = await s.kit.profile();
    const fact = updated.facts.find((f) => f.id === 'new')!;
    fact.conflicts![0]!.resolved = 'incomplete';
    await replaceProfile(s.kit, updated, true);
    await s.kit.verifyFacts(['new'], 'Reviewed transcript with the applicant');
    const verified = (await s.kit.profile()).facts.find((f) => f.id === 'new')!;
    assert.equal(verified.verification?.method, 'user-confirmation');
    assert.equal(verified.verification?.note, 'Reviewed transcript with the applicant');
    assert.equal(verified.sources?.[0]?.reference, 'source-one');
  } finally {
    await s.cleanup();
  }
});

test('claim review flags unsupported expertise and binds explicit verification to current wording', async () => {
  const s = await setup();
  try {
    await seed(s.kit);
    const c = await s.kit.context('application-one');
    const draft = Draft.parse({
      ...c.draft,
      coverLetter: [
        {
          text: 'I am a certified Python expert with 12 years of experience.',
          evidence: ['backend'],
        },
      ],
    });
    assert.ok(reviewClaims(c.profile, draft).some((claim) => claim.flags.length >= 3));
    await s.kit.updateApplication('application-one', { draft });
    await s.kit.build('application-one');
    await assert.rejects(s.kit.review('claims', ['application-one']), /wording|Wording/);
    const review = await s.kit.claims('application-one');
    await assert.rejects(
      s.kit.claims('application-one', { digest: 'old', note: 'Reviewed' }),
      /current claim review/,
    );
    await s.kit.claims('application-one', {
      digest: review.digest,
      note: 'Fixture attestation only',
    });
    await s.kit.review('claims', ['application-one']);
    const changed = Draft.parse({
      ...draft,
      coverLetter: [
        {
          text: 'I am a certified Python expert with 15 years of experience.',
          evidence: ['backend'],
        },
      ],
    });
    await s.kit.updateApplication('application-one', { draft: changed });
    await s.kit.build('application-one');
    await assert.rejects(s.kit.review('claims', ['application-one']), /Wording/);
    const transferable = Draft.parse({
      ...c.draft,
      coverLetter: [
        {
          text: 'My TypeScript experience provides a foundation for learning Python.',
          evidence: ['backend'],
        },
      ],
    });
    assert.equal(reviewClaims(c.profile, transferable).flatMap((c) => c.flags).length, 0);
  } finally {
    await s.cleanup();
  }
});

test('em dashes are rejected in selected facts, summaries, and application emails', async () => {
  const s = await setup();
  try {
    await seed(s.kit);
    const c = await s.kit.context('application-one');
    assert.throws(
      () =>
        validateEvidence(
          c.profile,
          Draft.parse({
            ...c.draft,
            email: { ...c.draft.email, subject: 'Application \u2014 Alex' },
          }),
        ),
      /em dash/,
    );
    const model = await s.kit.build('application-one');
    const markdown = await s.store.readBytes(
      `artifacts/application-one/${model.build.revision}/cover-letter.md`,
    );
    assert.equal(new TextDecoder().decode(markdown).includes('\u2014'), false);
  } finally {
    await s.cleanup();
  }
});

test('workspace transactions roll back errors and replay durable interrupted commits', async () => {
  const s = await setup();
  try {
    await assert.rejects(
      s.store.lock(async () => {
        await s.store.write('notes/first.json', { value: 1 });
        assert.equal(
          (await s.store.read('notes/first.json', z.object({ value: z.number() }))).value,
          1,
        );
        await s.store.write('notes/second.json', { value: 2 });
        throw new Error('Simulated interruption before commit');
      }),
    );
    await assert.rejects(access(s.store.file('notes/first.json')));
    await writeFile(
      s.store.file('.transaction.json'),
      JSON.stringify({
        version: 1,
        entries: [
          { path: 'notes/first.json', data: Buffer.from('{"value":1}').toString('base64') },
          { path: 'notes/second.json', data: Buffer.from('{"value":2}').toString('base64') },
        ],
      }),
    );
    await assert.rejects(s.store.readBytes('profile.json'), /recovery/);
    await s.store.lock(async () => {});
    assert.equal(JSON.parse(await readFile(s.store.file('notes/second.json'), 'utf8')).value, 2);
    await assert.rejects(access(s.store.file('.transaction.json')));
  } finally {
    await s.cleanup();
  }
});

test('encrypted backups exclude runtime sessions, reject wrong passphrases, and revoke approvals on restore', async () => {
  const s = await setup(),
    directory = await mkdtemp(path.join(os.tmpdir(), 'applykit-archive-'));
  const target = new Store(path.join(directory, 'restored'));
  try {
    await seed(s.kit);
    await approve(s.kit);
    await s.store.write('runtime/bridge.json', { token: 'fixture-runtime-key' });
    const archive = path.join(directory, 'backup.applykit');
    await s.store.lock(() => createBackup(s.store, archive, 'fixture passphrase 123'));
    const encrypted = await readFile(archive, 'utf8');
    assert.equal(encrypted.includes('Alex Morgan'), false);
    assert.equal(encrypted.includes('fixture-runtime-key'), false);
    await target.initialize();
    await assert.rejects(
      target.lock(() => restoreBackup(target, archive, 'incorrect passphrase')),
      /decrypted/,
    );
    await target.lock(() => restoreBackup(target, archive, 'fixture passphrase 123'));
    assert.equal((await target.read('profile.json', Profile)).name, 'Alex Morgan');
    assert.equal((await target.get('batches', 'batch-one', Batch)).approvedAt, undefined);
    assert.equal(
      (await target.get('applications', 'application-one', Application)).state,
      'preparing',
    );
    await assert.rejects(access(target.file('runtime/bridge.json')));
    await assert.rejects(
      target.lock(() => restoreBackup(target, archive, 'fixture passphrase 123')),
      /new workspace/,
    );
    const damaged = JSON.parse(encrypted);
    damaged.tag = Buffer.alloc(16).toString('base64');
    const corrupt = path.join(directory, 'damaged.applykit');
    await writeFile(corrupt, JSON.stringify(damaged));
    const empty = new Store(path.join(directory, 'empty'));
    await empty.initialize();
    await assert.rejects(
      empty.lock(() => restoreBackup(empty, corrupt, 'fixture passphrase 123')),
      /decrypted/,
    );
  } finally {
    await s.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

test('legacy workspace upgrade is validated, additive, and idempotent', async () => {
  const s = await setup();
  try {
    await s.store.write('config.json', { version: 1, allowLocalhost: true });
    const before = await s.kit.profile();
    assert.equal((await s.store.lock(() => migrateWorkspace(s.store))).changed, true);
    assert.equal((await s.store.read('config.json', WorkspaceConfig)).schemaVersion, 2);
    assert.deepEqual(await s.kit.profile(), before);
    assert.equal((await s.store.lock(() => migrateWorkspace(s.store))).changed, false);
  } finally {
    await s.cleanup();
  }
});

test('job duplicates, closure, and deadlines block repeated or stale applications; follow-up dates persist', async () => {
  const s = await setup();
  try {
    await seed(s.kit);
    const { job } = await s.kit.context('application-one');
    assert.equal(
      canonicalJobUrl('https://example.org/job?jobId=1&utm_source=mail#apply'),
      'https://example.org/job?jobId=1',
    );
    await assert.rejects(
      s.kit.addJob({ ...job, id: 'duplicate', url: job.url + '?utm_source=mail' }),
      /duplicate job/,
    );
    await s.kit.addJob({ ...job, status: 'closed', closedAt: new Date().toISOString() });
    await assert.rejects(s.kit.prepare('job', 'closed'), /closed/);
    await assert.rejects(s.kit.review('closed', ['application-one']), /changed|closed/);
    await s.kit.addJob({ ...job, deadline: '2001-01-01' });
    await assert.rejects(s.kit.prepare('job', 'expired'), /deadline/);
    const app = await s.kit.track('application-one', '2026-12-01', 'Follow up if no response');
    assert.equal(app.followUpAt, '2026-12-01');
    await assert.rejects(s.kit.track('application-one', 'tomorrow'), /Invalid/);
  } finally {
    await s.cleanup();
  }
});

test('private review page escapes job content and includes previews, evidence, and changed fields', async () => {
  const s = await setup();
  try {
    await seed(s.kit);
    const context = await s.kit.context('application-one');
    await s.kit.addJob({ ...context.job, description: '<script>alert(1)</script>' });
    await s.kit.build('application-one');
    const review = await s.kit.review('visual-review', ['application-one']);
    const page = await writeReviewPage(s.store, 'visual-review');
    assert.equal(page.reviewDigest, review.reviewDigest);
    const html = await readFile(page.reviewPage, 'utf8');
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes('<script>alert'));
    assert.match(html, /Claims and supporting facts/);
    assert.match(html, /resume.pdf/);
    await s.kit.review('visual-review', ['application-one']);
    await writeReviewPage(s.store, 'visual-review');
    assert.match(await readFile(page.reviewPage, 'utf8'), /previous review: None/);
  } finally {
    await s.cleanup();
  }
});

test('a checkpoint durably records an irreversible-action boundary even if later preparation fails', async () => {
  const s = await setup();
  try {
    await assert.rejects(
      s.store.lock(async () => {
        await s.store.write('notes/attempt.json', { state: 'commit-started' });
        await s.store.checkpoint();
        assert.equal(
          JSON.parse(await readFile(s.store.file('notes/attempt.json'), 'utf8')).state,
          'commit-started',
        );
        await s.store.write('notes/after.json', { unsafe: true });
        throw new Error('Simulated process failure after durable boundary');
      }),
    );
    assert.equal(
      JSON.parse(await readFile(s.store.file('notes/attempt.json'), 'utf8')).state,
      'commit-started',
    );
    await assert.rejects(access(s.store.file('notes/after.json')));
  } finally {
    await s.cleanup();
  }
});

test('failed journal replay cannot be overwritten by a later write in the same operation', async () => {
  const s = await setup();
  const original = s.store.writeBytes.bind(s.store);
  let fail = true;
  s.store.writeBytes = async (relative, bytes) => {
    if (
      relative === 'notes/second.json' &&
      fail &&
      (await access(s.store.file('.transaction.json')).then(
        () => true,
        () => false,
      ))
    )
      throw new Error('Simulated disk error during replay');
    return original(relative, bytes);
  };
  try {
    await assert.rejects(
      s.store.lock(async () => {
        await s.store.write('notes/first.json', { value: 1 });
        await s.store.write('notes/second.json', { value: 2 });
        await assert.rejects(s.store.checkpoint(), /disk error/);
        await s.store.write('notes/replacement.json', { lost: true });
      }),
      /interrupted/,
    );
    const journal = JSON.parse(await readFile(s.store.file('.transaction.json'), 'utf8'));
    assert.equal(journal.entries.length, 2);
    fail = false;
    await s.store.lock(async () => {});
    assert.equal(JSON.parse(await readFile(s.store.file('notes/second.json'), 'utf8')).value, 2);
    await assert.rejects(access(s.store.file('notes/replacement.json')));
  } finally {
    await s.cleanup();
  }
});
