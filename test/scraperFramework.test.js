import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createJobHash } from '../src/jobHash.js';
import { BaseScraper } from '../src/scrapers/baseScraper.js';
import { BruntWorkScraper, fetchBruntWorkJobDetail, linksSinceLastSeen as bruntWorkLinksSinceLastSeen, parseJobDetail as parseBruntWorkJobDetail, parseListingLinks as parseBruntWorkListingLinks, resolveBruntWorkDetailScanLimit, sortBruntWorkLinksNewestFirst } from '../src/scrapers/bruntwork.js';
import { filterInfluxJobsByPolicy, parseInfluxJobDetail, parseInfluxJobLinks } from '../src/scrapers/influx.js';
import { JobbermanScraper, filterJobbermanJobsByPolicy, jobsSinceLastSeen as jobbermanJobsSinceLastSeen, parseJobbermanJobDetail, parseJobbermanListingLinks, resolveJobbermanBoardUrls, resolveJobbermanDetailScanLimit, sortJobbermanJobsNewestFirst } from '../src/scrapers/jobberman.js';
import { isCoolingDown, orderedEnabledSites, updateRunState } from '../src/scrapers/index.js';
import { RemoteJobsOrgScraper } from '../src/scrapers/remotejobsorg.js';
import { RemoteOkScraper } from '../src/scrapers/remoteok.js';
import { GreenhouseScraper } from '../src/scrapers/greenhouse.js';
import { WeWorkRemotelyScraper, parseListingLinks as parseWeWorkRemotelyLinks, parseJobDetail as parseWeWorkRemotelyJobDetail } from '../src/scrapers/weworkremotely.js';
import { JobicyScraper } from '../src/scrapers/jobicy.js';
import { TheMuseScraper } from '../src/scrapers/themuse.js';
import { ArbeitnowScraper } from '../src/scrapers/arbeitnow.js';
import { RealWorkFromAnywhereScraper } from '../src/scrapers/realworkfromanywhere.js';
import { WorkingNomadsScraper } from '../src/scrapers/workingnomads.js';
import { classifyApplyUrl, detectDownstreamAdapter } from '../src/adapters/remoteok.js';
import {
  classifyApplyUrl as classifyApplyDestination,
  detectApplyPlatform,
  shouldAllowGatewayHandoff
} from '../src/adapters/atsResolver.js';

class FakeScraper extends BaseScraper {
  constructor(siteConfig = {}) {
    super('fake', { maxJobsPerRun: 10 }, siteConfig);
  }

  async fetchJobs() {
    return [
      { title: 'SEO Specialist', company: 'Acme', applicationUrl: 'https://example.com/jobs/1?utm_source=test' },
      { title: 'SEO Specialist', company: 'Acme', applicationUrl: 'https://example.com/jobs/1?utm_source=other' },
      { title: '', applicationUrl: 'https://example.com/jobs/2' }
    ];
  }
}

test('base scraper normalizes, hashes, filters, and dedupes jobs', async () => {
  const jobs = await new FakeScraper().scrape();

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].source_site, 'fake');
  assert.equal(jobs[0].jobHash.length, 64);
  assert.equal(jobs[0].applicationUrl, 'https://example.com/jobs/1');
});

test('registry orders enabled sites by config priority', () => {
  const sites = orderedEnabledSites({
    sites: {
      bruntwork: { enabled: true, priority: 20 },
      influx: { enabled: true, priority: 15 },
      remoteok: { enabled: true, priority: 10 },
      remotive: { enabled: false, priority: 1 }
    }
  });

  assert.deepEqual(sites, ['remoteok', 'influx', 'bruntwork']);
});

test('registry includes wellfound scrape-only source', () => {
  const sites = orderedEnabledSites({
    sites: {
      remotejobsorg: { enabled: true, priority: 20 },
      wellfound: { enabled: true, priority: 10, autoApplyEnabled: false }
    }
  });

  assert.deepEqual(sites, ['wellfound', 'remotejobsorg']);
});

test('job hash prioritizes real URLs over company/title fallbacks', () => {
  const left = createJobHash({
    source: 'remoteok',
    title: 'SEO Specialist',
    company: 'Acme',
    applicationUrl: 'https://remoteok.com/job/1'
  });
  const right = createJobHash({
    source: 'remotive',
    title: 'SEO Specialist',
    company: 'Acme',
    applicationUrl: 'https://remotive.com/job/2'
  });
  const sameUrlWithTracking = createJobHash({
    source: 'remoteok',
    title: 'SEO Specialist',
    company: 'Acme',
    applicationUrl: 'https://remoteok.com/job/1?utm_source=newsletter'
  });

  assert.notEqual(left, right);
  assert.equal(left, sameUrlWithTracking);
});

