import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IndeedScraper,
  parseMosaicJobCards,
  parseIndeedMarkdown,
  normalizeIndeedJob,
  resolveIndeedSearchUrls,
  rotateSearchUrls
} from '../src/scrapers/indeed.js';
import { scraperRegistry } from '../src/scrapers/index.js';

test('Indeed Scraper: registered in scraperRegistry and marked implemented', () => {
  const reg = scraperRegistry['indeed'];
  assert.ok(reg, 'indeed is in scraperRegistry');
  assert.equal(reg.implemented, true, 'is marked implemented');
  assert.equal(typeof reg.scrape, 'function', 'has scrape function');
});

test('Indeed Scraper: parseMosaicJobCards extracts results from mosaic JSON payload', () => {
  const sampleMosaicText = `
    window.mosaic.providerData = {};
    window.mosaic.providerData["mosaic-provider-jobcards"] = {
      "metaData": {
        "mosaicProviderJobCardsModel": {
          "results": [
            {
              "jobkey": "jk12345",
              "normTitle": "Senior Full Stack Engineer",
              "truncatedCompany": "TechCorp",
              "formattedLocation": "Remote",
              "remoteLocation": true,
              "snippet": "Looking for PHP, Laravel and React expert.",
              "pubDate": 1790226000000,
              "indeedApplyEnabled": false,
              "thirdPartyApplyUrl": "https://boards.greenhouse.io/techcorp/jobs/12345"
            },
            {
              "jobkey": "jk67890",
              "normTitle": "Customer Care Specialist",
              "truncatedCompany": "SupportHub",
              "formattedLocation": "Lagos, Nigeria",
              "remoteLocation": false,
              "snippet": "Manage customer tickets and calls.",
              "pubDate": 1790226000000,
              "indeedApplyEnabled": true
            }
          ]
        }
      }
    };
  `;

  const results = parseMosaicJobCards(sampleMosaicText);
  assert.equal(results.length, 2);
  assert.equal(results[0].jobkey, 'jk12345');
  assert.equal(results[0].normTitle, 'Senior Full Stack Engineer');
  assert.equal(results[1].jobkey, 'jk67890');
  assert.equal(results[1].truncatedCompany, 'SupportHub');
});

test('Indeed Scraper: parseMosaicJobCards handles empty or invalid text safely', () => {
  assert.deepEqual(parseMosaicJobCards(''), []);
  assert.deepEqual(parseMosaicJobCards('<html><body>No mosaic data here</body></html>'), []);
  assert.deepEqual(parseMosaicJobCards('window.mosaic.providerData["mosaic-provider-jobcards"] = { malformed json'), []);
});

test('Indeed Scraper: normalizeIndeedJob correctly normalizes attributes and links', () => {
  const rawJob = {
    jobkey: 'jk_abc_123',
    normTitle: 'Full Stack Developer',
    truncatedCompany: 'Apex Systems',
    formattedLocation: 'Remote',
    remoteLocation: true,
    snippet: '<b>Experience</b> with PHP, MySQL, and JavaScript.',
    pubDate: 1790226000000,
    salarySnippet: { text: '$90,000 - $120,000 a year' },
    link: '/rc/clk?jk=jk_abc_123&test=1',
    indeedApplyEnabled: false,
    thirdPartyApplyUrl: 'https://jobs.lever.co/apexsystems/jk_abc_123'
  };

  const normalized = normalizeIndeedJob(rawJob, 'https://www.indeed.com');
  assert.equal(normalized.source, 'indeed');
  assert.equal(normalized.sourceJobId, 'jk_abc_123');
  assert.equal(normalized.title, 'Full Stack Developer');
  assert.equal(normalized.company, 'Apex Systems');
  assert.equal(normalized.location, 'Remote');
  assert.equal(normalized.is_remote, true);
  assert.equal(normalized.salary, '$90,000 - $120,000 a year');
  assert.ok(normalized.description.includes('Experience with PHP, MySQL'));
  assert.ok(!normalized.description.includes('<b>'));
  assert.equal(normalized.applicationUrl, 'https://www.indeed.com/rc/clk?jk=jk_abc_123&test=1');
  assert.equal(normalized.hasIndeedApply, false);
  assert.equal(normalized.thirdPartyApplyUrl, 'https://jobs.lever.co/apexsystems/jk_abc_123');
});

