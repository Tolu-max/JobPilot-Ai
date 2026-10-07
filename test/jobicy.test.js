import test from 'node:test';
import assert from 'node:assert/strict';
import { jobicyAdapter, resolveJobicyApplyUrl } from '../src/adapters/jobicy.js';
import { getAdapter } from '../src/adapters/index.js';
import { classifyApplyUrl, shouldAllowGatewayHandoff } from '../src/adapters/atsResolver.js';
import { FormStep, Proof } from '../src/adapters/types.js';
import { JobicyScraper } from '../src/scrapers/jobicy.js';
import { scraperRegistry } from '../src/scrapers/index.js';

test('jobicy adapter matches jobicy.com job URLs', () => {
  assert.equal(jobicyAdapter.matches('https://jobicy.com/jobs/152957-principal-partner-manager'), true);
  assert.equal(jobicyAdapter.matches('https://jobicy.com/jobs/99999-developer'), true);
  assert.equal(jobicyAdapter.matches('https://jobs.lever.co/hotjar/123'), false);
  assert.equal(jobicyAdapter.matches('https://boards.greenhouse.io/hotjar/jobs/456'), false);
  assert.equal(jobicyAdapter.matches(''), false);
  assert.equal(jobicyAdapter.matches(null), false);
});

test('getAdapter selects jobicy for jobicy.com job URLs', () => {
  assert.equal(getAdapter('https://jobicy.com/jobs/152957-principal-partner-manager').name, 'jobicy');
  assert.equal(getAdapter('https://jobicy.com/jobs/123-frontend-dev').name, 'jobicy');
});

test('jobicy is classified as gateway and audited in atsResolver', () => {
  const c = classifyApplyUrl('https://jobicy.com/jobs/152957-principal-partner-manager');
  assert.equal(c.supported, true);
  assert.equal(c.adapter, 'jobicy');
  assert.equal(c.audited, true);
  assert.equal(c.kind, 'gateway');
  assert.equal(shouldAllowGatewayHandoff(c, { allowGatewayAutoSubmit: true }), true);
  assert.equal(shouldAllowGatewayHandoff(c, { allowGatewayAutoSubmit: false }), false);
});

test('jobicy getCurrentStep detects application page', async () => {
  const normalPage = {
    locator: () => ({
      innerText: async () => 'Apply for this job on employer website'
    })
  };
  assert.equal(await jobicyAdapter.getCurrentStep(normalPage), FormStep.DETAILS);

  const unknownPage = {
    locator: () => ({
      innerText: async () => 'Page not found'
    })
  };
  assert.equal(await jobicyAdapter.getCurrentStep(unknownPage), FormStep.UNKNOWN);
});

test('jobicy isSubmitted and verifySubmission return no proof (gateway only)', async () => {
  const sub = await jobicyAdapter.isSubmitted({});
  assert.equal(sub.submitted, false);

  const ver = await jobicyAdapter.verifySubmission({});
  assert.equal(ver.proof, Proof.NOT_SUBMITTED);
  assert.equal(ver.markers.length, 0);
});

test('jobicy scraper is registered in scraperRegistry', () => {
  assert.ok(scraperRegistry.jobicy);
  assert.equal(scraperRegistry.jobicy.implemented, true);
  assert.equal(typeof scraperRegistry.jobicy.scrape, 'function');
});

test('JobicyScraper normalizes jobs properly', () => {
  const scraper = new JobicyScraper({}, {});
  const rawJob = {
    id: '12345',
    jobTitle: 'Senior Full Stack Developer',
    companyName: 'Acme Cloud',
    jobGeo: 'Worldwide',
    jobType: ['Full-Time'],
    jobExcerpt: 'We are hiring a full stack dev.',
    jobIndustry: ['Engineering'],
    jobLevel: 'Senior',
    url: 'https://jobicy.com/jobs/12345-senior-dev',
    pubDate: '2026-09-09T10:00:00Z',
    annualSalaryMin: '100000',
    annualSalaryMax: '130000'
  };

  const normalized = scraper.normalizeJob(rawJob);
  assert.equal(normalized.source_site, 'jobicy');
  assert.equal(normalized.title, 'Senior Full Stack Developer');
  assert.equal(normalized.company, 'Acme Cloud');
  assert.equal(normalized.location, 'Worldwide');
  assert.equal(normalized.applicationUrl, 'https://jobicy.com/jobs/12345-senior-dev');
  assert.equal(normalized.salary, '100000-130000');
  assert.ok(normalized.jobHash);
});