test('influx parser discovers links and apply form URL', () => {
  const listingHtml = `
    <a href="/careers/jobs/6-customer-support-agent">Customer Support Agent</a>
    <a href="/careers/jobs/6-customer-support-agent">Customer Support Agent</a>
  `;
  const links = parseInfluxJobLinks(listingHtml, 'https://influx.com/careers/jobs');
  assert.equal(links.length, 1);
  assert.equal(links[0].jobUrl, 'https://influx.com/careers/jobs/6-customer-support-agent');

  const detail = parseInfluxJobDetail(`
    <div class="text_block section">
      <div class="container"><h2>Customer Support Agent</h2></div>
      <div class="container">
        <h3>Brazil</h3>
        <p><strong>Duties</strong></p>
        <ul><li>Answer customer questions</li></ul>
        <p><strong>Requirements</strong></p>
        <ul><li>Excellent written and verbal English communication skills</li></ul>
        <p><strong>Benefits</strong></p>
        <p>Remote work</p>
        <a target="_blank" class="button button--primary" href="https://influx.com/forms/fFFFPq?thread=csa-br-careers">Apply Here</a>
      </div>
    </div>
  `, links[0].jobUrl, links[0]);

  assert.equal(detail.title, 'Customer Support Agent');
  assert.equal(detail.company, 'Influx');
  assert.equal(detail.location, 'Brazil');
  assert.equal(detail.applicationUrl, 'https://influx.typeform.com/to/fFFFPq?thread=csa-br-careers');
  assert.match(detail.requirements, /English communication skills/);
  assert.match(detail.responsibilities, /Answer customer questions/);
});

test('bruntwork parser discovers listing links and detail fields from static HTML', () => {
  const links = parseBruntWorkListingLinks(`
    <a href="/jobs/123">SEO Specialist Part Time</a>
    <a href="/jobs/123">Duplicate</a>
  `, 'https://bruntworkcareers.co/search');

  assert.equal(links.length, 1);
  assert.equal(links[0].applicationUrl, 'https://bruntworkcareers.co/jobs/123/apply');

  const detail = parseBruntWorkJobDetail(`
    <p class="hidden lg:block text-4xl font-medium mb-6">SEO Specialist</p>
    <div class="text-gray-600 job-description">
      <p>Client Overview:<br>Growing agency.</p>
      <p>Job Description:<br>Improve rankings and content.</p>
      <p>Core Responsibilities:<br></p>
      <ul><li>Run SEO audits</li><li>Update WordPress pages</li></ul>
      <p>Requirements<br></p>
      <ul><li>Technical SEO</li><li>WordPress</li></ul>
    </div></div><div class="rounded-2xl">
    <div class="w-1/4"><p>Job Type</p><p>Part Time</p><p>Work Schedule and Timezone</p><p>Monday</p><p>Published on</p><p>Jun 01 2026</p></div></div>
  `, links[0]);

  assert.equal(detail.title, 'SEO Specialist');
  assert.match(detail.description, /Improve rankings/);
  assert.match(detail.requirements, /Technical SEO/);
  assert.match(detail.responsibilities, /Run SEO audits/);
  assert.equal(detail.jobType, 'Part Time');
  assert.equal(detail.location, 'Remote');
  assert.equal(detail.postedAt, 'Jun 01 2026');
});

test('bruntwork parser accepts absolute, single-quoted, query, and apply links', () => {
  const links = parseBruntWorkListingLinks(`
    <a href='https://bruntworkcareers.co/jobs/900/apply?source=search'>Newest role</a>
    <a href="/jobs/901?utm_source=board">Another role</a>
    <a href="/jobs/900">Duplicate form</a>
  `, 'https://bruntworkcareers.co/search');

  assert.deepEqual(links.map((link) => link.applicationUrl), [
    'https://bruntworkcareers.co/jobs/900/apply',
    'https://bruntworkcareers.co/jobs/901/apply'
  ]);
});

test('bruntwork scans beyond the final profile limit to avoid stale dedupe windows', () => {
  assert.equal(resolveBruntWorkDetailScanLimit({}, 10), 30);
  assert.equal(resolveBruntWorkDetailScanLimit({ detailScanLimit: 50 }, 10), 50);
  assert.equal(resolveBruntWorkDetailScanLimit({ detailScanLimit: 5 }, 10), 10);
});

test('site cooldown is measured from scrape start, not completion', () => {
  const now = Date.now();
  const state = {
    sites: {
      bruntwork: {
        lastStartedAt: new Date(now - 4 * 60 * 1000).toISOString(),
        lastRunAt: new Date(now - 30 * 1000).toISOString()
      }
    }
  };

  assert.equal(isCoolingDown('bruntwork', { cooldownMinutes: 3 }, state), false);
});

test('site cooldown tolerates small scheduler jitter', () => {
  const state = {
    sites: {
      jobberman: {
        lastStartedAt: new Date(Date.now() - (3 * 60 * 1000 - 5000)).toISOString()
      }
    }
  };

  assert.equal(isCoolingDown('jobberman', { cooldownMinutes: 3 }, state), false);
});

test('site run state persists separate start and completion timestamps', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-site-state-'));
  const siteRunStatePath = path.join(dir, 'siteRunState.json');
  const startedAt = new Date(Date.now() - 5000).toISOString();
  const state = { sites: {} };

  await updateRunState({ siteRunStatePath }, state, 'bruntwork', {
    status: 'ok',
    jobCount: 2,
    startedAt
  });

  const stored = JSON.parse(await fs.readFile(siteRunStatePath, 'utf8'));
  assert.equal(stored.sites.bruntwork.lastStartedAt, startedAt);
  assert.equal(stored.sites.bruntwork.lastStatus, 'ok');
  assert.equal(stored.sites.bruntwork.lastJobCount, 2);
  assert.ok(new Date(stored.sites.bruntwork.lastRunAt).getTime() >= new Date(startedAt).getTime());
});

