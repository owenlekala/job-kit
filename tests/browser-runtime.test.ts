import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBrowser, type BrowserEnvironment } from '../src/adapters/browser-runtime.js';

function fixture(
  platform: NodeJS.Platform,
  installed: string[],
  defaultSetting = '',
  env: NodeJS.ProcessEnv = {},
): BrowserEnvironment {
  return {
    platform,
    env,
    home: '/home/fixture',
    bundledPath: '/playwright/chrome',
    isExecutable: async (file) => installed.includes(file),
    command: async () => defaultSetting,
  };
}

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const brave = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';

test('macOS prefers the compatible default over Chrome and bundled Chromium', async () => {
  const browser = await findBrowser(
    fixture(
      'darwin',
      [chrome, brave, '/playwright/chrome'],
      JSON.stringify([{ LSHandlerURLScheme: 'https', LSHandlerRoleAll: 'com.brave.Browser' }]),
    ),
  );
  assert.equal(browser?.executablePath, brave);
  assert.equal(browser?.source, 'system');
});

test('an unsupported default uses an installed compatible browser', async () => {
  const browser = await findBrowser(
    fixture(
      'darwin',
      [brave],
      JSON.stringify([{ LSHandlerURLScheme: 'https', LSHandlerRoleAll: 'com.apple.Safari' }]),
    ),
  );
  assert.equal(browser?.name, 'Brave');
});

test('macOS also discovers applications installed for the current user', async () => {
  const executable = '/home/fixture/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  assert.equal(
    (await findBrowser(fixture('darwin', [executable], '[]')))?.executablePath,
    executable,
  );
});

test('missing desktop settings do not prevent installed browser detection', async () => {
  const environment = fixture('darwin', [chrome]);
  environment.command = async () => {
    throw new Error('No desktop session');
  };
  assert.equal((await findBrowser(environment))?.executablePath, chrome);
});

test('Windows uses the default browser from a per-user installation with spaces', async () => {
  const root = 'C:\\Users\\Fixture User\\AppData\\Local';
  const executable = `${root}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`;
  const browser = await findBrowser(
    fixture('win32', [executable], '    ProgId    REG_SZ    BraveHTML.123', { LOCALAPPDATA: root }),
  );
  assert.equal(browser?.executablePath, executable);
});

test('Windows default Edge takes priority over an installed Chrome', async () => {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browser = await findBrowser(
    fixture('win32', [chromePath, edgePath], '    ProgId    REG_SZ    MSEdgeHTM', {
      PROGRAMFILES: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    }),
  );
  assert.equal(browser?.executablePath, edgePath);
});

test('Linux honors the default browser and custom absolute PATH directories', async () => {
  const browser = await findBrowser(
    fixture(
      'linux',
      ['/opt/bin/brave-browser', '/usr/bin/google-chrome'],
      'brave-browser.desktop\n',
      { PATH: '.:/opt/bin:/usr/bin' },
    ),
  );
  assert.equal(browser?.executablePath, '/opt/bin/brave-browser');
});

test('an unavailable default and relative PATH entries are skipped', async () => {
  const browser = await findBrowser(
    fixture('linux', ['google-chrome', '/usr/bin/chromium'], 'brave-browser.desktop', {
      PATH: '.:/usr/bin',
    }),
  );
  assert.equal(browser?.executablePath, '/usr/bin/chromium');
});

test('an explicit executable path takes precedence and does not inspect desktop settings', async () => {
  const executable = '/custom browser/chrome';
  const environment = fixture('darwin', [chrome, executable], '', {
    APPLYKIT_BROWSER_PATH: executable,
  });
  environment.command = async () => {
    assert.fail('Default browser should not be queried');
  };
  assert.deepEqual(await findBrowser(environment), {
    name: 'Configured browser',
    executablePath: executable,
    source: 'override',
  });
});

test('an invalid explicit override fails rather than silently selecting another browser', async () => {
  for (const override of ['', 'relative/chrome', '/missing/chrome'])
    await assert.rejects(
      findBrowser(fixture('darwin', [chrome], '', { APPLYKIT_BROWSER_PATH: override })),
      /APPLYKIT_BROWSER_PATH must be an absolute path/,
    );
});

test('an existing Playwright browser remains a fallback and missing browsers are reported', async () => {
  assert.equal((await findBrowser(fixture('linux', ['/playwright/chrome'])))?.source, 'playwright');
  assert.equal(await findBrowser(fixture('linux', [])), undefined);
});
