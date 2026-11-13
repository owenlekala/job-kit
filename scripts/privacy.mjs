import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
const violations = [];
for (const file of files) {
  if (
    /(^|\/)(\.env(?:\..*)?|workspace|private|output|runtime)(\/|$)|\.(?:pdf|docx|log|auth\.json)$/.test(
      file,
    )
  )
    violations.push(`${file}: private/generated path`);
  const text = readFileSync(file, 'utf8');
  if (/\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/.test(text))
    violations.push(`${file}: possible API credential`);
  if (/"(?:password|BW_SESSION|access_token|refresh_token)"\s*:\s*"[^"\n]+"/.test(text))
    violations.push(`${file}: literal secret value`);
}
if (violations.length) {
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log(
  `Privacy check passed for ${files.length} repository files. This catches common mistakes; inspect git diff before sharing.`,
);
