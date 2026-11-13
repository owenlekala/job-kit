import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/adapters/store.js';
import { installSkills } from '../src/adapters/skills.js';
import { Application, Build, Draft, Packet } from '../src/domain/models.js';
import { setup, seed, replaceProfile, approve, applicationPacket } from './support.js';

test('private storage is atomic, path-contained, locked, and idempotent', async () => {
  const s = await setup();
  try {
    await s.kit.init(false);
    assert.equal((await s.kit.config()).allowLocalhost, true);
    assert.throws(() => s.store.file('../outside'));
    assert.throws(() => s.store.record('jobs', '../../bad'));
    await s.store.lock(async () => {
      await assert.rejects(
        s.store.lock(async () => 1),
        /busy/,
      );
    });
    const repo = path.join(s.root, 'repo');
    await mkdir(path.join(repo, '.git'), { recursive: true });
    await assert.rejects(new Store(path.join(repo, 'private')).initialize(), /outside every Git/);
    assert.equal(
      (await readdir(s.root)).some((f) => f.endsWith('.tmp')),
      false,
    );
  } finally {
    await s.cleanup();
  }
});
test('reviews bind document bytes, source facts, and form answers', async () => {
  const s = await setup();
  try {
    await seed(s.kit);
    const batch = await approve(s.kit);
    await s.kit.approvedContext('application-one', batch);
    const p = await s.store.read('applications/application-one/packet.json', Packet);
    p.answers.email = 'changed@example.com';
    await s.store.write('applications/application-one/packet.json', p);
    await assert.rejects(s.kit.approvedContext('application-one', batch), /invalidated/);
    await s.kit.build('application-one');
    await approve(s.kit);
    const build = await s.store.read('applications/application-one/build.json', Build);
    await s.store.writeBytes(
      `artifacts/application-one/${build.revision}/resume.pdf`,
      'replacement',
    );
    await assert.rejects(s.kit.approvedContext('application-one', batch), /Document changed/);
    await s.kit.build('application-one');
    await approve(s.kit);
    const profile = await s.kit.profile();
    profile.headline = 'Changed headline';
    await replaceProfile(s.kit, profile, true);
    await assert.rejects(s.kit.approvedContext('application-one', batch), /rebuild/);
  } finally {
    await s.cleanup();
  }
});
test('drafts, jobs, destinations, plans, company and account changes invalidate approval', async () => {
  for (const change of ['draft', 'job', 'destination', 'step', 'company', 'account']) {
    const s = await setup();
    try {
      await seed(s.kit);
      await s.kit.connectAccount({
        id: 'account',
        origin: 'https://careers.example.com',
        tenant: 'company',
        create: true,
      });
      const p = await s.store.read('applications/application-one/packet.json', Packet);
      p.accountIds = ['account'];
      await s.store.write('applications/application-one/packet.json', p);
      await approve(s.kit);
      if (change === 'draft') {
        const d = await s.store.read('applications/application-one/draft.json', Draft);
        d.headline = 'Changed';
        await s.store.write('applications/application-one/draft.json', d);
      }
      if (change === 'job') {
        const c = await s.kit.context('application-one');
        await s.kit.addJob({ ...c.job, title: 'New role' });
      }
      if (change === 'destination') {
        p.destination = 'https://careers.example.com/other';
        await s.store.write('applications/application-one/packet.json', p);
      }
      if (change === 'step') {
        p.steps = [{ action: 'handoff', message: 'New action', checks: [] }];
        await s.store.write('applications/application-one/packet.json', p);
      }
      if (change === 'company') {
        await s.kit.importCompanies([{ version: 1, id: 'company', name: 'Changed Company' }]);
      }
      if (change === 'account') {
        const account = await s.kit.connectAccount({
          id: 'account',
          origin: 'https://careers.example.com',
          tenant: 'company',
          itemId: 'fixture-1',
        });
        await s.store.put('accounts', 'account', { ...account, tenant: 'different' });
      }
      await assert.rejects(
        s.kit.approvedContext('application-one', 'batch-one'),
        /changed|invalidated/,
        change,
      );
    } finally {
      await s.cleanup();
    }
  }
});
test('new review and exact review digest are required after edits', async () => {
  const s = await setup();
  try {
    await seed(s.kit);
    const review = await s.kit.review('batch', ['application-one']);
    await assert.rejects(s.kit.approve('batch', 'wrong-digest'), /digest mismatch/);
    const c = await s.kit.context('application-one');
    await s.kit.updateApplication('application-one', {
      packet: { ...c.packet, answers: { ...c.packet.answers, custom: 'A new answer' } },
    });
    await assert.rejects(s.kit.approve('batch', review.reviewDigest), /changed since review/);
    await s.kit.build('application-one');
    const next = await s.kit.review('batch', ['application-one']);
    await s.kit.approve('batch', next.reviewDigest);
    assert.equal(
      (await s.store.get('applications', 'application-one', Application)).state,
      'approved',
    );
  } finally {
    await s.cleanup();
  }
});
test('page overflow is reported and blocks approval until explicitly accepted', async () => {
  const s = await setup();
  try {
    s.kit.renderer.render = async (model) => ({
      files: Object.fromEntries(
        [
          'resume.pdf',
          'resume.docx',
          'resume.md',
          'cover-letter.pdf',
          'cover-letter.docx',
          'cover-letter.md',
          'email.md',
        ].map((n) => [n, new TextEncoder().encode(model.name)]),
      ),
      pages: { resume: 3, coverLetter: 2 },
    });
    await seed(s.kit);
    await assert.rejects(s.kit.review('batch', ['application-one']), /page target/);
    await s.kit.build('application-one', true);
    await approve(s.kit);
  } finally {
    await s.cleanup();
  }
});
test('vault references are tenant scoped and never serialize passwords', async () => {
  const s = await setup();
  try {
    const a = await s.kit.connectAccount({
      id: 'workday-company',
      origin: 'https://careers.example.com',
      tenant: 'company',
      create: true,
    });
    assert.equal(a.email, 'alex.jobs@example.com');
    assert.ok(a.itemId);
    assert.equal(JSON.stringify(a).includes(s.vault.password), false);
    await assert.rejects(
      s.kit.connectAccount({ id: 'duplicate', origin: a.origin, tenant: a.tenant, create: true }),
      /already exists/,
    );
    await assert.rejects(
      s.kit.connectAccount({
        id: 'wrong-origin',
        origin: 'https://other.example.com',
        tenant: 'other',
        itemId: a.itemId,
      }),
      /does not match/,
    );
    await seed(s.kit);
    await approve(s.kit);
    assert.equal(
      (await readFile(s.store.file('reviews/batch-one.json'), 'utf8')).includes(s.vault.password),
      false,
    );
  } finally {
    await s.cleanup();
  }
});
test('packet validation rejects missing answers and unreviewed origins', async () => {
  const s = await setup();
  try {
    const p = applicationPacket('https://careers.example.com');
    p.steps[0]!.url = 'https://other.example.com';
    await assert.rejects(s.kit.validatePacket(p), /outside reviewed/);
    p.steps[0]!.url = p.destination;
    delete p.answers.fullName;
    await assert.rejects(s.kit.validatePacket(p), /Missing answer/);
  } finally {
    await s.cleanup();
  }
});
test('role presets select verified evidence and reject invented or unverified facts', async () => {
  const s = await setup();
  try {
    await s.kit.savePreset({
      version: 1,
      id: 'backend',
      name: 'Backend',
      factIds: ['backend', 'delivery'],
    });
    await assert.rejects(
      s.kit.savePreset({ version: 1, id: 'invalid', name: 'Invalid', factIds: ['invented'] }),
      /verified/,
    );
    await seed(s.kit);
    const prepared = await s.kit.prepare('job', 'preset-application', ['backend', 'delivery']);
    assert.equal(prepared.application.id, 'preset-application');
    assert.deepEqual((await s.kit.context('preset-application')).draft.factIds, [
      'backend',
      'delivery',
    ]);
  } finally {
    await s.cleanup();
  }
});
test('skills install for all agents, rerun safely, and detect conflicts', async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'applykit-skills-'));
  try {
    const r = await installSkills('all', target);
    assert.equal(r.installed.length, 21);
    await installSkills('all', target);
    const file = path.join(target, '.agents', 'skills', 'tailor-resume', 'SKILL.md');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, 'user modification');
    await assert.rejects(installSkills('all', target), /differs/);
    await installSkills('all', target, { overwrite: true });
    assert.match(await readFile(file, 'utf8'), /name: tailor-resume/);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
