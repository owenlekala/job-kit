#!/usr/bin/env node
import { Command } from 'commander';
import { readFile, access, mkdtemp } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Profiles, ProfileRevision } from '../application/profiles.js';
import { migrateWorkspace } from '../application/maintenance.js';
import { editProfile } from '../adapters/profile-editor.js';
import { writeReviewPage } from '../adapters/review-page.js';
import { createBackup, restoreBackup } from '../adapters/archive.js';
import { readSecret } from '../adapters/terminal-secret.js';
import type { ImportMode } from '../domain/profile-changes.js';
import { stdin, stdout } from 'node:process';
import { chromium } from 'playwright';
import { z } from 'zod';
import { Store } from '../adapters/store.js';
import { Renderer } from '../adapters/renderer.js';
import { Bitwarden } from '../adapters/bitwarden.js';
import { bridgeCommand, serveBridge } from '../adapters/bridge.js';
import { readCompanies, readJson } from '../adapters/imports.js';
import { installSkills } from '../adapters/skills.js';
import { Kit } from '../application/kit.js';
import { ApplicationRunner } from '../application/runner.js';
import { PlaywrightBrowser } from '../adapters/browser.js';
import {
  Account,
  Batch,
  Company,
  Draft,
  Job,
  Packet,
  Profile,
  RolePreset,
} from '../domain/models.js';

const program = new Command()
  .name('applykit')
  .description('Local-first job application toolkit')
  .version('1.0.0')
  .option(
    '--workspace <directory>',
    'Private workspace (default: OS user-data directory, or APPLYKIT_HOME)',
  );
let kit: Kit;
program.hook('preAction', () => {
  kit = new Kit(new Store(program.opts().workspace), new Renderer(), new Bitwarden());
});
const output = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const execute =
  (operation: (...args: any[]) => Promise<unknown>, lock = true) =>
  async (...args: any[]) => {
    const result = lock ? await kit.store.lock(() => operation(...args)) : await operation(...args);
    if (result !== undefined) output(result);
  };
program
  .command('init')
  .description('Initialize a private workspace; optionally onboard interactively')
  .option('--allow-localhost', 'Allow HTTP localhost fixture portals')
  .option('--interactive', 'Collect identity and a first verified fact')
  .action(
    execute(async (options) => {
      const result = await kit.init(Boolean(options.allowLocalhost));
      if (options.interactive) {
        if (await new Profiles(kit.store).current())
          throw new Error('A profile already exists. Use profile edit to update it safely.');
        if (!stdin.isTTY) throw new Error('--interactive requires a terminal');
        const prompt = createInterface({ input: stdin, output: stdout });
        try {
          const name = await prompt.question('Full name: '),
            headline = await prompt.question('Professional headline: '),
            email = await prompt.question('Contact email: '),
            applicationEmail = await prompt.question('Application email (blank = contact email): '),
            location = await prompt.question('Location: '),
            phone = await prompt.question('Phone (optional): '),
            roles = await prompt.question('Target roles (comma separated): '),
            locations = await prompt.question('Target locations (comma separated): '),
            arrangements = await prompt.question(
              'Work arrangements (remote, hybrid, onsite; comma separated): ',
            ),
            fact = await prompt.question('One factual experience or achievement: '),
            confirmed = await prompt.question('Have you verified this fact? Type yes: ');
          const profile = Profile.parse({
            version: 1,
            name,
            headline,
            contact: {
              email,
              ...(applicationEmail ? { applicationEmail } : {}),
              ...(phone ? { phone } : {}),
              location,
              links: [],
            },
            preferences: {
              roles: roles
                .split(',')
                .map((v: string) => v.trim())
                .filter(Boolean),
              locations: locations
                .split(',')
                .map((v: string) => v.trim())
                .filter(Boolean),
              arrangements: arrangements
                .split(',')
                .map((v: string) => v.trim())
                .filter(Boolean),
            },
            facts: [
              {
                id: 'first-experience',
                kind: 'experience',
                text: fact,
                verified: confirmed.trim().toLowerCase() === 'yes',
              },
            ],
          });
          await kit.store.lock(() => kit.importProfile(profile, true));
        } finally {
          prompt.close();
        }
      }
      return {
        ...result,
        next: 'Import a profile JSON or use init --interactive; see examples/profile.json',
      };
    }, false),
  );
