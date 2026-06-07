import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobHash } from '../src/jobHash.js';
import { BaseScraper } from '../src/scrapers/baseScraper.js';
import { parseJobDetail as parseBruntWorkJobDetail, parseListingLinks as parseBruntWorkListingLinks } from '../src/scrapers/bruntwork.js';
import { filterInfluxJobsByPolicy, parseInfluxJobDetail, parseInfluxJobLinks } from '../src/scrapers/influx.js';
import { filterJobbermanJobsByPolicy, parseJobbermanJobDetail, parseJobbermanListingLinks, resolveJobbermanBoardUrls } from '../src/scrapers/jobberman.js';
import { orderedEnabledSites } from '../src/scrapers/index.js';
import { RemoteJobsOrgScraper } from '../src/scrapers/remotejobsorg.js';
import { RemoteOkScraper } from '../src/scrapers/remoteok.js';
import { GreenhouseScraper } from '../src/scrapers/greenhouse.js';
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
  assert.equal(links[0].applicationUrl, 'https://bruntworkcareers.co/jobs/123');

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
  assert.equal(detail.postedAt, 'Jun 01 2026');
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
    <a href="/listings/customer-success-associate-9kkdd5">Customer Success Associate</a>
    <a href="https://www.jobberman.com/listings/customer-success-associate-9kkdd5">Duplicate</a>
  `, 'https://www.jobberman.com/jobs/customer-service-support/remote');

  assert.equal(links.length, 1);
  assert.equal(links[0].jobUrl, 'https://www.jobberman.com/listings/customer-success-associate-9kkdd5');

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
});

test('jobberman policy keeps recent remote jobs only', () => {
  const jobs = [
    { title: 'Recent Remote', location: 'Remote (NG)', postedAt: new Date().toISOString(), raw: { jobLocationType: 'TELECOMMUTE' } },
    { title: 'Old Remote', location: 'Remote (NG)', postedAt: '2026-01-01T00:00:00.000Z', raw: { jobLocationType: 'TELECOMMUTE' } },
    { title: 'Recent Onsite', location: 'Lagos', postedAt: new Date().toISOString(), raw: { jobLocationType: '' } }
  ];

  assert.deepEqual(
    filterJobbermanJobsByPolicy(jobs, { remoteOnly: true, maxAgeDays: 30 }).map((job) => job.title),
    ['Recent Remote']
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
    { supported: false, adapter: 'lever', reason: 'adapter-not-audited' }
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
    { supported: false, adapter: 'lever', reason: 'adapter-not-audited', kind: 'ats', audited: false }
  );
  assert.deepEqual(
    pickResolverFields(classifyApplyDestination('https://jobs.smartrecruiters.com/acme/123')),
    { supported: false, adapter: 'smartrecruiters', reason: 'adapter-not-audited', kind: 'ats', audited: false }
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
