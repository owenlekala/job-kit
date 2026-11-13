import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { checkWebUrl } from '../domain/models.js';
import type { BrowserDriver, PageSnapshot } from '../application/ports.js';

/** One ephemeral browser context per application. No traces, profile, or cookies on disk. */
export class PlaywrightBrowser implements BrowserDriver {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private secrets = new Set<string>();
  private injected = new Map<string, string>();
  private intent = 'inspect';
  readonly allowedOrigins: Set<string>;
  constructor(
    origins: string[],
    private readonly headed = true,
    private readonly allowLocalhost = false,
  ) {
    origins.forEach((o) => checkWebUrl(o, allowLocalhost));
    this.allowedOrigins = new Set(origins);
  }
  private async active() {
    if (!this.page) {
      this.browser = await chromium.launch({ headless: !this.headed });
      this.context = await this.browser.newContext({
        acceptDownloads: false,
        serviceWorkers: 'block',
      });
      await this.context.route('**/*', async (route) => {
        const request = route.request();
        let origin: string;
        try {
          origin = new URL(request.url()).origin;
        } catch {
          return route.abort();
        }
        if (!this.allowedOrigins.has(origin)) return route.abort();
        // A normal navigation click must not silently POST an application.
        if (
          !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
          !['login', 'register', 'submit', 'upload'].includes(this.intent)
        )
          return route.abort();
        return route.continue();
      });
      this.page = await this.context.newPage();
      this.page.setDefaultTimeout(12000);
      await this.page.addInitScript(() => {
        (window as unknown as Record<string, unknown>).__applykitCommit = false;
        document.addEventListener(
          'submit',
          (event) => {
            if (!(window as unknown as Record<string, unknown>).__applykitCommit)
              event.preventDefault();
          },
          true,
        );
      });
      this.page.on('dialog', (d) => {
        void d.dismiss();
      });
      this.context.on('page', (popup) => {
        if (popup !== this.page) void popup.close();
      });
    }
    return this.page;
  }
  private guard(page: Page) {
    if (!this.allowedOrigins.has(new URL(page.url()).origin))
      throw new Error('Browser left the reviewed portal origins');
  }
  async navigate(url: string) {
    checkWebUrl(url, this.allowLocalhost);
    if (!this.allowedOrigins.has(new URL(url).origin))
      throw new Error('Navigation origin has not been reviewed');
    const page = await this.active();
    this.intent = 'navigate';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    this.guard(page);
  }
  async snapshot(): Promise<PageSnapshot> {
    const page = await this.active();
    this.guard(page);
    const result = await page.evaluate(() => {
      // Keep this closure self-contained: TS dev loaders can introduce helpers for
      // named nested functions which do not exist in the page's JavaScript realm.
      const nodes = Array.from(document.querySelectorAll('input,textarea,select,button,a'))
        .filter((e) => e.getClientRects().length > 0)
        .map((e) => {
          let selector = '';
          const name = e.getAttribute('name');
          if (e.id) selector = '#' + CSS.escape(e.id);
          else if (
            name &&
            document.querySelectorAll(`${e.tagName.toLowerCase()}[name=${CSS.escape(name)}]`)
              .length === 1
          )
            selector = `${e.tagName.toLowerCase()}[name=${CSS.escape(name)}]`;
          else {
            const parts: string[] = [];
            for (
              let node: Element | null = e;
              node && node !== document.documentElement;
              node = node.parentElement
            )
              parts.unshift(
                `${node.tagName.toLowerCase()}:nth-of-type(${
                  Array.from(node.parentElement!.children)
                    .filter((n) => n.tagName === node!.tagName)
                    .indexOf(node) + 1
                })`,
              );
            selector = parts.join(' > ');
          }
          return {
            selector,
            tag: e.tagName.toLowerCase(),
            type: e.getAttribute('type') ?? e.tagName.toLowerCase(),
            label:
              e.getAttribute('aria-label') ??
              ('labels' in e
                ? Array.from((e as HTMLInputElement).labels ?? [])
                    .map((l) => l.textContent)
                    .join(' ')
                : ''),
            text:
              e.textContent?.trim() ||
              (e.getAttribute('type') === 'submit' ? e.getAttribute('value') : '') ||
              e.getAttribute('aria-label') ||
              '',
          };
        });
      return {
        url: location.href,
        title: document.title,
        text: document.body.innerText.slice(0, 14000),
        fields: nodes
          .filter((e) => ['input', 'textarea', 'select'].includes(e.tag))
          .map((e) => ({ selector: e.selector, type: e.type, label: e.label })),
        buttons: nodes
          .filter((e) => ['button', 'a'].includes(e.tag) || e.type === 'submit')
          .slice(0, 100)
          .map((e) => ({ selector: e.selector, text: e.text })),
      };
    });
    // Do not return input values or query strings. Redact values injected from the vault.
    result.url = new URL(result.url).origin + new URL(result.url).pathname;
    let safe = JSON.stringify(result);
    for (const secret of this.secrets) if (secret) safe = safe.split(secret).join('[redacted]');
    return JSON.parse(safe);
  }
  async fill(selector: string, value: string, sensitive = false) {
    const page = await this.active();
    this.guard(page);
    const field = page.locator(selector);
    if (!sensitive && (await field.getAttribute('type')) === 'password')
      throw new Error('Password fields require a vault credential step');
    if (sensitive) this.secrets.add(value);
    await field.fill(value);
    if (sensitive && (await field.inputValue()) !== value)
      throw new Error(
        'Portal truncated or changed a credential; update its vault entry before continuing',
      );
    if (sensitive) this.injected.set(selector, value);
  }
  async check(selector: string, value: boolean) {
    const page = await this.active();
    this.guard(page);
    await page.locator(selector).setChecked(value);
  }
  async select(selector: string, value: string) {
    const page = await this.active();
    this.guard(page);
    await page.locator(selector).selectOption(value);
  }
  async upload(selector: string, bytes: Uint8Array, name: string) {
    const page = await this.active();
    this.guard(page);
    this.intent = 'upload';
    try {
      await page.locator(selector).setInputFiles({
        name,
        mimeType: name.endsWith('.pdf')
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from(bytes),
      });
    } finally {
      this.intent = 'inspect';
    }
  }
  async click(selector: string, intent: 'click' | 'login' | 'register' | 'submit' = 'click') {
    const page = await this.active();
    this.guard(page);
    const element = page.locator(selector);
    if (intent === 'click') {
      const submits = await element.evaluate(
        (e) =>
          (e instanceof HTMLButtonElement && e.type === 'submit') ||
          (e instanceof HTMLInputElement && ['submit', 'image'].includes(e.type)),
      );
      if (submits)
        throw new Error(
          'Submit buttons require an explicit reviewed login, register, or submit action',
        );
    }
    this.intent = intent;
    await page.evaluate((allow) => {
      (window as unknown as Record<string, unknown>).__applykitCommit = allow;
    }, intent !== 'click');
    try {
      await element.click();
      await page.waitForLoadState('domcontentloaded');
      this.guard(page);
    } finally {
      this.intent = 'inspect';
      await page
        .evaluate(() => {
          (window as unknown as Record<string, unknown>).__applykitCommit = false;
        })
        .catch(() => {});
    }
  }
  async wait(selector: string, expectedText?: string) {
    const page = await this.active();
    this.guard(page);
    await page.locator(selector).waitFor({ state: 'visible' });
    if (expectedText && !(await page.locator(selector).innerText()).includes(expectedText))
      throw new Error('Confirmation text does not match the reviewed expectation');
  }
  async read(selector: string) {
    const page = await this.active();
    this.guard(page);
    const field = page.locator(selector);
    if ((await field.getAttribute('type')) === 'password')
      throw new Error('Password values cannot be inspected');
    return ['checkbox', 'radio'].includes((await field.getAttribute('type')) ?? '')
      ? field.isChecked()
      : field.inputValue();
  }
  async fileNames(selector: string) {
    const page = await this.active();
    this.guard(page);
    return page
      .locator(selector)
      .evaluate((e) => Array.from((e as HTMLInputElement).files ?? []).map((f) => f.name));
  }
  async fileHashes(selector: string): Promise<Record<string, string>> {
    const page = await this.active();
    this.guard(page);
    return page.locator(selector).evaluate(async (e) =>
      Object.fromEntries(
        await Promise.all(
          Array.from((e as HTMLInputElement).files ?? []).map(async (file) => [
            file.name,
            Array.from(
              new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
            )
              .map((n) => n.toString(16).padStart(2, '0'))
              .join(''),
          ]),
        ),
      ),
    );
  }
  async verifyForm(submitSelector: string, checked: string[], credentialSelectors: string[]) {
    const page = await this.active();
    this.guard(page);
    const valid = await page.locator(submitSelector).evaluate(
      (button, { checked, credentialSelectors }) => {
        const root = button.closest('form') ?? document;
        return Array.from(root.querySelectorAll('input,select,textarea')).every((element) => {
          const field = element as HTMLInputElement;
          if (
            !field.getClientRects().length ||
            field.disabled ||
            ['hidden', 'submit', 'button', 'reset', 'image'].includes(field.type)
          )
            return true;
          if (!field.checkValidity()) return false;
          const populated =
            field.type === 'file'
              ? Boolean(field.files?.length)
              : ['checkbox', 'radio'].includes(field.type)
                ? field.checked
                : Boolean(field.value);
          if (!populated && !field.required) return true;
          const selectors =
            field.type === 'password' ? credentialSelectors : [...checked, ...credentialSelectors];
          return selectors.some((s) => field.matches(s));
        });
      },
      { checked, credentialSelectors },
    );
    if (!valid) throw new Error('The form has unreviewed, invalid, or missing required fields');
    for (const selector of credentialSelectors) {
      const expected = this.injected.get(selector);
      if (expected === undefined || (await page.locator(selector).inputValue()) !== expected)
        throw new Error('A credential changed after vault injection');
    }
  }
  async close() {
    await this.browser?.close();
    this.page = undefined;
    this.browser = undefined;
    this.context = undefined;
    this.secrets.clear();
    this.injected.clear();
  }
}