program
  .command('doctor')
  .description('Check runtime, workspace, browser and vault readiness')
  .action(
    execute(async () => {
      const problems: string[] = [];
      try {
        await kit.config();
      } catch {
        problems.push('Initialize the workspace: applykit init');
      }
      try {
        await access(chromium.executablePath());
      } catch {
        problems.push('Install Chromium: npx playwright install chromium');
      }
      let vault = 'unavailable';
      try {
        vault = await (kit.vault as Bitwarden).status();
      } catch {
        problems.push('Install Bitwarden CLI (bw), log in, and unlock it for portal workflows');
      }
      return {
        node: process.version,
        platform: process.platform,
        workspace: kit.store.root,
        browser: chromium.executablePath(),
        vault,
        problems,
      };
    }, false),
  );
program
  .command('schema <record>')
  .description('Print JSON Schema for profile, company, job, draft, or packet')
  .action(
    execute(async (name) => {
      const schemas: Record<string, z.ZodType> = {
        profile: Profile,
        company: Company,
        job: Job,
        draft: Draft,
        packet: Packet,
      };
      if (!schemas[name])
        throw new Error('Unknown schema: choose profile, company, job, draft, or packet');
      return z.toJSONSchema(schemas[name]);
    }, false),
  );
const skills = program.command('skills').description('Install reusable agent workflows');
skills
  .command('install')
  .requiredOption('--agent <agent>', 'codex, claude, cursor, or all')
  .option('--target <directory>', 'Project receiving the skills', process.cwd())
  .option('--overwrite', 'Replace conflicting installed copies')
  .action(
    execute(
      async (options) => installSkills(options.agent, options.target, options.overwrite),
      false,
    ),
  );
const profile = program.command('profile');
profile
  .command('import <file>')
  .description(
    'Import profile JSON; other files are saved as unverified source notes without execution',
  )
  .option('--confirm', 'Explicitly preserve reviewed verified flags from JSON')
  .option('--mode <mode>', 'create, merge, or replace', 'create')
  .option('--preview', 'Show changes and the digest required to save an existing profile')
  .option('--review-digest <digest>', 'Digest of the profile change preview')
  .action(
    execute(async (file, options) => {
      if (!['create', 'merge', 'replace'].includes(options.mode))
        throw new Error('Profile mode must be create, merge, or replace');
      if (!file.toLowerCase().endsWith('.json'))
        return kit.importSource(file, await readFile(file, 'utf8'));
      const value = await readJson(file);
      return options.preview
        ? kit.previewProfile(value, options.mode as ImportMode, Boolean(options.confirm))
        : kit.importProfile(value, Boolean(options.confirm), {
            mode: options.mode as ImportMode,
            reviewDigest: options.reviewDigest,
          });
    }),
  );
profile.command('validate').action(execute(() => kit.validateProfile(), false));
profile
  .command('verify <facts...>')
  .description('Explicitly attest that the selected fact IDs are accurate')
  .requiredOption('--confirm', 'Confirm you reviewed the facts')
  .option('--note <text>', 'How the facts were verified')
  .action(execute((facts, options) => kit.verifyFacts(facts, options.note)));
profile
  .command('history')
  .action(execute(() => kit.store.list('profile-history', ProfileRevision), false));
profile
  .command('restore <revision>')
  .option('--preview')
  .option('--review-digest <digest>')
  .action(
    execute(async (revision, options) => {
      const record = await kit.store.get('profile-history', revision, ProfileRevision);
      return options.preview
        ? kit.previewProfile(record.profile, 'replace', true)
        : kit.importProfile(record.profile, true, {
            mode: 'replace',
            reviewDigest: options.reviewDigest,
          });
    }),
  );
profile
  .command('edit')
  .description('Guided editor with a change preview; changed facts become unverified')
  .action(
    execute(async () => {
      const profiles = new Profiles(kit.store);
      const current = await profiles.current();
      const value = await editProfile(current);
      const mode = current ? 'replace' : 'create';
      const preview = await kit.previewProfile(value, mode, true);
      output(preview);
      const prompt = createInterface({ input: stdin, output: stdout });
      try {
        if ((await prompt.question('Save these changes? Type save: ')).trim() !== 'save')
          return { saved: false };
      } finally {
        prompt.close();
      }
      return kit.store.lock(() =>
        kit.importProfile(value, true, { mode, reviewDigest: preview.digest }),
      );
    }, false),
  );