test('bruntwork listing links preserve page order (newest first)', () => {
  const links = [
    { applicationUrl: 'https://bruntworkcareers.co/jobs/100' },
    { applicationUrl: 'https://bruntworkcareers.co/jobs/300' },
    { applicationUrl: 'https://bruntworkcareers.co/jobs/200' }
  ];

  assert.deepEqual(
    sortBruntWorkLinksNewestFirst(links).map((link) => link.applicationUrl),
    [
      'https://bruntworkcareers.co/jobs/100',
      'https://bruntworkcareers.co/jobs/300',
      'https://bruntworkcareers.co/jobs/200'
    ]
  );
});

test('bruntwork cursor keeps only listings newer than the previous top listing', () => {
  const links = [
    { applicationUrl: 'https://bruntworkcareers.co/jobs/new-3' },
    { applicationUrl: 'https://bruntworkcareers.co/jobs/new-2' },
    { applicationUrl: 'https://bruntworkcareers.co/jobs/previous-top' },
    { applicationUrl: 'https://bruntworkcareers.co/jobs/old-1' }
  ];

  assert.deepEqual(
    bruntWorkLinksSinceLastSeen(links, 'https://bruntworkcareers.co/jobs/previous-top').map((link) => link.applicationUrl),
    [
      'https://bruntworkcareers.co/jobs/new-3',
      'https://bruntworkcareers.co/jobs/new-2'
    ]
  );
});

test('bruntwork direct detail fetch hydrates real title and description for targeted URLs', async () => {
  const html = `
    <p class="hidden lg:block text-4xl font-medium mb-6">Senior Website Developer</p>
    <div class="text-gray-600 job-description">
      <p>Job Overview:<br>Build and maintain client websites.</p>
      <p>Core Responsibilities:<br></p>
      <ul><li>Develop WordPress and Shopify pages</li></ul>
      <p>Requirements<br></p>
      <ul><li>JavaScript</li><li>SEO knowledge</li></ul>
    </div></div><div class="rounded-2xl">
    <div class="w-1/4"><p>Job Type</p><p>Full Time</p><p>Work Schedule and Timezone</p><p>Monday</p><p>Published on</p><p>Jun 30 2026</p></div></div>
  `;

  class FakeBruntWorkScraper extends BruntWorkScraper {
    async fetchText(url) {
      assert.equal(url, 'https://apply.bruntworkcareers.co/jobs/57784373920');
      return html;
    }
  }

  const originalFetch = BruntWorkScraper.prototype.fetchText;
  BruntWorkScraper.prototype.fetchText = FakeBruntWorkScraper.prototype.fetchText;
  try {
    const job = await fetchBruntWorkJobDetail(
      { maxJobsPerRun: 1 },
      'https://apply.bruntworkcareers.co/jobs/57784373920'
    );
    assert.equal(job.title, 'Senior Website Developer');
    assert.match(job.description, /Build and maintain client websites/);
    assert.match(job.requirements, /JavaScript/);
    assert.equal(job.source_site, 'bruntwork');
  } finally {
    BruntWorkScraper.prototype.fetchText = originalFetch;
  }
});

test('influx policy prefers Nigeria and falls back to non-bilingual roles', () => {
  const policy = {
    preferredLocations: ['Nigeria'],
    allowOtherLocationsWhenNoPreferred: true,
    excludedTitleKeywords: ['bilingual', 'spanish']
  };
  const jobs = [
    { title: 'Customer Support Agent', location: 'Nigeria' },
    { title: 'Customer Support Agent', location: 'Brazil' },
    { title: 'Bilingual Spanish Customer Support Agent', location: 'Nigeria' }
  ];

  assert.deepEqual(filterInfluxJobsByPolicy(jobs, policy), [jobs[0]]);
  assert.deepEqual(filterInfluxJobsByPolicy(jobs.slice(1), policy), [jobs[1]]);
});

test('jobberman parser discovers listing links and JSON-LD job detail', () => {
  const links = parseJobbermanListingLinks(`
    <link rel="prerender" href="https://www.jobberman.com/listings/customer-success-associate-9kkdd5?utm_source=jobs">
    <a href="/listings/customer-success-associate-9kkdd5">Customer Success Associate</a>
    <a href="https://www.jobberman.com/listings/customer-success-associate-9kkdd5">Duplicate</a>
  `, 'https://www.jobberman.com/jobs/customer-service-support/remote');

  assert.equal(links.length, 1);
  assert.equal(links[0].jobUrl, 'https://www.jobberman.com/listings/customer-success-associate-9kkdd5');
  assert.equal(links[0].remoteBoard, true);

  const detail = parseJobbermanJobDetail(`
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "JobPosting",
            "@id": "https://www.jobberman.com/#/schema/JobPosting/listing-1230092",
            "title": "Customer Success Associate",
            "description": "<p><b>Responsibilities:</b></p><ul><li>Help customers</li></ul><p><b>Requirements:</b></p><ul><li>Empathy</li></ul>",
            "datePosted": "2026-05-26T00:00:00.000000Z",
            "directApply": true,
            "employmentType": "FULL_TIME",
            "jobLocationType": "TELECOMMUTE",
            "applicantLocationRequirements": { "@type": "Country", "name": "NG" },
            "baseSalary": {
              "@type": "MonetaryAmount",
              "currency": "NGN",
              "value": { "@type": "QuantitativeValue", "minValue": 250000, "maxValue": 400000, "unitText": "MONTH" }
            },
            "hiringOrganization": { "@id": "agency-1" }
          },
          { "@type": "Organization", "@id": "agency-1", "name": "Gradely.NG" }
        ]
      }
    </script>
  `, links[0].jobUrl, links[0]);

  assert.equal(detail.title, 'Customer Success Associate');
  assert.equal(detail.company, 'Gradely.NG');
  assert.equal(detail.location, 'Remote (NG)');
  assert.equal(detail.salary, 'NGN 250000-400000 MONTH');
  assert.match(detail.responsibilities, /Help customers/);
  assert.equal(detail.raw.remoteBoard, true);
  assert.equal(detail.raw.jobLocationType, 'TELECOMMUTE');
});

