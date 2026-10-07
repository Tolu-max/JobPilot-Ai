import test from 'node:test';
import assert from 'node:assert/strict';
import { isNonEnglishJob } from '../src/pipeline.js';

test('himalayas customer-support jobs are not rejected for broad country/location words', () => {
  assert.equal(
    isNonEnglishJob({
      source: 'himalayas',
      title: 'Customer Support Agent',
      company: 'Impact Brands',
      location: 'Remote worldwide',
      requirements: 'Customer-Support, Sales-Support, CRM',
      description: 'Support customers across France, Germany, Brazil, and Portugal in English.'
    }),
    false
  );
});

test('explicit bilingual and non-English title markers are still rejected', () => {
  assert.equal(
    isNonEnglishJob({
      source: 'himalayas',
      title: 'Bilingual Spanish Customer Support Agent',
      requirements: 'Customer support'
    }),
    true
  );

  assert.equal(
    isNonEnglishJob({
      source: 'himalayas',
      title: 'Desenvolvedor Frontend',
      requirements: 'React'
    }),
    true
  );
});