const workspace = program.command('workspace');
workspace.command('recover').action(execute(async () => ({ recovered: true })));
workspace.command('migrate').action(execute(() => migrateWorkspace(kit.store)));
workspace.command('backup <file>').action(
  execute(async (file) => {
    const passphrase = await readSecret('Backup passphrase: ');
    if (passphrase !== (await readSecret('Repeat passphrase: ')))
      throw new Error('Passphrases do not match');
    return kit.store.lock(() => createBackup(kit.store, file, passphrase));
  }, false),
);
workspace
  .command('restore <file>')
  .requiredOption('--confirm', 'Restore into this new workspace and revoke saved approvals')
  .action(
    execute(async (file) => {
      const passphrase = await readSecret('Backup passphrase: ');
      return kit.store.lock(() => restoreBackup(kit.store, file, passphrase));
    }, false),
  );
program
  .command('demo')
  .description('Build fictional sample documents in a separate temporary workspace')
  .action(
    execute(async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'applykit-demo-'));
      const demo = new Kit(new Store(directory), new Renderer(), new Bitwarden());
      await demo.init();
      return demo.store.lock(async () => {
        await demo.importProfile(
          await readJson(fileURLToPath(new URL('../../examples/profile.json', import.meta.url))),
          true,
        );
        await demo.importCompanies([{ version: 1, id: 'example', name: 'Example Company' }]);
        await demo.addJob({
          version: 1,
          id: 'example-job',
          companyId: 'example',
          title: 'Software Engineer',
          url: 'https://example.org/careers/software-engineer',
          sourceUrl: 'https://example.org/careers/software-engineer',
          description: 'Build TypeScript services and practical internal tools.',
          verifiedAt: new Date().toISOString(),
        });
        await demo.prepare('example-job', 'example-application');
        return { workspace: directory, ...(await demo.build('example-application')) };
      });
    }, false),
  );
const companies = program.command('companies');
companies
  .command('import [file]')
  .option('--id <id>')
  .option('--name <name>')
  .option('--careers-url <url>')
  .description('Import JSON/CSV, or add a company name and optional careers URL')
  .action(
    execute(async (file, options) => {
      if (file) return kit.importCompanies(await readCompanies(file));
      if (!options.id || !options.name) throw new Error('Provide a file, or --id and --name');
      return kit.importCompanies([
        {
          version: 1,
          id: options.id,
          name: options.name,
          ...(options.careersUrl ? { careersUrl: options.careersUrl } : {}),
        },
      ]);
    }),
  );
companies.command('list').action(execute(() => kit.store.list('companies', Company), false));
const jobs = program.command('jobs');
jobs
  .command('add [file]')
  .option('--id <id>')
  .option('--company <id>')
  .option('--title <title>')
  .option('--url <url>')
  .option('--description <file>', 'File containing the job description')
  .description('Add a verified job JSON record, or construct one from flags')
  .action(
    execute(async (file, options) => {
      if (file) return kit.addJob(await readJson(file));
      if (!options.id || !options.company || !options.title || !options.url || !options.description)
        throw new Error('Provide a job JSON file or all job flags, including --description');
      return kit.addJob({
        version: 1,
        id: options.id,
        companyId: options.company,
        title: options.title,
        url: options.url,
        sourceUrl: options.url,
        description: await readFile(options.description, 'utf8'),
        verifiedAt: new Date().toISOString(),
      });
    }),
  );
jobs
  .command('list')
  .option('--status <status>', 'open or closed')
  .option('--company <id>')
  .option('--query <text>')
  .option('--due-before <date>')
  .action(
    execute(async (options) => {
      if (options.status && !['open', 'closed'].includes(options.status))
        throw new Error('Job status must be open or closed');
      if (options.dueBefore) z.iso.date().parse(options.dueBefore);
      return (await kit.store.list('jobs', Job)).filter(
        (job) =>
          (!options.status || (job.status ?? 'open') === options.status) &&
          (!options.company || job.companyId === options.company) &&
          (!options.query ||
            (job.title + ' ' + job.description)
              .toLowerCase()
              .includes(options.query.toLowerCase())) &&
          (!options.dueBefore || Boolean(job.deadline && job.deadline <= options.dueBefore)),
      );
    }, false),
  );
