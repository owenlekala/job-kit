import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PlaywrightBrowser } from '../src/adapters/browser.js';
import { setup, seed, approve, applicationPacket } from './support.js';
import { ApplicationRunner } from '../src/application/runner.js';

async function fixture() {
  let autosaves = 0,
    submissions = 0;
  const server = createServer(async (request, response) => {
    const route = request.url ?? '/';
    if (request.method === 'POST') {
      for await (const _chunk of request) {
        /* consume fixture body */
      }
      if (route === '/autosave') autosaves++;
      if (route === '/submit') submissions++;
    }
    response.setHeader('content-type', 'text/html; charset=utf-8');
    const content =
      route === '/embedded'
        ? '<iframe id="application-frame" src="/form"></iframe>'
        : route === '/form'
          ? '<form method="post" action="/submit"><label>Name<input id="name" name="name" required></label><button id="submit">Submit</button></form>'
          : route === '/submit'
            ? '<h1 id="confirmation">Application received</h1>'
            : route === '/custom'
              ? '<div role="combobox" id="country" aria-label="Country" tabindex="0" onclick="document.querySelector(\'#options\').hidden=false">Choose country</div><div id="options" hidden><div role="option" id="local" onclick="document.querySelector(\'#country\').textContent=\'South Africa\';document.querySelector(\'#options\').hidden=true">South Africa</div></div>'
              : route === '/sso'
                ? '<button type="button" id="sso" onclick="window.open(\'/identity\')">Sign in with identity provider</button><h1 id="notice">Identity verification requires a handoff</h1>'
                : route === '/identity'
                  ? '<h1>Identity provider</h1>'
                  : "<label>Name<input id=\"name\" oninput=\"fetch('/autosave',{method:'POST',body:this.value}).catch(()=>document.querySelector('#status').textContent='Autosave blocked')\"></label><p id=\"status\"></p>";
    response.end(
      `<!doctype html><html><title>Portal coverage fixture</title><body>${content}</body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not start');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    get autosaves() {
      return autosaves;
    },
    get submissions() {
      return submissions;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

test('reviewed embedded forms expose controls, verify answers, and submit through frame-scoped selectors', async () => {
  const portal = await fixture(),
    s = await setup();
  const browser = new PlaywrightBrowser([portal.origin], false, true);
  const failures: string[] = [];
  const wait = browser.wait.bind(browser);
  browser.wait = async (...args) => { try { return await wait(...args); } catch (error) { failures.push(String(error)); throw error; } };
  const click = browser.click.bind(browser);
  browser.click = async (...args) => { try { return await click(...args); } catch (error) { failures.push(String(error)); throw error; } };
  try {
    await seed(s.kit, portal.origin);
    const prefix = '#application-frame >>>frame>>> ';
    const packet = applicationPacket(portal.origin, 'application-one', {
      destination: `${portal.origin}/embedded`,
      answers: { fullName: 'Alex Morgan' },
      steps: [
        { action: 'navigate', url: `${portal.origin}/embedded` },
        { action: 'fill', selector: prefix + '#name', answer: 'fullName' },
        {
          action: 'submit',
          selector: prefix + '#submit',
          checks: [{ selector: prefix + '#name', answer: 'fullName' }],
          confirmationSelector: prefix + '#confirmation',
          confirmationText: 'Application received',
        },
      ],
    });
    await s.kit.updateApplication('application-one', { packet });
    await s.kit.build('application-one');
    await approve(s.kit);
    await browser.navigate(`${portal.origin}/embedded`);
    const snapshot = JSON.stringify(await browser.snapshot());
    assert.match(snapshot, /application-frame/);
    assert.match(snapshot, /Name/);
    const result = await new ApplicationRunner(s.kit, browser).run('application-one', 'batch-one');
    assert.equal(result.state, 'submitted', failures.join('\n') + ' submissions=' + portal.submissions + ' snapshot=' + JSON.stringify(await browser.snapshot()));
    assert.equal(portal.submissions, 1);
  } finally {
    await browser.close();
    await s.cleanup();
    await portal.close();
  }
});

test('unreviewed autosave is blocked and native field values remain inspectable only through structured checks', async () => {
  const portal = await fixture(),
    browser = new PlaywrightBrowser([portal.origin], false, true);
  try {
    await browser.navigate(`${portal.origin}/autosave-form`);
    await browser.fill('#name', 'Alex Morgan');
    await browser.wait('#status', 'Autosave blocked');
    assert.equal(portal.autosaves, 0);
    assert.equal((await browser.snapshot()).text.includes('Alex Morgan'), false);
  } finally {
    await browser.close();
    await portal.close();
  }
});

test('custom widgets are described and unsupported selection causes a resumable handoff', async () => {
  const portal = await fixture(),
    s = await setup(),
    browser = new PlaywrightBrowser([portal.origin], false, true);
  try {
    await seed(s.kit, portal.origin);
    const packet = applicationPacket(portal.origin, 'application-one', {
      destination: `${portal.origin}/custom`,
      answers: { country: 'South Africa' },
      steps: [
        { action: 'navigate', url: `${portal.origin}/custom` },
        { action: 'select', selector: '#country', answer: 'country' },
        { action: 'handoff', message: 'Review the custom country selector' },
      ],
    });
    await s.kit.updateApplication('application-one', { packet });
    await s.kit.build('application-one');
    await approve(s.kit);
    await browser.navigate(`${portal.origin}/custom`);
    assert.match(JSON.stringify(await browser.snapshot()), /combobox/);
    const result = await new ApplicationRunner(s.kit, browser).run('application-one', 'batch-one');
    assert.equal(result.state, 'handoff');
    assert.equal(result.nextStep, 1);
    assert.equal(portal.submissions, 0);
  } finally {
    await browser.close();
    await s.cleanup();
    await portal.close();
  }
});

test('SSO flows explicitly pause for user verification and never imply successful authentication', async () => {
  const portal = await fixture(),
    s = await setup(),
    browser = new PlaywrightBrowser([portal.origin], false, true);
  try {
    await seed(s.kit, portal.origin);
    const packet = applicationPacket(portal.origin, 'application-one', {
      destination: `${portal.origin}/sso`,
      answers: {},
      steps: [
        { action: 'navigate', url: `${portal.origin}/sso` },
        {
          action: 'handoff',
          message:
            'Complete identity-provider login in an approved supported flow, then inspect and revise the plan. Popups are not automated.',
        },
      ],
    });
    await s.kit.updateApplication('application-one', { packet });
    await s.kit.build('application-one');
    await approve(s.kit);
    const result = await new ApplicationRunner(s.kit, browser).run('application-one', 'batch-one');
    assert.equal(result.state, 'handoff');
    assert.equal(portal.submissions, 0);
    assert.match(JSON.stringify(await browser.snapshot()), /SSO popups/);
  } finally {
    await browser.close();
    await s.cleanup();
    await portal.close();
  }
});
