import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

test('domain and application dependencies point inward', async () => {
  for (const layer of ['domain', 'application']) {
    const directory = new URL(`../src/${layer}/`, import.meta.url);
    for (const file of await readdir(directory)) {
      const source = await readFile(new URL(file, directory), 'utf8');
      const imports = Array.from(
        source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g),
        (m) => m[1]!,
      );
      for (const imported of imports) {
        assert.doesNotMatch(
          imported,
          /adapters|\/cli\//,
          `${layer}/${file} imports a concrete adapter`,
        );
        if (layer === 'domain')
          assert.doesNotMatch(
            imported,
            /application|node:(?:fs|http|child_process)|playwright|docx/,
            `${file} performs infrastructure work`,
          );
      }
    }
  }
});
