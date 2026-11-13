import { Account, Application, type Step } from '../domain/models.js';
import type { BrowserDriver } from './ports.js';
import { Kit } from './kit.js';

/** Approval and progress live here; the browser adapter only performs UI primitives. */
export class ApplicationRunner {
  constructor(
    private readonly kit: Kit,
    private readonly browser: BrowserDriver,
  ) {}
  async run(applicationId: string, batchId: string, resume = false) {
    return this.kit.store.lock(async () => {
      const c = await this.kit.approvedContext(applicationId, batchId);
      const app = c.application;
      if (['submitted', 'interview', 'rejected', 'withdrawn', 'uncertain'].includes(app.state))
        throw new Error(`Application is ${app.state}; submission will not be retried`);
      if (!c.packet.steps.length || !['submit', 'handoff'].includes(c.packet.steps.at(-1)!.action))
        throw new Error('A reviewed plan must end with submit or an explicit exploration handoff');
      if (app.state === 'running' && app.events.at(-1)?.type === 'commit-started') {
        await this.kit.event(
          app,
          'uncertain',
          'interrupted',
          'A commit was interrupted; reconcile its outcome before doing anything else',
        );
        return app;
      }
      if (['handoff', 'running'].includes(app.state) && !resume)
        throw new Error('Use application resume after completing the handoff');
      if (!['approved', 'handoff', 'running'].includes(app.state))
        throw new Error('Application is not ready to run');
      for (let index = app.nextStep; index < c.packet.steps.length; index++) {
        // Re-read file hashes and approval before every action, including the final commit.
        await this.kit.approvedContext(applicationId, batchId);
        const step = c.packet.steps[index]!;
        if (step.action === 'handoff') {
          app.nextStep = index + 1;
          await this.kit.event(app, 'handoff', 'handoff', step.message!);
          return app;
        }
        const commit = ['submit', 'register'].includes(step.action);
        try {
          if (commit) {
            await this.checkForm(
              step,
              c.packet.answers,
              c.packet.steps.slice(0, index),
              c.build.files,
            );
            const attemptId = await this.kit.freezeAttempt(applicationId, batchId, index);
            await this.kit.event(app, 'running', 'attempt-snapshot', attemptId);
            // Persist uncertainty BEFORE making an irreversible network action.
            await this.kit.event(app, 'running', 'commit-started', `Step ${index}: ${step.action}`);
          }
          await this.execute(step, c.packet.answers, applicationId, c.build.revision);
          app.nextStep = index + 1;
          await this.kit.event(
            app,
            step.action === 'submit' ? 'submitted' : 'running',
            step.action === 'submit' ? 'submitted' : 'step-complete',
            `Step ${index}: ${step.action}${commit ? ' — confirmation matched' : ''}`,
          );
        } catch {
          const attempted = commit && app.events.at(-1)?.type === 'commit-started';
          await this.kit.event(
            app,
            attempted ? 'uncertain' : 'handoff',
            attempted ? 'uncertain' : 'handoff',
            attempted
              ? `Step ${index}: ${step.action} outcome uncertain; inspect the portal and reconcile before retrying`
              : `Step ${index}: ${step.action} could not be verified. Inspect the browser, handle verification or unsupported fields, then resume. Changes to the plan require a new review.`,
          );
          return app;
        }
      }
      return app;
    });
  }
  private async checkForm(
    step: Step,
    answers: Record<string, string | boolean>,
    steps: Step[],
    files: Record<string, string>,
  ) {
    for (const check of step.checks) {
      if (check.answer && (await this.browser.read(check.selector)) !== answers[check.answer])
        throw new Error('Completed form differs from approved answers');
      if (
        check.document &&
        (await this.browser.fileHashes(check.selector))[check.document] !== files[check.document]
      )
        throw new Error('Expected attachment is missing or changed');
    }
    const formStart = steps.findLastIndex((step) =>
      ['navigate', 'click', 'login', 'register'].includes(step.action),
    );
    await this.browser.verifyForm(
      step.selector!,
      step.checks.map((c) => c.selector),
      steps
        .slice(formStart + 1)
        .filter((s) => s.action === 'credential')
        .map((s) => s.selector!),
    );
  }
  private async execute(
    step: Step,
    answers: Record<string, string | boolean>,
    applicationId: string,
    revision: string,
  ) {
    switch (step.action) {
      case 'navigate':
        await this.browser.navigate(step.url!);
        break;
      case 'fill': {
        const value = answers[step.answer!];
        if (typeof value !== 'string') throw new Error('Text input requires a string answer');
        await this.browser.fill(step.selector!, value);
        if ((await this.browser.read(step.selector!)) !== value)
          throw new Error('Filled answer mismatch');
        break;
      }
      case 'check': {
        const value = answers[step.answer!];
        if (typeof value !== 'boolean') throw new Error('Checkbox requires a boolean answer');
        await this.browser.check(step.selector!, value);
        if ((await this.browser.read(step.selector!)) !== value)
          throw new Error('Checkbox mismatch');
        break;
      }
      case 'select': {
        const value = answers[step.answer!];
        if (typeof value !== 'string') throw new Error('Selection requires a string answer');
        await this.browser.select(step.selector!, value);
        if ((await this.browser.read(step.selector!)) !== value)
          throw new Error('Selection mismatch');
        break;
      }
      case 'upload':
        await this.browser.upload(
          step.selector!,
          await this.kit.store.readBytes(`artifacts/${applicationId}/${revision}/${step.document}`),
          step.document!,
        );
        break;
      case 'credential': {
        const account = await this.kit.store.get('accounts', step.accountId!, Account);
        const snapshot = await this.browser.snapshot();
        const current = new URL(snapshot.url);
        if (
          current.origin !== account.origin ||
          !(
            current.pathname === account.pathPrefix ||
            current.pathname.startsWith(
              account.pathPrefix.endsWith('/') ? account.pathPrefix : account.pathPrefix + '/',
            )
          )
        )
          throw new Error('Credential portal or tenant path mismatch');
        const credential = await this.kit.vault.lookup(account.itemId);
        if (
          credential.email !== account.email ||
          !credential.uris.some((u) => {
            try {
              return new URL(u).origin === account.origin;
            } catch {
              return false;
            }
          })
        )
          throw new Error('Vault account scope changed');
        await this.browser.fill(
          step.selector!,
          step.credential === 'email' ? credential.email : credential.password,
          true,
        );
        break;
      }
      case 'click':
      case 'login':
        await this.browser.click(step.selector!, step.action);
        break;
      case 'wait':
        await this.browser.wait(step.selector!, step.confirmationText);
        break;
      case 'submit':
      case 'register':
        await this.browser.click(step.selector!, step.action);
        await this.browser.wait(step.confirmationSelector!, step.confirmationText);
        break;
      case 'handoff':
        break;
    }
  }
  async reconcile(
    applicationId: string,
    outcome: 'submitted' | 'not-submitted' | 'registered',
    evidence: string,
  ) {
    const app = await this.kit.store.get('applications', applicationId, Application);
    if (!evidence.trim() || app.state !== 'uncertain')
      throw new Error('Reconciliation requires an uncertain application and explicit evidence');
    const lastCommit = [...app.events].reverse().find((e) => e.type === 'commit-started');
    if (!lastCommit) throw new Error('No uncertain commit was recorded');
    const registration = lastCommit.message.endsWith('register');
    if ((outcome === 'submitted' && registration) || (outcome === 'registered' && !registration))
      throw new Error('Outcome does not match the uncertain action');
    if (outcome !== 'not-submitted') app.nextStep++;
    await this.kit.event(
      app,
      outcome === 'submitted' ? 'submitted' : 'handoff',
      'reconciled',
      `${outcome}: ${evidence}`,
    );
    return app;
  }
}
