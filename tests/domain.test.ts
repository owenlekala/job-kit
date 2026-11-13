import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonical,
  checkWebUrl,
  digest,
  Draft,
  Packet,
  Profile,
  assertNoSecrets,
  validateEvidence,
} from '../src/domain/models.js';
import { setup, seed, replaceProfile } from './support.js';

test('stable hashing ignores object property order but binds every value', () => {
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
  assert.notEqual(digest({ a: 1 }), digest({ a: 2 }));
  assert.equal(canonical({ x: undefined, y: 1 }), '{"y":1}');
});
test('unsafe URLs and plaintext credential fields are rejected', () => {
  for (const url of [
    'http://example.com',
    'https://user:pass@example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
  ])
    assert.throws(() => checkWebUrl(url));
  assert.throws(() => checkWebUrl('http://localhost:5000'));
  assert.doesNotThrow(() => checkWebUrl('http://127.0.0.1:5000', true));
  assert.throws(() => assertNoSecrets({ answers: { password: 'value' } }));
  assert.throws(() => assertNoSecrets({ nested: [{ access_token: 'value' }] }));
});
test('invalid schemas, duplicate facts, missing evidence, and placeholders fail', async () => {
  const s = await setup();
  try {
    await seed(s.kit);
    const p = await s.kit.profile();
    const c = await s.kit.context('application-one');
    assert.throws(() => Profile.parse({ ...p, facts: [p.facts[0], p.facts[0]] }));
    assert.throws(() => Profile.parse({ ...p, contact: { ...p.contact, email: 'bad' } }));
    const invalid = Draft.parse({ ...c.draft, factIds: ['unknown'] });
    assert.throws(() => validateEvidence(p, invalid));
    assert.throws(() => validateEvidence(p, Draft.parse({ ...c.draft, headline: '[Job Title]' })));
    assert.throws(() =>
      Packet.parse({ ...c.packet, steps: [{ action: 'submit', selector: '#submit' }] }),
    );
  } finally {
    await s.cleanup();
  }
});
test('imported profiles require explicit verification and source JS is not executed', async () => {
  const s = await setup();
  try {
    const p = await s.kit.profile();
    await replaceProfile(s.kit, p);
    assert.equal((await s.kit.validateProfile()).verified, 0);
    await s.kit.verifyFacts(['delivery']);
    assert.equal((await s.kit.validateProfile()).verified, 1);
    const record = await s.kit.importSource(
      'legacy.js',
      'throw new Error("never execute source");',
    );
    assert.equal(record.verified, false);
    await s.kit.importCompanies([{ version: 1, id: 'co', name: 'Company' }]);
    await assert.rejects(
      s.kit.importCompanies([
        {
          version: 1,
          id: 'unverified-contact',
          name: 'Company',
          recruitmentEmail: 'hr@example.com',
        },
      ]),
      /source URL/,
    );
  } finally {
    await s.cleanup();
  }
});
