import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkArrangements } from '../src/adapters/profile-editor.js';
import { Profile } from '../src/domain/models.js';

const profile = {
  version: 1,
  name: 'Fixture Applicant',
  headline: 'Engineer',
  contact: { email: 'fixture@example.com' },
  facts: [{ id: 'experience', kind: 'experience', text: 'Maintained internal tools' }],
};

test('terminal work arrangements accept mixed case and surrounding whitespace', () => {
  const result = Profile.parse({
    ...profile,
    preferences: { arrangements: parseWorkArrangements(' Remote, HYBRID , OnSite, ') },
  });
  assert.deepEqual(result.preferences.arrangements, ['remote', 'hybrid', 'onsite']);
});

test('blank optional work preferences remain valid', () => {
  const result = Profile.parse({
    ...profile,
    preferences: { arrangements: parseWorkArrangements(' , , ') },
  });
  assert.deepEqual(result.preferences.arrangements, []);
});

test('normalizing work arrangements does not accept unsupported preferences', () => {
  assert.throws(
    () =>
      Profile.parse({
        ...profile,
        preferences: { arrangements: parseWorkArrangements('Remote, elsewhere') },
      }),
    /Invalid option/,
  );
});
