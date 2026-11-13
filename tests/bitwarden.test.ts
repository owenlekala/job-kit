import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Bitwarden } from '../src/adapters/bitwarden.js';

test('Bitwarden transport uses stdin for unique passwords and suppresses secret errors', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'applykit vault fixture '));
  const script = path.join(root, 'vault.mjs');
  const itemId = '00000000-0000-4000-8000-000000000001';
  try {
    await writeFile(
      script,
      `import assert from 'node:assert/strict';
      const args=process.argv.slice(2);assert.ok(args.includes('--nointeraction'));
      if(args[0]==='status') console.log(JSON.stringify({status:'unlocked'}));
      else if(args[0]==='get' && args[1]==='template') console.log('{}');
      else if(args[0]==='create') {
        let input='';for await(const chunk of process.stdin) input+=chunk;
        const item=JSON.parse(Buffer.from(input,'base64').toString('utf8'));
        assert.equal(args.length,3);assert.ok(item.login.password.length>=30);
        assert.equal(item.login.username,'alex@example.com');
        console.log(JSON.stringify({id:'${itemId}'}));
      } else {console.error('fixture-sensitive-output');process.exit(1);}`,
    );
    const vault = new Bitwarden({ file: process.execPath, prefix: [script] });
    assert.equal(await vault.status(), 'unlocked');
    assert.equal(
      await vault.create('alex@example.com', 'https://careers.example.com', 'company'),
      itemId,
    );
    await assert.rejects(vault.lookup('some-title'), /exact Bitwarden item UUID/);
    await assert.rejects(
      vault.lookup(itemId),
      (error) => error instanceof Error && !error.message.includes('fixture-sensitive-output'),
    );
    await writeFile(script, `console.log('fixture-sensitive-output');`);
    await assert.rejects(
      vault.status(),
      (error) => error instanceof Error && !error.message.includes('fixture-sensitive-output'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
