import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { Store } from '../src/adapters/store.js';
import { Kit } from '../src/application/kit.js';
import { Renderer } from '../src/adapters/renderer.js';
import { Profile, Packet } from '../src/domain/models.js';
import type { ArtifactRenderer, CredentialVault } from '../src/application/ports.js';

export class FakeVault implements CredentialVault {
  readonly password = 'Fixture-only-vault-value-9!';
  readonly items = new Map<string, { email: string; password: string; uris: string[] }>();
  creates = 0;
  async lookup(key: string) {
    const value = this.items.get(key);
    if (!value) throw new Error('Vault locked or item missing');
    return value;
  }
  async create(email: string, origin: string) {
    const id = `fixture-${++this.creates}`;
    this.items.set(id, { email, password: this.password, uris: [origin] });
    return id;
  }
}
export const fakeRenderer: ArtifactRenderer = {
  async render(model) {
    return {
      files: Object.fromEntries(
        [
          'resume.pdf',
          'resume.docx',
          'resume.md',
          'cover-letter.pdf',
          'cover-letter.docx',
          'cover-letter.md',
          'email.md',
        ].map((name) => [name, new TextEncoder().encode(`${name}\n${JSON.stringify(model)}`)]),
      ),
      pages: { resume: 1, coverLetter: 1 },
    };
  },
};
export async function setup(realRenderer = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'applykit-test-'));
  const store = new Store(root),
    vault = new FakeVault(),
    kit = new Kit(store, realRenderer ? new Renderer() : { render: fakeRenderer.render }, vault);
  await kit.init(true);
  const profile = Profile.parse(
    JSON.parse(await readFile(new URL('../examples/profile.json', import.meta.url), 'utf8')),
  );
  await kit.importProfile(profile, true);
  return { root, store, vault, kit, cleanup: () => rm(root, { recursive: true, force: true }) };
}
export async function seed(
  kit: Kit,
  origin = 'https://careers.example.com',
  applicationId = 'application-one',
) {
  await kit.importCompanies([
    { version: 1, id: 'company', name: 'Fixture Company', careersUrl: origin },
  ]);
  await kit.addJob({
    version: 1,
    id: 'job',
    companyId: 'company',
    title: 'Backend Engineer',
    url: `${origin}/apply`,
    sourceUrl: `${origin}/apply`,
    description: 'Build reliable APIs',
    verifiedAt: new Date().toISOString(),
  });
  await kit.prepare('job', applicationId);
  await kit.build(applicationId);
  return applicationId;
}
export async function approve(kit: Kit, applicationId = 'application-one', batchId = 'batch-one') {
  const review = await kit.review(batchId, [applicationId]);
  await kit.approve(batchId, review.reviewDigest);
  return batchId;
}
export function applicationPacket(
  origin: string,
  appId = 'application-one',
  extra: Record<string, unknown> = {},
) {
  return Packet.parse({
    version: 1,
    applicationId: appId,
    destination: `${origin}/apply`,
    allowedOrigins: [origin],
    answers: { fullName: 'Alex Morgan', email: 'alex.jobs@example.com', consent: true },
    steps: [
      { action: 'navigate', url: `${origin}/apply` },
      { action: 'fill', selector: '#name', answer: 'fullName' },
      { action: 'fill', selector: '#email', answer: 'email' },
      { action: 'check', selector: '#consent', answer: 'consent' },
      { action: 'upload', selector: '#resume', document: 'resume.pdf' },
      {
        action: 'submit',
        selector: '#submit',
        checks: [
          { selector: '#name', answer: 'fullName' },
          { selector: '#email', answer: 'email' },
          { selector: '#consent', answer: 'consent' },
          { selector: '#resume', document: 'resume.pdf' },
        ],
        confirmationSelector: '#confirmation',
        confirmationText: 'Application received',
      },
    ],
    ...extra,
  });
}
export async function portal(
  options: { requireLogin?: boolean; uncertain?: boolean; branch?: boolean } = {},
) {
  const submissions: string[] = [],
    registrations: string[] = [];
  let logins = 0;
  const layout = (body: string) =>
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Fixture Careers</title><body>${body}</body></html>`;
  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';
    let body = '';
    for await (const chunk of req) body += chunk.toString();
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (req.method === 'POST' && url === '/submit') {
      submissions.push(body);
      res.end(
        layout(
          `<h1 id="confirmation">${options.uncertain ? 'Processing request' : 'Application received'}</h1>`,
        ),
      );
      return;
    }
    if (req.method === 'POST' && url === '/register') {
      registrations.push(body);
      res.setHeader('set-cookie', 'session=fixture; HttpOnly; SameSite=Strict; Path=/');
      res.end(layout('<h1 id="registered">Account created</h1><a href="/apply">Apply</a>'));
      return;
    }
    if (req.method === 'POST' && url === '/login') {
      logins++;
      res.setHeader('set-cookie', 'session=fixture; HttpOnly; SameSite=Strict; Path=/');
      res.end(layout('<h1 id="logged-in">Signed in</h1><a href="/apply">Apply</a>'));
      return;
    }
    if (
      url === '/signup' ||
      url === '/login' ||
      (options.requireLogin && !req.headers.cookie?.includes('session=fixture'))
    ) {
      const signup = url === '/signup';
      res.end(
        layout(
          `<form action="/${signup ? 'register' : 'login'}" method="post"><label>Email<input id="login-email" name="email" type="email" required></label><label>Password<input id="password" name="password" type="password" required></label><button id="${signup ? 'register' : 'login'}">${signup ? 'Create account' : 'Sign in'}</button></form>`,
        ),
      );
      return;
    }
    res.end(
      layout(
        `<form method="post" action="/submit" enctype="multipart/form-data"><label>Name<input id="name" name="name" required></label><label>Email<input id="email" type="email" name="email" required></label><label>Consent<input id="consent" type="checkbox" name="consent" required></label><label>Resume<input id="resume" type="file" name="resume" required></label>${options.branch ? '<label>Country<select id="country" name="country" onchange="document.querySelector(\'#extra\').hidden=this.value!==\'other\'"><option value="local">Local</option><option value="other">Other</option></select></label><div id="extra" hidden><label>Permit<input id="permit" name="permit"></label></div>' : ''}<button id="submit">Apply now</button></form>`,
      ),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture bind failed');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    submissions,
    registrations,
    get logins() {
      return logins;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}