test('jobberman policy keeps recent remote jobs only', () => {
  const jobs = [
    { title: 'Recent Remote', location: 'Remote (NG)', postedAt: new Date().toISOString(), raw: { jobLocationType: 'TELECOMMUTE' } },
    { title: 'Recent Remote Board', location: 'Nigeria, NG', postedAt: new Date().toISOString(), raw: { remoteBoard: true } },
    { title: 'Old Remote', location: 'Remote (NG)', postedAt: '2026-01-01T00:00:00.000Z', raw: { jobLocationType: 'TELECOMMUTE' } },
    { title: 'Recent Onsite', location: 'Lagos', postedAt: new Date().toISOString(), raw: { jobLocationType: '' } }
  ];

  assert.deepEqual(
    filterJobbermanJobsByPolicy(jobs, { remoteOnly: true, maxAgeDays: 30 }).map((job) => job.title),
    ['Recent Remote', 'Recent Remote Board']
  );
});

test('jobberman jobs are sorted newest first after detail parsing', () => {
  const jobs = [
    { title: 'Older', postedAt: '2026-06-01T00:00:00.000Z' },
    { title: 'Newest', postedAt: '2026-07-01T00:00:00.000Z' },
    { title: 'Unknown', postedAt: '' }
  ];

  assert.deepEqual(sortJobbermanJobsNewestFirst(jobs).map((job) => job.title), ['Newest', 'Older', 'Unknown']);
});

test('jobberman cursor keeps only jobs newer than the previous top listing', () => {
  const jobs = [
    { title: 'Newer', applicationUrl: 'https://www.jobberman.com/listings/newer' },
    { title: 'Previous top', applicationUrl: 'https://www.jobberman.com/listings/previous-top' },
    { title: 'Older', applicationUrl: 'https://www.jobberman.com/listings/older' }
  ];

  assert.deepEqual(
    jobbermanJobsSinceLastSeen(jobs, 'https://www.jobberman.com/listings/previous-top').map((job) => job.title),
    ['Newer']
  );
});

test('jobberman can rescan the recent window when the cursor is stale', () => {
  const jobs = [
    { title: 'Newer', applicationUrl: 'https://www.jobberman.com/listings/newer' },
    { title: 'Previous top', applicationUrl: 'https://www.jobberman.com/listings/previous-top' }
  ];

  assert.deepEqual(
    jobbermanJobsSinceLastSeen(jobs, 'https://www.jobberman.com/listings/newer', { rescanRecent: true }),
    jobs
  );
});

test('jobberman scans a recent window before applying the final profile limit', async () => {
  class FakeJobbermanScraper extends JobbermanScraper {
    async fetchText(url) {
      if (/\/jobs\/software-data\/remote$/.test(url)) {
        return `
          <a href="/listings/old-developer-111aaa">Old Developer</a>
          <a href="/listings/new-developer-222bbb">New Developer</a>
        `;
      }

      const isNew = /new-developer/.test(url);
      return `
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            "@id": "https://www.jobberman.com/#/schema/JobPosting/listing-${isNew ? '222' : '111'}",
            "title": "${isNew ? 'New Developer' : 'Old Developer'}",
            "description": "<p>Build websites</p>",
            "datePosted": "${isNew ? '2026-07-02T00:00:00.000000Z' : '2026-06-01T00:00:00.000000Z'}",
            "jobLocationType": "TELECOMMUTE",
            "applicantLocationRequirements": { "@type": "Country", "name": "NG" }
          }
        </script>
      `;
    }
  }

  const scraper = new FakeJobbermanScraper(
    { maxJobsPerRun: 10 },
    {
      categories: ['software-data'],
      maxJobsPerRun: 1,
      detailScanLimit: 2,
      remoteOnly: true
    }
  );

  const jobs = await scraper.scrape();
  assert.equal(resolveJobbermanDetailScanLimit({ maxJobsPerRun: 1 }, 1), 25);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'New Developer');
});

test('jobberman policy can exclude noisy titles without scanning full page text', () => {
  const jobs = [
    {
      title: 'JavaScript Developer',
      location: 'Remote (NG)',
      postedAt: new Date().toISOString(),
      description: 'Similar jobs include Senior Devops Engineer.',
      raw: { jobLocationType: 'TELECOMMUTE' }
    },
    {
      title: 'Senior Devops Engineer',
      location: 'Remote (NG)',
      postedAt: new Date().toISOString(),
      raw: { jobLocationType: 'TELECOMMUTE' }
    }
  ];

  assert.deepEqual(
    filterJobbermanJobsByPolicy(jobs, { remoteOnly: true, excludeTitleKeywords: ['senior', 'devops'] }).map((job) => job.title),
    ['JavaScript Developer']
  );
});

