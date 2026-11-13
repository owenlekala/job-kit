import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import {
  Account,
  Application,
  Batch,
  Build,
  Company,
  Draft,
  Job,
  Packet,
  Profile,
  RolePreset,
  WorkspaceConfig,
  assertNoSecrets,
  checkWebUrl,
  digest,
  id,
  validateEvidence,
} from '../domain/models.js';
import { documentModel } from '../domain/documents.js';
import { startingDraft } from '../domain/drafting.js';
import type { ArtifactRenderer, CredentialVault, Workspace } from './ports.js';

const now = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}-${randomUUID()}`;
export const byteHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const requiredFiles = [
  'resume.pdf',
  'resume.docx',
  'resume.md',
  'cover-letter.pdf',
  'cover-letter.docx',
  'cover-letter.md',
  'email.md',
];
export class Kit {
  constructor(
    readonly store: Workspace,
    readonly renderer: ArtifactRenderer,
    readonly vault: CredentialVault,
  ) {}
  async init(allowLocalhost = false) {
    await this.store.initialize(allowLocalhost);
    return { workspace: this.store.root };
  }
  async config() {
    return this.store.read('config.json', WorkspaceConfig);
  }
  async profile() {
    const profile = await this.store.read('profile.json', Profile),
      config = await this.config();
    profile.contact.links.forEach((link) => checkWebUrl(link.url, config.allowLocalhost));
    profile.facts.forEach((fact) => {
      if (fact.kind === 'project' && fact.url) checkWebUrl(fact.url, config.allowLocalhost);
    });
    return profile;
  }
  async importProfile(value: unknown, confirm = false) {
    const config = await this.config();
    assertNoSecrets(value);
    const p = Profile.parse(value);
    p.contact.links.forEach((link) => checkWebUrl(link.url, config.allowLocalhost));
    p.facts.forEach((fact) => {
      if (fact.kind === 'project' && fact.url) checkWebUrl(fact.url, config.allowLocalhost);
    });
    if (!confirm) p.facts = p.facts.map((f) => ({ ...f, verified: false }));
    await this.store.write('profile.json', p);
    return {
      facts: p.facts.length,
      verified: p.facts.filter((f) => f.verified).length,
      notice: confirm
        ? 'Verification flags preserved by explicit confirmation'
        : 'All imported facts are unverified; review them before confirming',
    };
  }
  async importSource(name: string, source: string) {
    await this.config();
    if (!source.trim()) throw new Error('Source is empty');
    const key = newId('source');
    await this.store.put('sources', key, {
      version: 1,
      id: key,
      name,
      verified: false,
      importedAt: now(),
      content: source,
    });
    return {
      id: key,
      verified: false,
      message:
        'Source saved without execution. Extract facts into profile JSON, resolve conflicts, and explicitly confirm them.',
    };
  }
  async verifyFacts(factIds: string[]) {
    const p = await this.profile();
    for (const key of factIds) {
      const fact = p.facts.find((f) => f.id === key);
      if (!fact) throw new Error(`Unknown fact: ${key}`);
      fact.verified = true;
    }
    await this.store.write('profile.json', p);
    return { verified: factIds };
  }
  async validateProfile() {
    const p = await this.profile();
    const cfg = await this.config();
    p.contact.links.forEach((l) => checkWebUrl(l.url, cfg.allowLocalhost));
    return {
      valid: true,
      verified: p.facts.filter((f) => f.verified).length,
      unverified: p.facts.filter((f) => !f.verified).map((f) => f.id),
    };
  }
  async importCompanies(values: unknown[]) {
    const cfg = await this.config();
    const companies = values.map((value) => {
      assertNoSecrets(value);
      const c = Company.parse(value);
      if (c.careersUrl) checkWebUrl(c.careersUrl, cfg.allowLocalhost);
      if (c.sourceUrl) checkWebUrl(c.sourceUrl, cfg.allowLocalhost);
      if (c.recruitmentEmail && (!c.sourceUrl || !c.verifiedAt))
        throw new Error('Recruitment email requires a source URL and verification date');
      return c;
    });
    if (new Set(companies.map((c) => c.id)).size !== companies.length)
      throw new Error('Duplicate company IDs in import');
    for (const c of companies) await this.store.put('companies', c.id, c);
    return { imported: companies.map((c) => c.id) };
  }
  async addJob(value: unknown) {
    assertNoSecrets(value);
    const job = Job.parse(value),
      cfg = await this.config();
    checkWebUrl(job.url, cfg.allowLocalhost);
    checkWebUrl(job.sourceUrl, cfg.allowLocalhost);
    await this.store.get('companies', job.companyId, Company);
    await this.store.put('jobs', job.id, job);
    return job;
  }
  async connectAccount(value: {
    id: string;
    origin: string;
    tenant: string;
    pathPrefix?: string;
    itemId?: string;
    email?: string;
    create?: boolean;
  }) {
    id.parse(value.id);
    checkWebUrl(value.origin, (await this.config()).allowLocalhost);
    const origin = new URL(value.origin).origin;
    const pathPrefix = value.pathPrefix ?? new URL(value.origin).pathname;
    if (!pathPrefix.startsWith('/') || pathPrefix.includes('?') || pathPrefix.includes('#'))
      throw new Error('Account path prefix must be an absolute URL path');
    if (!value.tenant.trim()) throw new Error('Account tenant is required');
    const email =
      value.email ??
      (await this.profile()).contact.applicationEmail ??
      (await this.profile()).contact.email;
    z.email().parse(email);
    if (Boolean(value.itemId) === Boolean(value.create))
      throw new Error('Choose an existing --item or --create, not both');
    const accounts = await this.store.list('accounts', Account);
    const sameId = accounts.find((a) => a.id === value.id);
    if (sameId && (sameId.origin !== origin || sameId.tenant !== value.tenant))
      throw new Error('Account ID already belongs to another portal or tenant');
    const existing = accounts.find((a) => a.origin === origin && a.tenant === value.tenant);
    if (existing && (existing.id !== value.id || value.create))
      throw new Error(`An account already exists for this portal and tenant: ${existing.id}`);
    const itemId = value.create
      ? await this.vault.create(email, origin, value.tenant)
      : value.itemId!;
    const credential = await this.vault.lookup(itemId);
    if (
      credential.email !== email ||
      !credential.uris.some((u) => {
        try {
          return new URL(u).origin === origin;
        } catch {
          return false;
        }
      })
    )
      throw new Error('Vault username or portal origin does not match the account');
    const account = Account.parse({
      version: 1,
      id: value.id,
      origin,
      tenant: value.tenant,
      pathPrefix,
      email,
      itemId,
      mode: value.create ? 'create' : 'existing',
    });
    await this.store.put('accounts', account.id, account);
    return account;
  }
  async savePreset(value: unknown) {
    const preset = RolePreset.parse(value),
      profile = await this.profile();
    if (
      new Set(preset.factIds).size !== preset.factIds.length ||
      preset.factIds.some((key) => !profile.facts.some((f) => f.id === key && f.verified))
    )
      throw new Error('Presets require unique verified fact IDs');
    await this.store.put('presets', preset.id, preset);
    return preset;
  }
  async context(applicationId: string) {
    const application = await this.store.get('applications', applicationId, Application);
    const job = await this.store.get('jobs', application.jobId, Job);
    const company = await this.store.get('companies', job.companyId, Company);
    const profile = await this.profile();
    const draft = await this.store.read(`applications/${applicationId}/draft.json`, Draft);
    const packet = await this.store.read(`applications/${applicationId}/packet.json`, Packet);
    if (packet.applicationId !== application.id) throw new Error('Packet application ID mismatch');
    return { application, job, company, profile, draft, packet };
  }
  async prepare(jobId: string, applicationId = newId('application'), selectedIds?: string[]) {
    id.parse(applicationId);
    if ((await this.store.list('applications', Application)).some((a) => a.id === applicationId))
      throw new Error('Application ID already exists');
    const job = await this.store.get('jobs', jobId, Job),
      company = await this.store.get('companies', job.companyId, Company),
      profile = await this.profile();
    const selected = selectedIds ?? profile.facts.filter((f) => f.verified).map((f) => f.id);
    if (!selected.length)
      throw new Error('No verified facts available; confirm profile facts first');
    const date = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const draft = startingDraft(profile, job, company, selected, date);
    validateEvidence(profile, draft);
    const application = Application.parse({
      version: 1,
      id: applicationId,
      jobId,
      state: 'preparing',
      updatedAt: now(),
    });
    const packet = Packet.parse({
      version: 1,
      applicationId,
      destination: job.url,
      allowedOrigins: [new URL(job.url).origin],
      answers: {
        fullName: profile.name,
        email: profile.contact.applicationEmail ?? profile.contact.email,
      },
      steps: [],
    });
    await this.store.write(`applications/${applicationId}/draft.json`, draft);
    await this.store.write(`applications/${applicationId}/packet.json`, packet);
    await this.store.put('applications', applicationId, application);
    return {
      application,
      draft: this.store.file(`applications/${applicationId}/draft.json`),
      packet: this.store.file(`applications/${applicationId}/packet.json`),
    };
  }
  async validatePacket(packet: Packet) {
    assertNoSecrets(packet);
    const cfg = await this.config();
    checkWebUrl(packet.destination, cfg.allowLocalhost);
    const origins = new Set(
      packet.allowedOrigins.map((origin) => {
        checkWebUrl(origin, cfg.allowLocalhost);
        if (new URL(origin).origin !== origin)
          throw new Error(
            'allowedOrigins entries must be exact origins without paths or trailing slashes',
          );
        return origin;
      }),
    );
    if (!origins.has(new URL(packet.destination).origin))
      throw new Error('Destination origin must be allowed');
    const accounts = await Promise.all(
      packet.accountIds.map((key) => this.store.get('accounts', key, Account)),
    );
    if (new Set(packet.accountIds).size !== packet.accountIds.length)
      throw new Error('Duplicate account references');
    for (const step of packet.steps) {
      if (step.url && !origins.has(new URL(step.url).origin))
        throw new Error('Navigation outside reviewed origins');
      if (step.answer && !(step.answer in packet.answers))
        throw new Error(`Missing answer ${step.answer}`);
      if (step.accountId && !packet.accountIds.includes(step.accountId))
        throw new Error('Step account is not included in the packet');
      for (const check of step.checks) {
        if (Boolean(check.answer) === Boolean(check.document))
          throw new Error('Each form check must identify exactly one answer or document');
        if (check.answer && !(check.answer in packet.answers))
          throw new Error(`Missing checked answer ${check.answer}`);
      }
    }
    const commits = packet.steps.filter((s) => s.action === 'submit');
    if (commits.length > 1 || (commits.length === 1 && packet.steps.at(-1)?.action !== 'submit'))
      throw new Error('Application submission must be the final step and occur only once');
    for (const account of accounts)
      if (!origins.has(account.origin)) throw new Error('Account origin is not allowed');
    return accounts;
  }
  async build(applicationId: string, acceptOverflow = false) {
    const c = await this.context(applicationId);
    if (
      ['running', 'submitted', 'uncertain', 'interview', 'rejected', 'withdrawn'].includes(
        c.application.state,
      )
    )
      throw new Error(
        'This application cannot be rebuilt; prepare a new application or reconcile its outcome',
      );
    await this.validatePacket(c.packet);
    const model = documentModel(c.profile, c.draft, c.job, c.company);
    const sourceDigest = digest({
      profile: c.profile,
      draft: c.draft,
      job: c.job,
      company: c.company,
    });
    const output = await this.renderer.render(model);
    const revision = newId('build');
    const files: Record<string, string> = {};
    for (const name of requiredFiles) {
      const bytes = output.files[name];
      if (!bytes?.length) throw new Error(`Renderer did not produce ${name}`);
      files[name] = byteHash(bytes);
      await this.store.writeBytes(`artifacts/${applicationId}/${revision}/${name}`, bytes);
    }
    const build = Build.parse({
      version: 1,
      revision,
      sourceDigest,
      files,
      pages: output.pages,
      overflowAccepted: acceptOverflow,
      builtAt: now(),
      ...(output.warnings?.length ? { warnings: output.warnings } : {}),
    });
    await this.store.write(`applications/${applicationId}/build.json`, build);
    c.application.nextStep = 0;
    await this.event(
      c.application,
      'review',
      'built',
      'Documents generated; review content and layout',
    );
    return {
      build,
      directory: this.store.file(`artifacts/${applicationId}/${revision}`),
      warnings: [
        ...(output.warnings ?? []),
        ...(this.overflow(build) && !acceptOverflow
          ? [
              'Page target exceeded; shorten the draft or rebuild with --allow-overflow after reviewing it',
            ]
          : []),
      ],
    };
  }
  async updateApplication(applicationId: string, input: { draft?: unknown; packet?: unknown }) {
    const c = await this.context(applicationId);
    if (
      ['running', 'submitted', 'uncertain', 'interview', 'rejected', 'withdrawn'].includes(
        c.application.state,
      )
    )
      throw new Error('Reconcile this application or prepare a new one before changing it');
    if (input.draft === undefined && input.packet === undefined)
      throw new Error('Provide a draft or packet');
    const draft = input.draft === undefined ? c.draft : Draft.parse(input.draft);
    const packet = input.packet === undefined ? c.packet : Packet.parse(input.packet);
    if (packet.applicationId !== applicationId) throw new Error('Packet application ID mismatch');
    validateEvidence(c.profile, draft);
    await this.validatePacket(packet);
    await this.store.write(`applications/${applicationId}/draft.json`, draft);
    await this.store.write(`applications/${applicationId}/packet.json`, packet);
    c.application.nextStep = 0;
    await this.kitChanged(c.application);
    return {
      updated: applicationId,
      next: 'Rebuild documents, review the full batch, and obtain a new approval',
    };
  }
  private async kitChanged(app: Application) {
    await this.event(
      app,
      'preparing',
      'changed',
      'Draft or packet changed; previous approvals no longer apply',
    );
  }
  overflow(build: Build) {
    return build.pages.resume > 2 || build.pages.coverLetter > 1;
  }
  async fingerprint(applicationId: string) {
    const c = await this.context(applicationId);
    validateEvidence(c.profile, c.draft);
    const accounts = await this.validatePacket(c.packet);
    const build = await this.store.read(`applications/${applicationId}/build.json`, Build);
    if (
      build.sourceDigest !==
      digest({ profile: c.profile, draft: c.draft, job: c.job, company: c.company })
    )
      throw new Error(
        'Profile, job, company, or draft changed; rebuild documents and review again',
      );
    if (this.overflow(build) && !build.overflowAccepted)
      throw new Error(
        'Document page target exceeded; shorten content or explicitly accept overflow',
      );
    for (const name of requiredFiles)
      if (
        !build.files[name] ||
        byteHash(
          await this.store.readBytes(`artifacts/${applicationId}/${build.revision}/${name}`),
        ) !== build.files[name]
      )
        throw new Error(`Document changed or missing: ${name}; rebuild and review again`);
    return {
      hash: digest({
        job: c.job,
        company: c.company,
        profile: c.profile,
        draft: c.draft,
        packet: c.packet,
        build,
        accounts,
      }),
      ...c,
      build,
      accounts,
    };
  }
  async review(batchId: string, applicationIds: string[]) {
    id.parse(batchId);
    if (!applicationIds.length || new Set(applicationIds).size !== applicationIds.length)
      throw new Error('Choose one or more unique applications');
    const entries = await Promise.all(applicationIds.map((key) => this.fingerprint(key)));
    for (const e of entries)
      if (
        ['running', 'submitted', 'uncertain', 'interview', 'rejected', 'withdrawn'].includes(
          e.application.state,
        )
      )
        throw new Error(`Cannot review ${e.application.id} in state ${e.application.state}`);
    const reviewed = Object.fromEntries(entries.map((e) => [e.application.id, e.hash]));
    const batch = Batch.parse({
      version: 1,
      id: batchId,
      applicationIds,
      reviewed,
      reviewedAt: now(),
    });
    const packet = {
      version: 1,
      batch,
      applications: entries.map((e) => ({
        id: e.application.id,
        fingerprint: e.hash,
        job: e.job,
        company: e.company,
        draft: e.draft,
        packet: e.packet,
        accounts: e.accounts,
        documents: {
          directory: this.store.file(`artifacts/${e.application.id}/${e.build.revision}`),
          ...e.build,
        },
      })),
    };
    await this.store.write(`reviews/${batchId}.json`, packet);
    await this.store.put('batches', batchId, batch);
    return {
      batchId,
      reviewFile: this.store.file(`reviews/${batchId}.json`),
      reviewDigest: digest(packet),
      message: 'Read the full review packet and documents before explicitly approving this digest',
    };
  }
  async approve(batchId: string, reviewDigest: string) {
    const batch = await this.store.get('batches', batchId, Batch);
    const review = await this.store.read(`reviews/${batchId}.json`, z.unknown());
    if (digest(review) !== reviewDigest)
      throw new Error('Review digest mismatch; read the current review packet');
    for (const key of batch.applicationIds) {
      const f = await this.fingerprint(key);
      if (f.hash !== batch.reviewed[key]) throw new Error(`${key} changed since review`);
      if (!['review', 'approved'].includes(f.application.state))
        throw new Error('Application must be in review state');
    }
    batch.approved = { ...batch.reviewed };
    batch.approvedAt = now();
    await this.store.put('batches', batchId, batch);
    for (const key of batch.applicationIds)
      await this.event(
        await this.store.get('applications', key, Application),
        'approved',
        'approved',
        `Batch ${batchId} approved`,
      );
    return { approved: batch.applicationIds };
  }
  async approvedContext(applicationId: string, batchId: string) {
    const batch = await this.store.get('batches', batchId, Batch);
    const f = await this.fingerprint(applicationId);
    if (
      !batch.approvedAt ||
      !batch.applicationIds.includes(applicationId) ||
      batch.approved?.[applicationId] !== f.hash ||
      batch.reviewed[applicationId] !== f.hash
    )
      throw new Error(
        'Missing or invalidated batch approval; prepare and review the changed application',
      );
    return f;
  }
  async freezeAttempt(applicationId: string, batchId: string, step: number) {
    const context = await this.approvedContext(applicationId, batchId);
    const attemptId = newId('attempt');
    await this.store.write(`attempts/${applicationId}/${attemptId}.json`, {
      version: 1,
      id: attemptId,
      batchId,
      step,
      frozenAt: now(),
      ...context,
    });
    return attemptId;
  }
  async event(
    application: Application,
    state: Application['state'],
    type: string,
    message: string,
  ) {
    application.state = state;
    application.updatedAt = now();
    application.events.push({ at: application.updatedAt, type, message });
    await this.store.put('applications', application.id, application);
  }
  async status(applicationId?: string) {
    return applicationId
      ? this.store.get('applications', applicationId, Application)
      : this.store.list('applications', Application);
  }
  async updateStatus(
    applicationId: string,
    state: 'submitted' | 'interview' | 'rejected' | 'withdrawn',
    evidence: string,
  ) {
    const app = await this.store.get('applications', applicationId, Application);
    if (
      state === 'submitted'
        ? app.state !== 'uncertain'
        : !['submitted', 'interview'].includes(app.state)
    )
      throw new Error(
        'Invalid status transition. Only uncertain outcomes can be reconciled as submitted; other updates require a submitted application.',
      );
    if (!evidence.trim()) throw new Error('Confirmation or status evidence is required');
    await this.event(app, state, state, evidence);
    return app;
  }
}
