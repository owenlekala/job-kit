import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

export interface BrowserSelection {
  name: string;
  executablePath: string;
  source: 'system' | 'override' | 'playwright';
}

/** OS discovery is injectable so every platform can be checked without installed browsers. */
export interface BrowserEnvironment {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  bundledPath: string;
  isExecutable: (file: string) => Promise<boolean>;
  command: (file: string, args: string[]) => Promise<string>;
}

const exec = promisify(execFile);
const system: BrowserEnvironment = {
  platform: process.platform,
  env: process.env,
  home: os.homedir(),
  bundledPath: chromium.executablePath(),
  async isExecutable(file) {
    try {
      await access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return (await stat(file)).isFile();
    } catch {
      return false;
    }
  },
  async command(file, args) {
    const { stdout } = await exec(file, args, { timeout: 3000, maxBuffer: 1024 * 1024 });
    return stdout;
  },
};

const browsers = [
  {
    name: 'Google Chrome',
    bundle: 'com.google.chrome',
    mac: 'Google Chrome.app/Contents/MacOS/Google Chrome',
    windows: 'Google/Chrome/Application/chrome.exe',
    progId: /^ChromeHTML/i,
    linux: ['google-chrome', 'google-chrome-stable'],
  },
  {
    name: 'Brave',
    bundle: 'com.brave.browser',
    mac: 'Brave Browser.app/Contents/MacOS/Brave Browser',
    windows: 'BraveSoftware/Brave-Browser/Application/brave.exe',
    progId: /^BraveHTML/i,
    linux: ['brave-browser', 'brave-browser-stable', 'brave'],
  },
  {
    name: 'Microsoft Edge',
    bundle: 'com.microsoft.edgemac',
    mac: 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    windows: 'Microsoft/Edge/Application/msedge.exe',
    progId: /^MSEdgeHTM/i,
    linux: ['microsoft-edge', 'microsoft-edge-stable'],
  },
  {
    name: 'Chromium',
    bundle: 'org.chromium.chromium',
    mac: 'Chromium.app/Contents/MacOS/Chromium',
    windows: 'Chromium/Application/chrome.exe',
    progId: /^ChromiumHTM/i,
    linux: ['chromium', 'chromium-browser'],
  },
  {
    name: 'Vivaldi',
    bundle: 'com.vivaldi.vivaldi',
    mac: 'Vivaldi.app/Contents/MacOS/Vivaldi',
    windows: 'Vivaldi/Application/vivaldi.exe',
    progId: /^VivaldiHTM/i,
    linux: ['vivaldi', 'vivaldi-stable'],
  },
] as const;

async function defaultBrowser(environment: BrowserEnvironment): Promise<string> {
  try {
    if (environment.platform === 'darwin') {
      const handlers: { LSHandlerURLScheme?: string; LSHandlerRoleAll?: string }[] = JSON.parse(
        await environment.command('/usr/bin/plutil', [
          '-extract',
          'LSHandlers',
          'json',
          '-o',
          '-',
          path.posix.join(
            environment.home,
            'Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist',
          ),
        ]),
      );
      return (
        handlers.find((h) => h.LSHandlerURLScheme === 'https')?.LSHandlerRoleAll ??
        handlers.find((h) => h.LSHandlerURLScheme === 'http')?.LSHandlerRoleAll ??
        ''
      ).toLowerCase();
    }
    if (environment.platform === 'win32') {
      const result = await environment.command('reg.exe', [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
        '/v',
        'ProgId',
      ]);
      return result.match(/ProgId\s+REG_SZ\s+(\S+)/i)?.[1] ?? '';
    }
    return (await environment.command('xdg-settings', ['get', 'default-web-browser'])).trim();
  } catch {
    // Missing desktop settings are normal on servers and fresh OS accounts.
    return '';
  }
}

export const browserHelp =
  'No compatible browser found. Install Chrome, Brave, Edge, Chromium or Vivaldi, set APPLYKIT_BROWSER_PATH to a Chromium-based browser executable, or run npx playwright install chromium. Safari and Firefox cannot render PDFs with this workflow.';

/** Prefer a compatible OS default, then another system browser, then an existing Playwright install. */
export async function findBrowser(
  environment: BrowserEnvironment = system,
): Promise<BrowserSelection | undefined> {
  const paths = environment.platform === 'win32' ? path.win32 : path.posix;
  const override = environment.env.APPLYKIT_BROWSER_PATH;
  if (override !== undefined) {
    if (!paths.isAbsolute(override) || !(await environment.isExecutable(override)))
      throw new Error(
        'APPLYKIT_BROWSER_PATH must be an absolute path to an existing browser executable.',
      );
    return { name: 'Configured browser', executablePath: override, source: 'override' };
  }
  const preferred = await defaultBrowser(environment);
  const isDefault = (browser: (typeof browsers)[number]) => {
    if (environment.platform === 'darwin') return preferred === browser.bundle;
    if (environment.platform === 'win32') return browser.progId.test(preferred);
    return browser.linux.some((command) => preferred === `${command}.desktop`);
  };
  const ordered = [...browsers.filter(isDefault), ...browsers.filter((b) => !isDefault(b))];
  for (const browser of ordered) {
    let candidates: string[];
    if (environment.platform === 'darwin') {
      candidates = ['/Applications', paths.join(environment.home, 'Applications')].map((root) =>
        paths.join(root, browser.mac),
      );
    } else if (environment.platform === 'win32') {
      candidates = [
        environment.env.LOCALAPPDATA,
        environment.env.PROGRAMFILES,
        environment.env['ProgramFiles(x86)'],
        environment.env.ProgramFiles,
      ]
        .filter((root): root is string => Boolean(root))
        .map((root) => paths.join(root, browser.windows));
    } else {
      const directories = (environment.env.PATH ?? '/usr/local/bin:/usr/bin:/bin:/snap/bin')
        .split(paths.delimiter)
        .filter((directory) => paths.isAbsolute(directory));
      candidates = browser.linux.flatMap((command) =>
        directories.map((directory) => paths.join(directory, command)),
      );
    }
    for (const executablePath of candidates) {
      if (await environment.isExecutable(executablePath))
        return { name: browser.name, executablePath, source: 'system' };
    }
  }
  if (await environment.isExecutable(environment.bundledPath))
    return {
      name: 'Playwright Chromium',
      executablePath: environment.bundledPath,
      source: 'playwright',
    };
  return undefined;
}

export async function launchBrowser(headless: boolean) {
  const selected = await findBrowser();
  if (!selected) throw new Error(browserHelp);
  try {
    return await chromium.launch({ executablePath: selected.executablePath, headless });
  } catch (cause) {
    throw new Error(
      `Could not launch ${selected.name} at ${selected.executablePath}. Check the browser installation or set APPLYKIT_BROWSER_PATH to another Chromium-based browser.`,
      { cause },
    );
  }
}