jobs
  .command('update <id>')
  .option('--status <status>', 'open or closed')
  .option('--deadline <date>')
  .action(
    execute(async (id, options) => {
      if (!options.status && !options.deadline) throw new Error('Provide --status or --deadline');
      const current = await kit.store.get('jobs', id, Job);
      return kit.addJob({
        ...current,
        ...(options.status
          ? {
              status: options.status,
              closedAt: options.status === 'closed' ? new Date().toISOString() : undefined,
            }
          : {}),
        ...(options.deadline ? { deadline: options.deadline } : {}),
        verifiedAt: new Date().toISOString(),
      });
    }),
  );
const application = program.command('application');
const presets = program.command('presets');
presets
  .command('save <id>')
  .requiredOption('--name <name>')
  .requiredOption('--facts <ids>', 'Comma-separated verified fact IDs')
  .action(
    execute((id, options) =>
      kit.savePreset({ version: 1, id, name: options.name, factIds: options.facts.split(',') }),
    ),
  );
presets.command('list').action(execute(() => kit.store.list('presets', RolePreset), false));
application
  .command('prepare <job>')
  .option('--id <id>')
  .option('--facts <ids>', 'Comma-separated verified fact IDs')
  .option('--preset <id>', 'Saved role-specific fact selection')
  .action(
    execute(async (job, options) => {
      if (options.facts && options.preset) throw new Error('Choose --facts or --preset');
      const selected = options.preset
        ? (await kit.store.get('presets', options.preset, RolePreset)).factIds
        : options.facts?.split(',');
      return kit.prepare(job, options.id, selected);
    }),
  );
application
  .command('build <id>')
  .option('--check-word', 'Measure DOCX pagination using a local LibreOffice installation')
  .option('--allow-overflow', 'Accept document page-target overflow after reviewing it')
  .action(
    execute((id, options) =>
      kit.build(id, Boolean(options.allowOverflow), Boolean(options.checkWord)),
    ),
  );
application
  .command('update <id>')
  .option('--draft <file>')
  .option('--packet <file>')
  .description('Validate and import tailored content or a portal plan; invalidates prior approvals')
  .action(
    execute(async (id, options) =>
      kit.updateApplication(id, {
        ...(options.draft ? { draft: await readJson(options.draft) } : {}),
        ...(options.packet ? { packet: await readJson(options.packet) } : {}),
      }),
    ),
  );
application
  .command('status [id]')
  .option('--state <state>', 'Filter by current application state')
  .option('--follow-up-before <date>', 'Filter applications with a follow-up due by this date')
  .option('--set <state>', 'interview, rejected, or withdrawn')
  .option('--evidence <text>')
  .action(
    execute(async (id, options) => {
      if (options.followUpBefore) z.iso.date().parse(options.followUpBefore);
      if (!options.set) {
        const result = await kit.status(id);
        return Array.isArray(result)
          ? result.filter(
              (app) =>
                (!options.state || app.state === options.state) &&
                (!options.followUpBefore ||
                  Boolean(app.followUpAt && app.followUpAt <= options.followUpBefore)),
            )
          : result;
      }
      if (!id || !['interview', 'rejected', 'withdrawn'].includes(options.set) || !options.evidence)
        throw new Error('Provide an application ID, supported status, and --evidence');
      return kit.updateStatus(id, options.set, options.evidence);
    }),
  );
application
  .command('claims <id>')
  .option('--confirm', 'Attest that every flagged claim is supported')
  .option('--digest <digest>')
  .option('--note <text>', 'Explanation of the evidence reviewed')
  .action(
    execute((id, options) => {
      if (options.confirm && (!options.digest || !options.note))
        throw new Error('Claim confirmation requires --digest and --note');
      return kit.claims(
        id,
        options.confirm ? { digest: options.digest, note: options.note } : undefined,
      );
    }),
  );
application
  .command('track <id>')
  .option('--follow-up <date>')
  .option('--note <text>')
  .action(
    execute((id, options) => {
      if (!options.followUp && options.note === undefined)
        throw new Error('Provide --follow-up or --note');
      return kit.track(id, options.followUp, options.note);
    }),
  );
