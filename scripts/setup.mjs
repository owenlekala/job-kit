import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
if (Number(process.versions.node.split('.')[0]) < 24)
  throw new Error('Node.js 24 or later is required');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(
    'setup [--agent all|codex|claude|cursor] [--skip-browser]\nInstalls locked dependencies, builds the CLI, initializes private storage and installs project skills.',
  );
  process.exit(0);
}
let agent = 'all',
  skipBrowser = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--agent') agent = args[++i];
  else if (args[i] === '--skip-browser') skipBrowser = true;
  else throw new Error(`Unknown option: ${args[i]}`);
}
if (!['all', 'codex', 'claude', 'cursor'].includes(agent)) throw new Error('Unsupported agent');
const run = (command, argv) => {
  const r = spawnSync(command, argv, { cwd: root, stdio: 'inherit', env: process.env });
  if (r.error || r.status !== 0)
    throw new Error(
      `Setup step failed: ${command}. Resolve the error above and rerun setup; user data is preserved.`,
    );
};
if (process.platform === 'win32') run('cmd.exe', ['/d', '/s', '/c', 'npm ci --no-fund --no-audit']);
else run('npm', ['ci', '--no-fund', '--no-audit']);
run(process.execPath, ['node_modules/typescript/bin/tsc']);
if (!skipBrowser) run(process.execPath, ['node_modules/playwright/cli.js', 'install', 'chromium']);
run(process.execPath, ['dist/cli/index.js', 'init']);
run(process.execPath, [
  'dist/cli/index.js',
  'skills',
  'install',
  '--agent',
  agent,
  '--target',
  root,
]);
run(process.execPath, ['dist/cli/index.js', 'doctor']);
console.log(
  '\nReady. Run: node dist/cli/index.js --help\nOptionally run npm link to expose applykit globally. Bitwarden is only required for portal accounts.',
);