test('jobberman policy enforces configured required title keywords', () => {
  const jobs = [
    { title: 'JavaScript Developer', location: 'Remote (NG)', postedAt: new Date().toISOString(), raw: { jobLocationType: 'TELECOMMUTE' } },
    { title: 'Forex Trading Assistant', location: 'Remote (NG)', postedAt: new Date().toISOString(), raw: { jobLocationType: 'TELECOMMUTE' } }
  ];

  assert.deepEqual(
    filterJobbermanJobsByPolicy(jobs, { remoteOnly: true, requireTitleKeywords: ['developer'] }).map((job) => job.title),
    ['JavaScript Developer']
  );
});

test('jobberman board URLs default to the single customer-service board', () => {
  assert.deepEqual(resolveJobbermanBoardUrls({}), [
    'https://www.jobberman.com/jobs/customer-service-support/remote'
  ]);
  assert.deepEqual(resolveJobbermanBoardUrls({ jobsUrl: 'https://www.jobberman.com/jobs/admin-office/remote' }), [
    'https://www.jobberman.com/jobs/admin-office/remote'
  ]);
});

test('jobberman categories expand into per-board remote URLs and de-duplicate', () => {
  assert.deepEqual(
    resolveJobbermanBoardUrls({ categories: ['admin-office', 'customer-service-support', 'admin-office'] }),
    [
      'https://www.jobberman.com/jobs/admin-office/remote',
      'https://www.jobberman.com/jobs/customer-service-support/remote'
    ]
  );

  // CSV string, remoteOnly: false, and pass-through of absolute paths/URLs.
  assert.deepEqual(
    resolveJobbermanBoardUrls({ categories: 'software-data, /jobs/it-software', remoteOnly: false }),
    ['https://www.jobberman.com/jobs/software-data', 'https://www.jobberman.com/jobs/it-software']
  );

  // Explicit jobsUrls win over categories.
  assert.deepEqual(
    resolveJobbermanBoardUrls({ jobsUrls: ['https://www.jobberman.com/jobs/accounting-finance/remote'], categories: ['admin-office'] }),
    ['https://www.jobberman.com/jobs/accounting-finance/remote']
  );
});

test('remotejobsorg scraper normalizes API fields and filters old jobs', async () => {
  class FakeRemoteJobsOrgScraper extends RemoteJobsOrgScraper {
    async fetchJobs() {
      return [
        {
          id: 'recent-1',
          title: 'Customer Support Agent',
          url: 'https://remotejobs.org/remote-jobs/customer-support-agent-acme',
          apply_url: 'https://remotejobs.org/remote-jobs/customer-support-agent-acme',
          company: { name: 'Acme' },
          category: { name: 'Customer Support', slug: 'customer-support' },
          location: 'Remote',
          type: 'Full-time',
          description: 'Support customers through email and chat.',
          posted_at: new Date().toISOString()
        },
        {
          id: 'old-1',
          title: 'Old Customer Support Agent',
          url: 'https://remotejobs.org/remote-jobs/old-customer-support-agent-acme',
          company: { name: 'Acme' },
          category: { name: 'Customer Support', slug: 'customer-support' },
          location: 'Remote',
          description: 'Support customers.',
          posted_at: '2026-01-01T00:00:00+00:00'
        }
      ];
    }
  }

  const jobs = await new FakeRemoteJobsOrgScraper({ maxJobsPerRun: 10 }, { maxAgeDays: 14 }).scrape();

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].source_site, 'remotejobsorg');
  assert.equal(jobs[0].title, 'Customer Support Agent');
  assert.equal(jobs[0].company, 'Acme');
  assert.equal(jobs[0].applicationUrl, 'https://remotejobs.org/remote-jobs/customer-support-agent-acme');
  assert.match(jobs[0].postedAt, /\d{4}-\d{2}-\d{2}/);
});

test('remoteok policy keeps recent developer titles and rejects noisy non-dev jobs', async () => {
  class FakeRemoteOkScraper extends RemoteOkScraper {
    async fetchJobs() {
      return [
        {
          id: 'dev-1',
          position: 'Junior Frontend Developer',
          company: 'Acme',
          url: 'https://remoteok.com/remote-jobs/junior-frontend-developer-acme',
          description: 'Build React interfaces.',
          tags: ['react', 'javascript'],
          date: new Date().toISOString()
        },
        {
          id: 'admin-1',
          position: 'Asistente Virtual de Recursos Humanos Contratacion Inmediata',
          company: 'Noisy',
          url: 'https://remoteok.com/remote-jobs/asistente-virtual',
          description: 'Administrativo.',
          tags: [],
          date: new Date().toISOString()
        },
        {
          id: 'old-1',
          position: 'Backend Developer',
          company: 'OldCo',
          url: 'https://remoteok.com/remote-jobs/backend-developer-oldco',
          description: 'Build APIs.',
          tags: ['backend'],
          date: '2026-01-01T00:00:00+00:00'
        }
      ];
    }
  }

  const jobs = await new FakeRemoteOkScraper({ maxJobsPerRun: 10 }, {
    maxAgeDays: 14,
    requireTitleKeywords: ['developer', 'frontend', 'backend'],
    includeKeywords: ['javascript', 'developer', 'frontend', 'backend', 'react'],
    englishOnly: true
  }).scrape();

  assert.deepEqual(jobs.map((job) => job.title), ['Junior Frontend Developer']);
});

