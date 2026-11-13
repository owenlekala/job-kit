#!/usr/bin/env node
import { Command } from 'commander';
import { readFile, access } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
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
          await kit.importProfile(profile, true);
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
  .action(
    execute(async (file, options) =>
      file.toLowerCase().endsWith('.json')
        ? kit.importProfile(await readJson(file), Boolean(options.confirm))
        : kit.importSource(file, await readFile(file, 'utf8')),
    ),
  );
profile.command('validate').action(execute(() => kit.validateProfile(), false));
profile
  .command('verify <facts...>')
  .description('Explicitly attest that the selected fact IDs are accurate')
  .requiredOption('--confirm', 'Confirm you reviewed the facts')
  .action(execute((facts) => kit.verifyFacts(facts)));
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
jobs.command('list').action(execute(() => kit.store.list('jobs', Job), false));
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
  .option('--allow-overflow', 'Accept document page-target overflow after reviewing it')
  .action(execute((id, options) => kit.build(id, Boolean(options.allowOverflow))));
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
  .option('--set <state>', 'interview, rejected, or withdrawn')
  .option('--evidence <text>')
  .action(
    execute(async (id, options) => {
      if (!options.set) return kit.status(id);
      if (!id || !['interview', 'rejected', 'withdrawn'].includes(options.set) || !options.evidence)
        throw new Error('Provide an application ID, supported status, and --evidence');
      return kit.updateStatus(id, options.set, options.evidence);
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
batch.command('review <id> <applications...>').action(execute((id, apps) => kit.review(id, apps)));
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
