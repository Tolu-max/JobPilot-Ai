import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSiteOptions,
  normalizeProfileName,
  parseNumberInRange,
  splitCsv,
  splitLocation
} from '../src/cli/onboarding.js';

test('onboarding normalizes profile names safely', () => {
  assert.equal(normalizeProfileName(' Sister Profile! '), 'sister_profile');
  assert.equal(normalizeProfileName(''), 'main');
});

test('onboarding parses csv values without duplicates', () => {
  assert.deepEqual(splitCsv('SEO, React, SEO,  Node.js '), ['SEO', 'React', 'Node.js']);
});

test('onboarding clamps numeric answers', () => {
  assert.equal(parseNumberInRange('500', 1, 100, 20), 100);
  assert.equal(parseNumberInRange('-1', 1, 100, 20), 1);
  assert.equal(parseNumberInRange('nope', 1, 100, 20), 20);
});

test('onboarding splits city/country from resume location', () => {
  assert.deepEqual(splitLocation('Kaduna, Nigeria'), { city: 'Kaduna', country: 'Nigeria' });
  assert.deepEqual(splitLocation('Nigeria'), { city: 'Nigeria', country: 'Nigeria' });
});

test('onboarding site options only include implemented scrapers and safe defaults', () => {
  const options = buildSiteOptions();
  const values = options.map((option) => option.value);

  assert.equal(values.includes('remoteok'), true);
  assert.equal(values.includes('remotive'), true);
  assert.equal(values.includes('linkedin'), false);
  assert.equal(options.find((option) => option.value === 'remoteok')?.selected, true);
});
