import test from 'node:test';
import assert from 'node:assert/strict';
import { workingnomadsAdapter, resolveWorkingNomadsApplyUrl } from '../src/adapters/workingnomads.js';
import { getAdapter } from '../src/adapters/index.js';
import { classifyApplyUrl, shouldAllowGatewayHandoff } from '../src/adapters/atsResolver.js';
import { FormStep, Proof } from '../src/adapters/types.js';
import { WorkingNomadsScraper } from '../src/scrapers/workingnomads.js';
import { scraperRegistry } from '../src/scrapers/index.js';

test('workingnomads adapter matches workingnomads.com job URLs', () => {
  assert.equal(workingnomadsAdapter.matches('https://www.workingnomads.com/jobs/senior-software-engineer-elastic'), true);
  assert.equal(workingnomadsAdapter.matches('https://jobs.lever.co/hotjar/123'), false);
  assert.equal(workingnomadsAdapter.matches('https://boards.greenhouse.io/hotjar/jobs/456'), false);
  assert.equal(workingnomadsAdapter.matches(''), false);
  assert.equal(workingnomadsAdapter.matches(null), false);
});

test('getAdapter selects workingnomads for workingnomads.com job URLs', () => {
  assert.equal(getAdapter('https://www.workingnomads.com/jobs/senior-software-engineer-elastic').name, 'workingnomads');
});

test('workingnomads is classified as gateway and audited in atsResolver', () => {
  const c = classifyApplyUrl('https://www.workingnomads.com/jobs/senior-software-engineer-elastic');
  assert.equal(c.supported, true);
  assert.equal(c.adapter, 'workingnomads');
  assert.equal(c.audited, true);
  assert.equal(c.kind, 'gateway');
  assert.equal(shouldAllowGatewayHandoff(c, { allowGatewayAutoSubmit: true }), true);
  assert.equal(shouldAllowGatewayHandoff(c, { allowGatewayAutoSubmit: false }), false);
});

test('workingnomads getCurrentStep detects application page', async () => {
  const normalPage = {
    locator: () => ({
      innerText: async () => 'Apply for this position on employer site'
    })
  };
  assert.equal(await workingnomadsAdapter.getCurrentStep(normalPage), FormStep.DETAILS);

  const unknownPage = {
    locator: () => ({
      innerText: async () => 'Not found'
    })
  };
  assert.equal(await workingnomadsAdapter.getCurrentStep(unknownPage), FormStep.UNKNOWN);
});

test('workingnomads isSubmitted and verifySubmission return no proof (gateway only)', async () => {
  const sub = await workingnomadsAdapter.isSubmitted({});
  assert.equal(sub.submitted, false);

  const ver = await workingnomadsAdapter.verifySubmission({});
  assert.equal(ver.proof, Proof.NOT_SUBMITTED);
  assert.equal(ver.markers.length, 0);
});

test('workingnomads scraper is registered in scraperRegistry', () => {
  assert.ok(scraperRegistry.workingnomads);
  assert.equal(scraperRegistry.workingnomads.implemented, true);
  assert.equal(typeof scraperRegistry.workingnomads.scrape, 'function');
});

test('WorkingNomadsScraper normalizes jobs properly', () => {
  const scraper = new WorkingNomadsScraper({}, {});
  const rawJob = {
    id: 12345,
    title: 'Senior DevOps Engineer',
    company: 'Cloud Corp',
    location: 'Remote',
    category_name: 'DevOps',
    description: 'Looking for a DevOps engineer',
    tags: ['AWS', 'Kubernetes', 'Docker'],
    apply_url: 'https://boards.greenhouse.io/cloudcorp/jobs/12345',
    slug: 'senior-devops-engineer-cloudcorp',
    pub_date: '2026-09-10T00:00:00Z'
  };

  const normalized = scraper.normalizeJob(rawJob);
  assert.equal(normalized.source_site, 'workingnomads');
  assert.equal(normalized.title, 'Senior DevOps Engineer');
  assert.equal(normalized.company, 'Cloud Corp');
  assert.equal(normalized.location, 'Remote');
  assert.equal(normalized.applicationUrl, 'https://boards.greenhouse.io/cloudcorp/jobs/12345');
  assert.ok(normalized.jobHash);
});