test('greenhouse scraper normalizes board API jobs and filters profile keywords', async () => {
  class FakeGreenhouseScraper extends GreenhouseScraper {
    async fetchJobs() {
      return [
        {
          id: 101,
          title: 'Customer Support Specialist',
          absolute_url: 'https://boards.greenhouse.io/acme/jobs/101',
          location: { name: 'Remote' },
          offices: [{ name: 'Remote' }],
          departments: [{ name: 'Customer Experience' }],
          content: '<p>Support customers through email, chat, Zendesk, and CRM updates.</p>',
          updated_at: new Date().toISOString(),
          _greenhouseBoard: { token: 'acme', company: 'Acme' }
        },
        {
          id: 102,
          title: 'Senior Backend Engineer',
          absolute_url: 'https://boards.greenhouse.io/acme/jobs/102',
          location: { name: 'Remote' },
          content: '<p>Build distributed systems.</p>',
          updated_at: new Date().toISOString(),
          _greenhouseBoard: { token: 'acme', company: 'Acme' }
        }
      ];
    }
  }

  const jobs = await new FakeGreenhouseScraper({ maxJobsPerRun: 10 }, {
    maxJobsPerRun: 10,
    remoteOnly: true,
    includeTitleKeywords: ['customer', 'support', 'assistant', 'admin'],
    includeKeywords: ['zendesk', 'crm', 'support'],
    excludeKeywords: ['engineer', 'developer']
  }).scrape();

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].source_site, 'greenhouse');
  assert.equal(jobs[0].title, 'Customer Support Specialist');
  assert.equal(jobs[0].company, 'Acme');
  assert.equal(jobs[0].applicationUrl, 'https://boards.greenhouse.io/acme/jobs/101');
  assert.match(jobs[0].description, /Zendesk/);
});

test('weworkremotely parser discovers listing links and apply handoff', () => {
  const links = parseWeWorkRemotelyLinks(`
    <rss><channel><item>
      <title>Acme: Customer Support Specialist</title>
      <link>https://weworkremotely.com/remote-jobs/acme-customer-support-specialist</link>
      <region>Anywhere</region>
      <type>Full-Time</type>
      <category>Customer Support</category>
      <description><![CDATA[<p>Remote support role.</p>]]></description>
      <pubDate>Tue, 09 Jun 2026 00:00:00 +0000</pubDate>
    </item></channel></rss>
  `, 'https://weworkremotely.com/remote-jobs.rss');

  assert.equal(links.length, 1);
  assert.equal(links[0].jobUrl, 'https://weworkremotely.com/remote-jobs/acme-customer-support-specialist');

  const detail = parseWeWorkRemotelyJobDetail(`
    <html>
      <head>
        <title>Customer Support Specialist | We Work Remotely</title>
        <meta name="description" content="Remote support role. Responsibilities: Help customers. Requirements: Zendesk and empathy.">
      </head>
      <body>
        <time datetime="2026-06-09T00:00:00Z"></time>
        <div>Location</div><div>Anywhere</div>
        <a href="https://boards.greenhouse.io/acme/jobs/123">Apply for this job</a>
      </body>
    </html>
  `, links[0]);

  assert.equal(detail.title, 'Customer Support Specialist');
  assert.equal(detail.location, 'Anywhere');
  assert.equal(detail.applicationUrl, 'https://boards.greenhouse.io/acme/jobs/123');
  assert.match(detail.requirements, /Requirements/i);
});

test('jobicy scraper keeps recent remote support roles and rejects old ones', async () => {
  class FakeJobicyScraper extends JobicyScraper {
    async fetchJobs() {
      return [
        {
          id: 1,
          jobTitle: 'Customer Support Specialist',
          companyName: 'Acme',
          jobGeo: 'Anywhere',
          jobDescription: '<p>Remote support via Zendesk.</p>',
          jobIndustry: ['Support'],
          url: 'https://jobicy.com/jobs/1',
          pubDate: new Date().toISOString()
        },
        {
          id: 2,
          jobTitle: 'Old Support Specialist',
          companyName: 'Acme',
          jobGeo: 'Anywhere',
          jobDescription: '<p>Remote support.</p>',
          jobIndustry: ['Support'],
          url: 'https://jobicy.com/jobs/2',
          pubDate: '2026-01-01T00:00:00Z'
        }
      ];
    }
  }

  const jobs = await new FakeJobicyScraper({ maxJobsPerRun: 10 }, { maxAgeDays: 14, remoteOnly: true }).scrape();
  assert.deepEqual(jobs.map((job) => job.title), ['Customer Support Specialist']);
});

test('themuse scraper normalizes remote results and respects title filters', async () => {
  class FakeTheMuseScraper extends TheMuseScraper {
    async fetchJobs() {
      return [
        {
          id: 1,
          name: 'Remote Customer Service Representative',
          company: { name: 'Liberty Mutual' },
          locations: [{ name: 'Remote' }],
          categories: [{ name: 'Customer Service' }],
          levels: [{ name: 'Entry Level' }],
          refs: { landing_page: 'https://boards.greenhouse.io/acme/jobs/321' },
          contents: '<p>Support customers using CRM and email.</p>',
          publication_date: new Date().toISOString()
        },
        {
          id: 2,
          name: 'Senior Backend Engineer',
          company: { name: 'Acme' },
          locations: [{ name: 'Remote' }],
          categories: [{ name: 'Engineering' }],
          refs: { landing_page: 'https://jobs.lever.co/acme/222' },
          contents: '<p>Build APIs.</p>',
          publication_date: new Date().toISOString()
        }
      ];
    }
  }

  const jobs = await new FakeTheMuseScraper({ maxJobsPerRun: 10 }, {
    maxAgeDays: 14,
    remoteOnly: true,
    includeTitleKeywords: ['customer', 'support', 'service']
  }).scrape();

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].applicationUrl, 'https://boards.greenhouse.io/acme/jobs/321');
});

