import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { z } from 'zod';
import { PlaywrightBrowser } from '../src/adapters/browser.js';
import { bridgeCommand, serveBridge } from '../src/adapters/bridge.js';
import { ApplicationRunner } from '../src/application/runner.js';
import { Application } from '../src/domain/models.js';
import { setup, seed, approve, applicationPacket, portal } from './support.js';

async function prepare(
  s: Awaited<ReturnType<typeof setup>>,
  origin: string,
  packet = applicationPacket(origin),
) {
  await seed(s.kit, origin);
  await s.kit.updateApplication('application-one', { packet });
  await s.kit.build('application-one');
  return approve(s.kit);
}
test('fixture application uploads approved bytes, confirms receipt and prevents duplicates', async () => {
  const s = await setup(),
    p = await portal(),
    browser = new PlaywrightBrowser([p.origin], false, true);
  try {
    const batch = await prepare(s, p.origin),
      runner = new ApplicationRunner(s.kit, browser);
    const result = await runner.run('application-one', batch);
    assert.equal(result.state, 'submitted');
    assert.equal(p.submissions.length, 1);
    assert.match(p.submissions[0]!, /filename="resume.pdf"/);
    assert.match(p.submissions[0]!, /Alex Morgan/);
    const attempts = await readdir(s.store.file('attempts/application-one'));
    assert.equal(attempts.length, 1);
    await assert.rejects(runner.run('application-one', batch), /will not be retried/);
    assert.equal(p.submissions.length, 1);
  } finally {
    await browser.close();
    await p.close();
    await s.cleanup();
  }
});
test('portal account creation injects vault credentials, then submits with a session', async () => {
  const s = await setup(),
    p = await portal({ requireLogin: true }),
    browser = new PlaywrightBrowser([p.origin], false, true);
  try {
    await s.kit.connectAccount({
      id: 'portal-account',
      origin: p.origin,
      tenant: 'fixture',
      create: true,
    });
    const packet = applicationPacket(p.origin);
    packet.accountIds = ['portal-account'];
    packet.answers.loginEmail = 'alex.jobs@example.com';
    packet.steps.unshift(
      { action: 'navigate', url: `${p.origin}/signup`, checks: [] },
      {
        action: 'credential',
        selector: '#login-email',
        accountId: 'portal-account',
        credential: 'email',
        checks: [],
      },
      {
        action: 'credential',
        selector: '#password',
        accountId: 'portal-account',
        credential: 'password',
        checks: [],
      },
      {
        action: 'register',
        selector: '#register',
        checks: [{ selector: '#login-email', answer: 'loginEmail' }],
        confirmationSelector: '#registered',
        confirmationText: 'Account created',
      },
    );
    const batch = await prepare(s, p.origin, packet);
    const result = await new ApplicationRunner(s.kit, browser).run('application-one', batch);
    assert.equal(result.state, 'submitted');
    assert.equal(p.registrations.length, 1);
    assert.equal(p.submissions.length, 1);
    assert.equal(new URLSearchParams(p.registrations[0]).get('password'), s.vault.password);
    const appText = await readFile(s.store.file('applications/application-one.json'), 'utf8');
    const review = await readFile(s.store.file('reviews/batch-one.json'), 'utf8');
    assert.equal((appText + review).includes(s.vault.password), false);
  } finally {
    await browser.close();
    await p.close();
    await s.cleanup();
  }
});
test('existing account login and reviewed branching answers complete successfully', async () => {
  const s = await setup(),
    p = await portal({ requireLogin: true, branch: true }),
    browser = new PlaywrightBrowser([p.origin], false, true);
  try {
    await s.kit.connectAccount({
      id: 'account',
      origin: p.origin,
      tenant: 'fixture',
      create: true,
    });
    const packet = applicationPacket(p.origin);
    packet.accountIds = ['account'];
    packet.answers.country = 'other';
    packet.answers.permit = 'User-confirmed permit';
    packet.steps.unshift(
      { action: 'navigate', url: `${p.origin}/login`, checks: [] },
      {
        action: 'credential',
        selector: '#login-email',
        accountId: 'account',
        credential: 'email',
        checks: [],
      },
      {
        action: 'credential',
        selector: '#password',
        accountId: 'account',
        credential: 'password',
        checks: [],
      },
      { action: 'login', selector: '#login', checks: [] },
    );
    packet.steps.splice(
      packet.steps.length - 1,
      0,
      { action: 'select', selector: '#country', answer: 'country', checks: [] },
      { action: 'fill', selector: '#permit', answer: 'permit', checks: [] },
    );
    packet.steps
      .at(-1)!
      .checks.push(
        { selector: '#country', answer: 'country' },
        { selector: '#permit', answer: 'permit' },
      );
    const batch = await prepare(s, p.origin, packet),
      result = await new ApplicationRunner(s.kit, browser).run('application-one', batch);
    assert.equal(result.state, 'submitted');
    assert.equal(p.logins, 1);
    assert.match(p.submissions[0]!, /User-confirmed permit/);
  } finally {
    await browser.close();
    await p.close();
    await s.cleanup();
  }
});
test('verification handoff preserves browser progress and resumes only explicitly', async () => {
  const s = await setup(),
    p = await portal(),
    browser = new PlaywrightBrowser([p.origin], false, true);
  try {
    const packet = applicationPacket(p.origin);
    packet.steps.splice(4, 0, {
      action: 'handoff',
      message: 'Complete verification in the browser',
      checks: [],
    });
    const batch = await prepare(s, p.origin, packet),
      runner = new ApplicationRunner(s.kit, browser);
    const paused = await runner.run('application-one', batch);
    assert.equal(paused.state, 'handoff');
    assert.equal(p.submissions.length, 0);
    await assert.rejects(runner.run('application-one', batch), /application resume/);
    assert.equal((await runner.run('application-one', batch, true)).state, 'submitted');
  } finally {
    await browser.close();
    await p.close();
    await s.cleanup();
  }
});
test('an unknown required question or missing approved check prevents submission', async () => {
  const s = await setup(),
    p = await portal({ branch: true }),
    browser = new PlaywrightBrowser([p.origin], false, true);
  try {
    const batch = await prepare(s, p.origin),
      result = await new ApplicationRunner(s.kit, browser).run('application-one', batch);
    assert.equal(result.state, 'handoff');
    assert.equal(p.submissions.length, 0);
    assert.equal(result.nextStep, 5);
  } finally {
    await browser.close();
    await p.close();
    await s.cleanup();
  }
});
test('failed preparation hands off without submitting', async () => {
  const s = await setup(),
    p = await portal(),
    browser = new PlaywrightBrowser([p.origin], false, true);
  try {
    const packet = applicationPacket(p.origin);
    packet.steps[1]!.selector = '#email'; // Name is not a valid email: final checks must fail.
    const batch = await prepare(s, p.origin, packet),
      result = await new ApplicationRunner(s.kit, browser).run('application-one', batch);
    assert.equal(result.state, 'handoff');
    assert.equal(p.submissions.length, 0);
  } finally {
    await browser.close();
    await p.close();
    await s.cleanup();
  }
});
test('unknown confirmation becomes uncertain and cannot be blindly retried', async () => {
  const s = await setup(),
    p = await portal({ uncertain: true }),
    browser = new PlaywrightBrowser([p.origin], false, true);
  try {
    const batch = await prepare(s, p.origin),
      runner = new ApplicationRunner(s.kit, browser),
      result = await runner.run('application-one', batch);
    assert.equal(result.state, 'uncertain');
    assert.equal(p.submissions.length, 1);
    await assert.rejects(runner.run('application-one', batch, true), /will not be retried/);
    await assert.rejects(
      runner.reconcile('application-one', 'registered', 'Wrong kind'),
      /does not match/,
    );
    const resolved = await runner.reconcile(
      'application-one',
      'submitted',
      'User verified the application in their dashboard',
    );
    assert.equal(resolved.state, 'submitted');
  } finally {
    await browser.close();
    await p.close();
    await s.cleanup();
  }
});
test('interrupted commits are recovered as uncertain without a new browser action', async () => {
  const s = await setup(),
    p = await portal(),
    browser = new PlaywrightBrowser([p.origin], false, true);
  try {
    const batch = await prepare(s, p.origin),
      app = await s.store.get('applications', 'application-one', Application);
    await s.kit.event(app, 'running', 'commit-started', 'Step 5: submit');
    const result = await new ApplicationRunner(s.kit, browser).run('application-one', batch, true);
    assert.equal(result.state, 'uncertain');
    assert.equal(p.submissions.length, 0);
  } finally {
    await browser.close();
    await p.close();
    await s.cleanup();
  }
});
test('browser blocks unreviewed origins, direct submit clicks, and plaintext password fills', async () => {
  const p = await portal(),
    browser = new PlaywrightBrowser([p.origin], false, true);
  try {
    await assert.rejects(browser.navigate('https://example.com'), /not been reviewed/);
    await browser.navigate(`${p.origin}/apply`);
    await assert.rejects(browser.click('#submit'), /explicit reviewed/);
    await browser.navigate(`${p.origin}/login`);
    await assert.rejects(browser.fill('#password', 'not-from-vault'), /vault credential/);
    await browser.fill('#password', 'redaction-fixture', true);
    const snapshot = JSON.stringify(await browser.snapshot());
    assert.equal(snapshot.includes('redaction-fixture'), false);
    assert.equal(snapshot.includes('value'), false);
  } finally {
    await browser.close();
    await p.close();
  }
});
test('authenticated bridge supports inspection and detects session expiry before replay', async () => {
  const s = await setup(),
    p = await portal();
  let bridge: Awaited<ReturnType<typeof serveBridge>> | undefined;
  try {
    const packet = applicationPacket(p.origin);
    packet.steps.splice(2, 0, { action: 'handoff', message: 'Verify this page', checks: [] });
    const batch = await prepare(s, p.origin, packet);
    bridge = await serveBridge(s.kit, false);
    await assert.rejects(serveBridge(s.kit, false), /already running/);
    const info = await s.store.read(
      'runtime/bridge.json',
      z.object({ port: z.number(), token: z.string(), pid: z.number() }),
    );
    const denied = await fetch(`http://127.0.0.1:${info.port}/command`, {
      method: 'POST',
      body: '{}',
    });
    assert.equal(denied.status, 403);
    const inspected = await bridgeCommand(
      s.kit,
      { action: 'inspect', applicationId: 'application-one' },
      false,
    );
    assert.ok(inspected);
    const paused = (await bridgeCommand(
      s.kit,
      {
        action: 'run',
        applicationId: 'application-one',
        batchId: batch,
        resume: false,
        restart: false,
      },
      false,
    )) as Application;
    assert.equal(paused.state, 'handoff');
    await bridge.shutdown();
    bridge = await serveBridge(s.kit, false);
    await bridgeCommand(s.kit, { action: 'inspect', applicationId: 'application-one' }, false);
    await assert.rejects(
      bridgeCommand(
        s.kit,
        {
          action: 'run',
          applicationId: 'application-one',
          batchId: batch,
          resume: true,
          restart: false,
        },
        false,
      ),
      /new browser session/,
    );
    const restarted = (await bridgeCommand(
      s.kit,
      {
        action: 'run',
        applicationId: 'application-one',
        batchId: batch,
        resume: true,
        restart: true,
      },
      false,
    )) as Application;
    assert.equal(restarted.state, 'handoff');
  } finally {
    await bridge?.shutdown();
    await p.close();
    await s.cleanup();
  }
});
