import { readdir, readFile } from 'node:fs/promises';
const violations = [];
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await inspect(file);
    else if (
      /\.(?:ts|md|json|css)$/.test(file) &&
      (await readFile(file, 'utf8')).includes('\u2014')
    )
      violations.push(file);
  }
}
for (const directory of ['src', 'skills', 'templates', 'examples', 'docs'])
  await inspect(directory);
if ((await readFile('README.md', 'utf8')).includes('\u2014')) violations.push('README.md');
if (violations.length) {
  console.error(`Replace em dashes with appropriate punctuation in:\n${violations.join('\n')}`);
  process.exitCode = 1;
} else
  console.log(
    'Wording check passed: no em dashes in application source, examples, templates, skills, or documentation.',
  );