test('arbeitnow scraper respects remote-only policy', async () => {
  class FakeArbeitnowScraper extends ArbeitnowScraper {
    async fetchJobs() {
      return [
        {
          slug: 'support-1',
          company_name: 'Acme',
          title: 'Customer Support Associate',
          description: '<p>Work from home support role.</p>',
          remote: true,
          url: 'https://www.arbeitnow.com/jobs/support-1',
          tags: ['Support'],
          job_types: ['Full Time'],
          location: 'Remote',
          created_at: new Date().toISOString()
        },
        {
          slug: 'onsite-1',
          company_name: 'Acme',
          title: 'Office Manager',
          description: '<p>Onsite Berlin role.</p>',
          remote: false,
          url: 'https://www.arbeitnow.com/jobs/onsite-1',
          tags: ['Operations'],
          job_types: ['Full Time'],
          location: 'Berlin',
          created_at: new Date().toISOString()
        }
      ];
    }
  }

  const jobs = await new FakeArbeitnowScraper({ maxJobsPerRun: 10 }, { maxAgeDays: 14, remoteOnly: true }).scrape();
  assert.deepEqual(jobs.map((job) => job.title), ['Customer Support Associate']);
});

test('realworkfromanywhere scraper parses rss items and keeps apply url when no handoff exists', async () => {
  class FakeRealWorkFromAnywhereScraper extends RealWorkFromAnywhereScraper {
    async fetchJobs() {
      return [
        {
          title: 'Customer Support Agent at Acme',
          link: 'https://www.realworkfromanywhere.com/remote-support-acme',
          guid: 'acme-1',
          description: '<p>Fully remote support role. Responsibilities: help customers. Requirements: empathy.</p>',
          pubDate: new Date().toISOString(),
          category: ['Support']
        }
      ];
    }
  }

  const jobs = await new FakeRealWorkFromAnywhereScraper({ maxJobsPerRun: 10 }, { maxAgeDays: 14, remoteOnly: true }).scrape();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'Acme');
  assert.equal(jobs[0].applicationUrl, 'https://www.realworkfromanywhere.com/remote-support-acme');
});

test('workingnomads scraper filters old and non-remote-looking jobs', async () => {
  class FakeWorkingNomadsScraper extends WorkingNomadsScraper {
    async fetchJobs() {
      return [
        {
          id: 1,
          title: 'Customer Success Manager',
          company: 'Acme',
          location: 'Remote worldwide',
          description: '<p>Support customers.</p>',
          category_name: 'Customer Success',
          url: 'https://www.workingnomads.com/jobs/customer-success-manager-acme',
          pub_date: new Date().toISOString()
        },
        {
          id: 2,
          title: 'Office Coordinator',
          company: 'Acme',
          location: 'Berlin',
          description: '<p>In-office role.</p>',
          category_name: 'Administration',
          url: 'https://www.workingnomads.com/jobs/office-coordinator-acme',
          pub_date: new Date().toISOString()
        },
        {
          id: 3,
          title: 'Old Customer Success Manager',
          company: 'Acme',
          location: 'Remote worldwide',
          description: '<p>Support customers.</p>',
          category_name: 'Customer Success',
          url: 'https://www.workingnomads.com/jobs/old-customer-success-manager-acme',
          pub_date: '2026-01-01T00:00:00Z'
        }
      ];
    }
  }

  const jobs = await new FakeWorkingNomadsScraper({ maxJobsPerRun: 10 }, { maxAgeDays: 14, remoteOnly: true }).scrape();
  assert.deepEqual(jobs.map((job) => job.title), ['Customer Success Manager']);
});

test('remoteok resolver only allows audited downstream adapters', () => {
  assert.equal(
    detectDownstreamAdapter('https://boards.greenhouse.io/acme/jobs/123'),
    'greenhouse'
  );
  assert.deepEqual(
    classifyApplyUrl('https://boards.greenhouse.io/acme/jobs/123'),
    { supported: true, adapter: 'greenhouse', reason: 'supported-audited-adapter' }
  );
  assert.deepEqual(
    classifyApplyUrl('https://jobs.lever.co/acme/123'),
    { supported: true, adapter: 'lever', reason: 'supported-audited-adapter' }
  );
  assert.deepEqual(
    classifyApplyUrl('mailto:jobs@example.com'),
    { supported: false, adapter: 'email', reason: 'email-only' }
  );
});

