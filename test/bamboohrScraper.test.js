import test from 'node:test';
import assert from 'node:assert/strict';
import { BambooHRScraper } from '../src/scrapers/bamboohr.js';
import { scraperRegistry } from '../src/scrapers/index.js';
import { bamboohrAdapter } from '../src/adapters/bamboohr.js';

test('bamboohr scraper is registered in scraperRegistry and marked implemented', () => {
  assert.ok(scraperRegistry.bamboohr);
  assert.equal(scraperRegistry.bamboohr.implemented, true);
  assert.equal(typeof scraperRegistry.bamboohr.scrape, 'function');
});

test('bamboohrAdapter matches careers, view.php, and query URLs', () => {
  assert.equal(bamboohrAdapter.matches('https://benchmark.bamboohr.com/careers/106'), true);
  assert.equal(bamboohrAdapter.matches('https://lemonio.bamboohr.com/careers/49?source=web'), true);
  assert.equal(bamboohrAdapter.matches('https://benchmark.bamboohr.com/jobs/view.php?id=106'), true);
  assert.equal(bamboohrAdapter.matches('https://jobs.lever.co/palantir/123'), false);
  assert.equal(bamboohrAdapter.matches('https://jobs.ashbyhq.com/openai/123'), false);
});

test('BambooHRScraper normalizes job with detail correctly', () => {
  const scraper = new BambooHRScraper({}, {});
  const raw = {
    id: 106,
    jobOpeningName: 'Lowboy Driver',
    departmentLabel: 'Field Operations',
    employmentStatusLabel: 'Full-Time',
    location: { city: 'Christiana', state: 'Tennessee' },
    isRemote: false,
    _bambooBoard: { token: 'benchmark', name: 'Benchmark Companies' },
    _detail: {
      jobOpening: {
        jobOpeningName: 'Lowboy Driver',
        description: '<p>Transport heavy equipment safely across job sites.</p>',
        departmentLabel: 'Field Operations',
        employmentStatusLabel: 'Full-Time',
        location: { city: 'Christiana', state: 'Tennessee', country: 'United States' },
        datePosted: '2026-09-10T12:00:00Z'
      }
    }
  };

  const normalized = scraper.normalizeJob(raw);
  assert.equal(normalized.source, 'bamboohr');
  assert.equal(normalized.source_site, 'bamboohr');
  assert.equal(normalized.sourceJobId, '106');
  assert.equal(normalized.title, 'Lowboy Driver');
  assert.equal(normalized.company, 'Benchmark Companies');
  assert.equal(normalized.location, 'Christiana, Tennessee, United States');
  assert.equal(normalized.applicationUrl, 'https://benchmark.bamboohr.com/careers/106');
  assert.match(normalized.description, /Transport heavy equipment/);
  assert.ok(normalized.jobHash);
});

test('BambooHRScraper normalizes job with fallback when detail is unavailable', () => {
  const scraper = new BambooHRScraper({}, {});
  const raw = {
    id: '49',
    jobOpeningName: 'Remote Full Stack Web Developer',
    departmentLabel: 'Engineering',
    employmentStatusLabel: 'Full-Time',
    location: { city: '', state: '' },
    isRemote: true,
    _bambooBoard: { token: 'lemonio', name: 'Lemon.io' }
  };

  const normalized = scraper.normalizeJob(raw);
  assert.equal(normalized.source, 'bamboohr');
  assert.equal(normalized.title, 'Remote Full Stack Web Developer');
  assert.equal(normalized.company, 'Lemon.io');
  assert.equal(normalized.is_remote, true);
  assert.equal(normalized.applicationUrl, 'https://lemonio.bamboohr.com/careers/49');
});
