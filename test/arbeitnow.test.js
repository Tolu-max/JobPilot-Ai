import test from 'node:test';
import assert from 'node:assert/strict';
import { arbeitnowAdapter, resolveArbeitnowApplyUrl } from '../src/adapters/arbeitnow.js';
import { getAdapter } from '../src/adapters/index.js';
import { classifyApplyUrl, shouldAllowGatewayHandoff } from '../src/adapters/atsResolver.js';
import { FormStep, Proof } from '../src/adapters/types.js';
import { ArbeitnowScraper } from '../src/scrapers/arbeitnow.js';
import { scraperRegistry } from '../src/scrapers/index.js';

test('arbeitnow adapter matches arbeitnow.com job URLs', () => {
  assert.equal(arbeitnowAdapter.matches('https://www.arbeitnow.com/jobs/companies/opentas/senior-marketing-specialist-hamburg-427638'), true);
  assert.equal(arbeitnowAdapter.matches('https://www.arbeitnow.com/view/senior-developer-123'), true);
  assert.equal(arbeitnowAdapter.matches('https://jobs.lever.co/hotjar/123'), false);
  assert.equal(arbeitnowAdapter.matches('https://boards.greenhouse.io/hotjar/jobs/456'), false);
  assert.equal(arbeitnowAdapter.matches(''), false);
  assert.equal(arbeitnowAdapter.matches(null), false);
});

test('getAdapter selects arbeitnow for arbeitnow.com job URLs', () => {
  assert.equal(getAdapter('https://www.arbeitnow.com/jobs/companies/opentas/senior-marketing-specialist-hamburg-427638').name, 'arbeitnow');
  assert.equal(getAdapter('https://www.arbeitnow.com/view/developer-456').name, 'arbeitnow');
});

test('arbeitnow is classified as gateway and audited in atsResolver', () => {
  const c = classifyApplyUrl('https://www.arbeitnow.com/jobs/companies/opentas/senior-marketing-specialist-hamburg-427638');
  assert.equal(c.supported, true);
  assert.equal(c.adapter, 'arbeitnow');
  assert.equal(c.audited, true);
  assert.equal(c.kind, 'gateway');
  assert.equal(shouldAllowGatewayHandoff(c, { allowGatewayAutoSubmit: true }), true);
  assert.equal(shouldAllowGatewayHandoff(c, { allowGatewayAutoSubmit: false }), false);
});

test('arbeitnow getCurrentStep detects application page', async () => {
  const normalPage = {
    locator: () => ({
      innerText: async () => 'Apply for this position'
    })
  };
  assert.equal(await arbeitnowAdapter.getCurrentStep(normalPage), FormStep.DETAILS);

  const unknownPage = {
    locator: () => ({
      innerText: async () => 'Error 404'
    })
  };
  assert.equal(await arbeitnowAdapter.getCurrentStep(unknownPage), FormStep.UNKNOWN);
});

test('arbeitnow isSubmitted and verifySubmission return no proof (gateway only)', async () => {
  const sub = await arbeitnowAdapter.isSubmitted({});
  assert.equal(sub.submitted, false);

  const ver = await arbeitnowAdapter.verifySubmission({});
  assert.equal(ver.proof, Proof.NOT_SUBMITTED);
  assert.equal(ver.markers.length, 0);
});

test('arbeitnow scraper is registered in scraperRegistry', () => {
  assert.ok(scraperRegistry.arbeitnow);
  assert.equal(scraperRegistry.arbeitnow.implemented, true);
  assert.equal(typeof scraperRegistry.arbeitnow.scrape, 'function');
});

test('ArbeitnowScraper normalizes jobs properly', () => {
  const scraper = new ArbeitnowScraper({}, {});
  const rawJob = {
    slug: 'acme-full-stack-123',
    title: 'Senior Full Stack Engineer',
    company_name: 'Acme Corp',
    remote: true,
    location: 'Remote',
    job_types: ['Full-time'],
    description: 'Looking for a full stack engineer',
    tags: ['JavaScript', 'Node.js', 'React'],
    url: 'https://www.arbeitnow.com/jobs/companies/acme/senior-full-stack-engineer-123',
    created_at: 1715000000
  };

  const normalized = scraper.normalizeJob(rawJob);
  assert.equal(normalized.source_site, 'arbeitnow');
  assert.equal(normalized.title, 'Senior Full Stack Engineer');
  assert.equal(normalized.company, 'Acme Corp');
  assert.equal(normalized.location, 'Remote');
  assert.equal(normalized.applicationUrl, 'https://www.arbeitnow.com/jobs/companies/acme/senior-full-stack-engineer-123/apply');
  assert.ok(normalized.jobHash);
});
