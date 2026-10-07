import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DailyRemoteScraper,
  resolveDailyRemoteBoardUrls,
  parseDailyRemoteListingCards,
  parseDailyRemoteJobDetail,
  extractDailyRemoteJobId
} from '../src/scrapers/dailyremote.js';
import { scraperRegistry } from '../src/scrapers/index.js';

test('dailyremote scraper is registered in scraperRegistry and marked implemented', () => {
  assert.ok(scraperRegistry.dailyremote);
  assert.equal(scraperRegistry.dailyremote.implemented, true);
  assert.equal(typeof scraperRegistry.dailyremote.scrape, 'function');
});

test('resolveDailyRemoteBoardUrls handles defaults, categories, and explicit URLs', () => {
  const defaults = resolveDailyRemoteBoardUrls({});
  assert.ok(defaults.length >= 4);
  assert.ok(defaults.includes('https://dailyremote.com/remote-software-development-jobs'));
  assert.ok(defaults.includes('https://dailyremote.com/remote-customer-support-jobs'));

  const custom = resolveDailyRemoteBoardUrls({ categories: ['remote-virtual-assistant-jobs', 'remote-data-entry-jobs'] });
  assert.deepEqual(custom, [
    'https://dailyremote.com/remote-virtual-assistant-jobs',
    'https://dailyremote.com/remote-data-entry-jobs'
  ]);

  const explicit = resolveDailyRemoteBoardUrls({ jobsUrls: ['https://dailyremote.com/remote-jobs'] });
  assert.deepEqual(explicit, ['https://dailyremote.com/remote-jobs']);
});

test('extractDailyRemoteJobId extracts numeric ID correctly', () => {
  assert.equal(extractDailyRemoteJobId('/remote-job/ai-response-evaluator-5585640'), '5585640');
  assert.equal(extractDailyRemoteJobId('https://dailyremote.com/remote-job/frontend-developer-9912345'), '9912345');
  assert.equal(extractDailyRemoteJobId(''), '');
});

test('parseDailyRemoteListingCards parses visible cards and skips locked paywalled cards', () => {
  const sampleHtml = `
  <article class="lst-card js-card" data-id="1001">
    <div class="lst-card__main">
      <h2 class="lst-card__title">
        <a href="/remote-job/software-engineer-1001">Software Engineer</a>
      </h2>
      <div class="lst-card__byline">
        <span>Acme Corp</span> &middot; <span>Full Time</span>
      </div>
      <div class="lst-card__meta">
        <span class="lst-pill"><span>Worldwide</span></span>
        <span class="lst-pill"><span>$100K - $130K per year</span></span>
      </div>
      <p class="lst-card__summary">Build backend APIs and microservices.</p>
      <div class="lst-card__tags">
        <a class="lst-tag">node.js</a>
        <a class="lst-tag">typescript</a>
      </div>
    </div>
  </article>

  <article class="lst-card js-card" data-id="1002">
    <div class="lst-card__main">
      <h2 class="lst-card__title">
        <a href="/remote-job/locked-role-1002">Secret Role</a>
      </h2>
      <div class="lst-card__byline">
        <span class="lst-card__locked">Company hidden</span>
      </div>
    </div>
  </article>
  `;

  const cards = parseDailyRemoteListingCards(sampleHtml);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].sourceJobId, '1001');
  assert.equal(cards[0].title, 'Software Engineer');
  assert.equal(cards[0].company, 'Acme Corp');
  assert.equal(cards[0].location, 'Worldwide');
  assert.equal(cards[0].salary, '$100K - $130K per year');
  assert.equal(cards[0].summary, 'Build backend APIs and microservices.');
  assert.deepEqual(cards[0].tags, ['node.js', 'typescript']);
  assert.equal(cards[0].applyUrl, 'https://dailyremote.com/apply/1001');
  assert.equal(cards[0].jobUrl, 'https://dailyremote.com/remote-job/software-engineer-1001');
});

test('parseDailyRemoteJobDetail extracts JSON-LD Schema.org JobPosting correctly', () => {
  const detailHtml = `
  <html>
    <head>
      <script type="application/ld+json">
      {
        "@context": "http://schema.org",
        "@type": "JobPosting",
        "title": "Senior Frontend Developer",
        "hiringOrganization": {
          "@type": "Organization",
          "name": "CloudTech Inc."
        },
        "description": "<p>We are seeking an experienced React and TypeScript developer.</p>",
        "datePosted": "2026-09-12T10:00:00Z",
        "employmentType": "FULL_TIME",
        "identifier": {
          "value": "5581234-senior-frontend"
        }
      }
      </script>
    </head>
    <body><h1>Senior Frontend Developer</h1></body>
  </html>
  `;

  const fallback = {
    sourceJobId: '5581234',
    title: 'Fallback Title',
    company: 'Fallback Co',
    jobUrl: 'https://dailyremote.com/remote-job/senior-frontend-5581234',
    applyUrl: 'https://dailyremote.com/apply/5581234'
  };

  const parsed = parseDailyRemoteJobDetail(detailHtml, fallback);
  assert.equal(parsed.title, 'Senior Frontend Developer');
  assert.equal(parsed.company, 'CloudTech Inc.');
  assert.match(parsed.description, /experienced React and TypeScript developer/);
  assert.equal(parsed.jobType, 'FULL_TIME');
  assert.equal(parsed.postedAt, '2026-09-12T10:00:00.000Z');
  assert.equal(parsed.sourceJobId, '5581234-senior-frontend');
});

test('DailyRemoteScraper normalizes and hashes job correctly', () => {
  const scraper = new DailyRemoteScraper({}, {});
  const raw = {
    sourceJobId: '5581234',
    title: 'Customer Support Specialist',
    company: 'Supportly',
    location: 'Remote',
    jobType: 'Full-Time',
    description: 'Help customers via live chat and email ticket resolution.',
    summary: 'Help customers via live chat and email ticket resolution.',
    tags: ['Customer Support', 'Zendesk'],
    applicationUrl: 'https://dailyremote.com/apply/5581234',
    postedAt: '2026-09-14T08:00:00Z'
  };

  const normalized = scraper.normalizeJob(raw);
  assert.equal(normalized.source, 'dailyremote');
  assert.equal(normalized.source_site, 'dailyremote');
  assert.equal(normalized.sourceJobId, '5581234');
  assert.equal(normalized.title, 'Customer Support Specialist');
  assert.equal(normalized.company, 'Supportly');
  assert.equal(normalized.is_remote, true);
  assert.equal(normalized.applicationUrl, 'https://dailyremote.com/apply/5581234');
  assert.ok(normalized.jobHash);
});