test('shared ATS resolver separates audited adapters from manual-review platforms', () => {
  assert.deepEqual(
    pickResolverFields(classifyApplyDestination('https://boards.greenhouse.io/acme/jobs/123')),
    { supported: true, adapter: 'greenhouse', reason: 'supported-audited-adapter', kind: 'ats', audited: true }
  );
  assert.deepEqual(
    pickResolverFields(classifyApplyDestination('https://jobs.lever.co/acme/123')),
    { supported: true, adapter: 'lever', reason: 'supported-audited-adapter', kind: 'ats', audited: true }
  );
  assert.deepEqual(
    pickResolverFields(classifyApplyDestination('https://jobs.smartrecruiters.com/acme/123')),
    { supported: false, adapter: 'smartrecruiters', reason: 'adapter-not-audited', kind: 'ats', audited: false }
  );
  assert.deepEqual(
    pickResolverFields(classifyApplyDestination('https://apply.workable.com/acme/j/123')),
    { supported: true, adapter: 'workable', reason: 'supported-audited-adapter', kind: 'ats', audited: true }
  );
  assert.deepEqual(
    pickResolverFields(classifyApplyDestination('https://jobs.ashbyhq.com/acme/123/application')),
    { supported: true, adapter: 'ashby', reason: 'supported-audited-adapter', kind: 'ats', audited: true }
  );
  assert.equal(detectApplyPlatform('https://apply.workable.com/acme/j/123')?.adapter, 'workable');
  assert.equal(shouldAllowGatewayHandoff(classifyApplyDestination('https://boards.greenhouse.io/acme/jobs/123'), { testMode: true }), true);
  assert.equal(shouldAllowGatewayHandoff(classifyApplyDestination('https://boards.greenhouse.io/acme/jobs/123'), { testMode: false }), false);
  assert.equal(shouldAllowGatewayHandoff(classifyApplyDestination('https://boards.greenhouse.io/acme/jobs/123'), { allowGatewayAutoSubmit: true }), true);
});

test('remoteok resolver blocks live downstream handoff without test guard', async () => {
  const { remoteOkAdapter } = await import('../src/adapters/remoteok.js');
  const page = {
    url: () => 'https://remoteok.com/remote-jobs/remote-developer-acme-123',
    goto: async () => {
      throw new Error('goto should not be called for live handoff');
    }
  };
  const result = await remoteOkAdapter.advance(page, 'DETAILS', {
    config: { testMode: false, noRealSubmission: false },
    job: { raw: { apply_url: 'https://boards.greenhouse.io/acme/jobs/123' } }
  });

  assert.equal(result.advanced, false);
  assert.match(result.reason, /live gateway handoff is disabled/i);
  assert.equal(result.meta.downstreamAdapter, 'greenhouse');
});

test('remotejobsorg blocks live email-gate handoff unless explicitly enabled', async () => {
  const { remoteJobsOrgAdapter } = await import('../src/adapters/remotejobsorg.js');
  const page = {
    url: () => 'https://remotejobs.org/remote-jobs/customer-support-agent-acme'
  };

  const result = await remoteJobsOrgAdapter.advance(page, 'EMAIL', {
    config: { testMode: false, noRealSubmission: false },
    job: { applicationUrl: 'https://remotejobs.org/remote-jobs/customer-support-agent-acme' }
  });

  assert.equal(result.advanced, false);
  assert.match(result.reason, /live gateway handoff is disabled/i);
});

function pickResolverFields(result) {
  return {
    supported: result.supported,
    adapter: result.adapter,
    reason: result.reason,
    kind: result.kind,
    audited: result.audited
  };
}

test('getAutoApplyGate enables gateway sources only when ALLOW_GATEWAY_AUTO_SUBMIT is on', async () => {
  const { getAutoApplyGate } = await import('../src/pipeline.js');
  const baseConfig = (allow) => ({
    autoApply: true,
    allowGatewayAutoSubmit: allow,
    sites: { remoteok: { autoApplyEnabled: true }, remotejobsorg: { autoApplyEnabled: true } }
  });

  for (const source of ['remoteok', 'remotejobsorg']) {
    const enabled = getAutoApplyGate(baseConfig(true), { source_site: source });
    assert.equal(enabled.enabled, true, `${source} should be enabled when flag on`);

    const blocked = getAutoApplyGate(baseConfig(false), { source_site: source });
    assert.equal(blocked.enabled, false, `${source} should be blocked when flag off`);
    assert.match(blocked.reason, /ALLOW_GATEWAY_AUTO_SUBMIT/);
  }
});

test('getAutoApplyGate still respects per-site disable for gateway sources', async () => {
  const { getAutoApplyGate } = await import('../src/pipeline.js');
  const gate = getAutoApplyGate(
    { autoApply: true, allowGatewayAutoSubmit: true, sites: { remoteok: { autoApplyEnabled: false } } },
    { source_site: 'remoteok' }
  );
  assert.equal(gate.enabled, false);
  assert.match(gate.reason, /config\/sites\.json/);
});

test('remoteok adapter records gateway destination telemetry even when handoff is blocked', async () => {
  const { remoteOkAdapter } = await import('../src/adapters/remoteok.js');
  const eventsDir = path.join(os.tmpdir(), `gw-telemetry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const page = {
    url: () => 'https://remoteok.com/remote-jobs/remote-developer-acme-123',
    goto: async () => { throw new Error('goto should not be called when handoff is disabled'); }
  };

  const result = await remoteOkAdapter.advance(page, 'DETAILS', {
    config: { testMode: false, noRealSubmission: false, eventsDir, profileName: 'tester' },
    job: { source_site: 'remoteok', raw: { apply_url: 'https://boards.greenhouse.io/acme/jobs/123' } }
  });

  // Behaviour unchanged: blocked because the gateway flag is off.
  assert.equal(result.advanced, false);
  assert.match(result.reason, /live gateway handoff is disabled/i);

  // Telemetry still recorded the resolved destination.
  const raw = await fs.readFile(path.join(eventsDir, 'events.jsonl'), 'utf8');
  const rec = JSON.parse(raw.trim().split('\n').at(-1));
  assert.equal(rec.type, 'gateway.destination_resolved');
  assert.equal(rec.data.downstreamAdapter, 'greenhouse');
  assert.equal(rec.data.supported, true);
  assert.equal(rec.data.audited, true);
  assert.equal(rec.data.gatewaySource, 'remoteok');
});