application
  .command('inspect <id>')
  .description(
    'Open the local portal browser and inspect its untrusted content without input values',
  )
  .option('--headless')
  .action(
    execute(
      (id, options) =>
        bridgeCommand(kit, { action: 'inspect', applicationId: id }, !options.headless),
      false,
    ),
  );
application
  .command('resume <id>')
  .requiredOption('--batch <id>')
  .option('--restart', 'Explicitly replay reversible preparation after session expiry')
  .option('--headless')
  .action(
    execute(
      (id, options) =>
        bridgeCommand(
          kit,
          {
            action: 'run',
            applicationId: id,
            batchId: options.batch,
            resume: true,
            restart: Boolean(options.restart),
          },
          !options.headless,
        ),
      false,
    ),
  );
application
  .command('reconcile <id>')
  .requiredOption('--outcome <outcome>', 'submitted, registered, or not-submitted')
  .requiredOption('--evidence <text>', 'What you verified in the portal')
  .action(
    execute(async (id, options) => {
      if (!['submitted', 'registered', 'not-submitted'].includes(options.outcome))
        throw new Error('Unsupported reconciliation outcome');
      const browser = new PlaywrightBrowser([], false);
      return new ApplicationRunner(kit, browser).reconcile(id, options.outcome, options.evidence);
    }),
  );
const batch = program.command('batch');
batch.command('review <id> <applications...>').action(
  execute(async (id, apps) => ({
    ...(await kit.review(id, apps)),
    ...(await writeReviewPage(kit.store, id)),
  })),
);
batch
  .command('approve <id>')
  .requiredOption(
    '--digest <sha256>',
    'Digest of the review packet explicitly approved by the user',
  )
  .requiredOption(
    '--confirm',
    'Attest the user approved these exact applications, answers, and documents',
  )
  .action(execute((id, options) => kit.approve(id, options.digest)));
batch
  .command('run <id>')
  .option('--headless')
  .action(
    execute(async (id, options) => {
      const value = await kit.store.get('batches', id, Batch);
      if (!value.approvedAt) throw new Error('Review and approve this batch first');
      const results: unknown[] = [];
      for (const applicationId of value.applicationIds) {
        const app = await kit.status(applicationId);
        if (
          !Array.isArray(app) &&
          ['submitted', 'interview', 'rejected', 'withdrawn'].includes(app.state)
        ) {
          results.push({ id: applicationId, skipped: app.state });
          continue;
        }
        results.push(
          await bridgeCommand(
            kit,
            { action: 'run', applicationId, batchId: id, resume: false, restart: false },
            !options.headless,
          ),
        );
      }
      return results;
    }, false),
  );
const accounts = program.command('accounts');
accounts
  .command('list')
  .description('List vault references, never passwords')
  .action(execute(() => kit.store.list('accounts', Account), false));
accounts
  .command('connect <id>')
  .requiredOption('--origin <url>')
  .requiredOption('--tenant <name>')
  .option('--path-prefix <path>', 'Restrict credential injection to a tenant URL path')
  .option('--email <email>')
  .option('--item <id>', 'Existing Bitwarden login item ID')
  .option(
    '--create',
    'Generate and save a unique password in Bitwarden; portal signup is a separately reviewed browser step',
  )
  .action(
    execute((id, options) =>
      kit.connectAccount({
        id,
        origin: options.origin,
        tenant: options.tenant,
        pathPrefix: options.pathPrefix,
        email: options.email,
        itemId: options.item,
        create: Boolean(options.create),
      }),
    ),
  );
const browser = program.command('browser');
browser
  .command('serve')
  .option('--headless')
  .description('Run the authenticated local browser bridge in the foreground')
  .action(async (options) => {
    await serveBridge(kit, !options.headless);
    console.log('Browser bridge ready on localhost. No session data will be persisted.');
  });
browser.command('close').action(execute(() => bridgeCommand(kit, { action: 'close' }), false));

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof z.ZodError)
    console.error(
      'Validation failed:\n' +
        error.issues
          .map((issue) => `- ${issue.path.join('.') || 'record'}: ${issue.message}`)
          .join('\n'),
    );
  else if (error instanceof Error) console.error(error.message);
  else console.error('Operation failed');
  process.exitCode = 1;
}
