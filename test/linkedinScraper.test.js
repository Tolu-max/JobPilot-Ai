import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LinkedinScraper,
  parseLinkedinMarkdown,
  normalizeLinkedinJob,
  resolveLinkedinSearchUrls,
  rotateSearchUrls
} from '../src/scrapers/linkedin.js';
import { scraperRegistry } from '../src/scrapers/index.js';

test('LinkedIn Scraper: registered in scraperRegistry and marked implemented', () => {
  const reg = scraperRegistry['linkedin'];
  assert.ok(reg, 'linkedin is in scraperRegistry');
  assert.equal(reg.implemented, true, 'is marked implemented');
  assert.equal(typeof reg.scrape, 'function', 'has scrape function');
});

test('LinkedIn Scraper: parseLinkedinMarkdown extracts structured jobs from markdown', () => {
  const sampleMarkdown = `
    6,000+ Wordpress Developer Jobs in Remote

    [Senior WordPress Developer (Remote, Providence)](https://www.linkedin.com/jobs/view/senior-wordpress-developer-remote-providence-at-blacksmith-agency-4472449774?position=2\\&pageNum=0)

    Senior WordPress Developer (Remote, Providence)

    [Blacksmith Agency](https://www.linkedin.com/company/blacksmith-agency?trk=public_jobs_jserp-result_job-search-card-subtitle)

    United States 1 week ago

    [Full Stack Engineer](https://ng.linkedin.com/jobs/view/full-stack-engineer-at-lorgarithm-4448966537?position=3\\&pageNum=0)

    Full Stack Engineer

    [Lorgarithm](https://ng.linkedin.com/company/lorgarithm?trk=public_jobs_jserp-result_job-search-card-subtitle)

    Abuja, Federal Capital Territory, Nigeria 2 months ago
  `;

  const jobs = parseLinkedinMarkdown(sampleMarkdown);
  assert.equal(jobs.length, 2);

  const j1 = jobs[0];
  assert.equal(j1.title, 'Senior WordPress Developer (Remote, Providence)');
  assert.equal(j1.sourceJobId, '4472449774');
  assert.equal(j1.company, 'Blacksmith Agency');
  assert.equal(j1.location, 'United States');
  assert.equal(j1.is_remote, true);
  assert.equal(j1.applicationUrl, 'https://www.linkedin.com/jobs/view/4472449774');

  const j2 = jobs[1];
  assert.equal(j2.title, 'Full Stack Engineer');
  assert.equal(j2.sourceJobId, '4448966537');
  assert.equal(j2.company, 'Lorgarithm');
  assert.ok(j2.location.includes('Abuja'));
  assert.equal(j2.applicationUrl, 'https://www.linkedin.com/jobs/view/4448966537');
});

test('LinkedIn Scraper: parseLinkedinMarkdown handles empty text gracefully', () => {
  assert.deepEqual(parseLinkedinMarkdown(''), []);
  assert.deepEqual(parseLinkedinMarkdown('No jobs listed here'), []);
});

test('LinkedIn Scraper: normalizeLinkedinJob correctly normalizes attributes and links', () => {
  const rawJob = {
    jobkey: '4472449774',
    title: 'Senior WordPress Developer',
    company: 'Blacksmith Agency',
    location: 'Remote',
    remoteLocation: true,
    link: 'https://www.linkedin.com/jobs/view/4472449774',
    hasEasyApply: true
  };

  const normalized = normalizeLinkedinJob(rawJob);
  assert.equal(normalized.source, 'linkedin');
  assert.equal(normalized.sourceJobId, '4472449774');
  assert.equal(normalized.title, 'Senior WordPress Developer');
  assert.equal(normalized.company, 'Blacksmith Agency');
  assert.equal(normalized.location, 'Remote');
  assert.equal(normalized.is_remote, true);
  assert.equal(normalized.applicationUrl, 'https://www.linkedin.com/jobs/view/4472449774');
  assert.equal(normalized.hasEasyApply, true);
});

test('LinkedIn Scraper: resolveLinkedinSearchUrls adapts cleanly per profile', () => {
  const toluUrls = resolveLinkedinSearchUrls({ profileName: 'tolu' });
  assert.ok(toluUrls.some((u) => u.includes('wordpress+developer')));
  assert.ok(toluUrls.some((u) => u.includes('full+stack+developer')));
  assert.ok(toluUrls.some((u) => u.includes('Abuja')));

  const sisterUrls = resolveLinkedinSearchUrls({ profileName: 'sister' });
  assert.ok(sisterUrls.some((u) => u.includes('customer+support')));
  assert.ok(sisterUrls.some((u) => u.includes('virtual+assistant')));
  assert.ok(sisterUrls.some((u) => u.includes('Abuja')));
});

test('LinkedIn Scraper: rotateSearchUrls rotates array gracefully', () => {
  const urls = ['u1', 'u2', 'u3', 'u4'];
  const rotated = rotateSearchUrls(urls, 15);
  assert.equal(rotated.length, 4);
  assert.deepEqual(new Set(rotated), new Set(urls));
  assert.deepEqual(rotateSearchUrls([]), []);
  assert.deepEqual(rotateSearchUrls(['one']), ['one']);
});

test('LinkedIn Scraper: matchesSitePolicy enforces strict candidate role isolation', () => {
  const scraperSister = new LinkedinScraper({ profileName: 'sister' });
  assert.equal(scraperSister.matchesSitePolicy({ title: 'Customer Support Lead', is_remote: true }), true);
  assert.equal(scraperSister.matchesSitePolicy({ title: 'Full Stack Web Developer', is_remote: true }), false);

  const scraperTolu = new LinkedinScraper({ profileName: 'tolu' });
  assert.equal(scraperTolu.matchesSitePolicy({ title: 'Senior WordPress Engineer', is_remote: true }), true);
  assert.equal(scraperTolu.matchesSitePolicy({ title: 'Customer Service Representative', is_remote: true }), false);
});