test('Indeed Scraper: resolveIndeedSearchUrls adapts cleanly per profile', () => {
  const toluUrls = resolveIndeedSearchUrls({ profileName: 'tolu' });
  assert.ok(toluUrls.some((u) => u.includes('full+stack+developer')));
  assert.ok(toluUrls.some((u) => u.includes('laravel')));

  const sisterUrls = resolveIndeedSearchUrls({ profileName: 'sister' });
  assert.ok(sisterUrls.some((u) => u.includes('customer+support') || u.includes('customer+service')));
  assert.ok(sisterUrls.some((u) => u.includes('virtual+assistant') || u.includes('administrative')));

  const customUrls = resolveIndeedSearchUrls({}, { searchUrls: ['https://www.indeed.com/jobs?q=custom'] });
  assert.deepEqual(customUrls, ['https://www.indeed.com/jobs?q=custom']);
});

test('Indeed Scraper: matchesSitePolicy enforces strict candidate role isolation', () => {
  const toluScraper = new IndeedScraper({ profileName: 'tolu' }, {});
  const sisterScraper = new IndeedScraper({ profileName: 'sister' }, {});

  const devJob = {
    title: 'Senior Full Stack Web Developer (PHP / Laravel / React)',
    description: 'Build modern responsive web applications',
    location: 'Remote',
    is_remote: true,
    applicationUrl: 'https://www.indeed.com/viewjob?jk=1'
  };

  const supportJob = {
    title: 'Customer Support Representative / Call Center Agent',
    description: 'Resolve customer tickets on Zendesk and handle inbound inquiries',
    location: 'Remote',
    is_remote: true,
    applicationUrl: 'https://www.indeed.com/viewjob?jk=2'
  };

  // Tolu should match developer job and REJECT customer support job
  assert.equal(toluScraper.matchesSitePolicy(devJob), true, 'Tolu matches developer job');
  assert.equal(toluScraper.matchesSitePolicy(supportJob), false, 'Tolu strictly rejects customer support job');

  // Sister should match customer support job and REJECT developer job
  assert.equal(sisterScraper.matchesSitePolicy(supportJob), true, 'Sister matches support job');
  assert.equal(sisterScraper.matchesSitePolicy(devJob), false, 'Sister strictly rejects developer job');
});

test('Indeed Scraper: parseIndeedMarkdown accurately extracts jobs from Bright Data markdown', () => {
  const sampleMarkdown = `
# Indeed Job Search Results

[Web Developer, eCRM](/rc/clk?jk=4345b550ac2013c5&bb=xyz)

Humane World for Animals

Remote

$80,000 - $115,000 a year

Full-time

The general salary range for this full-time position is $80,000 - 115,000.

View all [Humane World for Animals jobs in Remote](/q-humane-world-for-animals-l-remote-jobs.html)

[Senior Frontend Engineer](/rc/clk?jk=84933d6560992ee9&bb=abc)

Easily apply

Seed

Remote in New York, NY

$160,000 - $180,000 a year

Full-time

You partner early with Design and Product to build stellar UX.

Salary Search: [Senior Frontend Engineer salaries in New York, NY](/career/senior-engineer/salaries)
  `;

  const jobs = parseIndeedMarkdown(sampleMarkdown, 'https://www.indeed.com');
  assert.equal(jobs.length, 2);

  const j1 = jobs[0];
  assert.equal(j1.title, 'Web Developer, eCRM');
  assert.equal(j1.sourceJobId, '4345b550ac2013c5');
  assert.equal(j1.company, 'Humane World for Animals');
  assert.equal(j1.location, 'Remote');
  assert.equal(j1.salary, '$80,000 - $115,000 a year');
  assert.equal(j1.jobType, 'Full-time');
  assert.equal(j1.is_remote, true);
  assert.equal(j1.hasIndeedApply, false);
  assert.ok(j1.applicationUrl.includes('4345b550ac2013c5'));

  const j2 = jobs[1];
  assert.equal(j2.title, 'Senior Frontend Engineer');
  assert.equal(j2.sourceJobId, '84933d6560992ee9');
  assert.equal(j2.company, 'Seed');
  assert.equal(j2.location, 'Remote in New York, NY');
  assert.equal(j2.salary, '$160,000 - $180,000 a year');
  assert.equal(j2.jobType, 'Full-time');
  assert.equal(j2.is_remote, true);
  assert.equal(j2.hasIndeedApply, true);
  assert.ok(j2.applicationUrl.includes('84933d6560992ee9'));
});

test('Indeed Scraper: rotateSearchUrls rotates array gracefully', () => {
  const urls = ['url1', 'url2', 'url3', 'url4'];
  const rotated = rotateSearchUrls(urls, 15);
  assert.equal(rotated.length, 4);
  assert.deepEqual(new Set(rotated), new Set(urls));

  // Empty or single element
  assert.deepEqual(rotateSearchUrls([]), []);
  assert.deepEqual(rotateSearchUrls(['one']), ['one']);
});
