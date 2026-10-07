import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkableScraper } from '../src/scrapers/workable.js';
import { workableAdapter } from '../src/adapters/workable.js';
import { localMatchJob, parseAiScoringResponse } from '../src/localMatcher.js';
import { FormStep } from '../src/adapters/types.js';

const toluProfile = {
  profileName: 'tolu',
  name: 'Toluwalope Samuel Oyelola',
  skills: ['SEO', 'Technical SEO', 'Shopify', 'WordPress', 'Web Development', 'JavaScript', 'HTML', 'CSS', 'Node.js'],
  preferredRoles: ['Web Developer', 'Frontend Developer', 'WordPress Specialist', 'Shopify Developer'],
  secondaryRoles: ['Website Administrator']
};

const sisterProfile = {
  profileName: 'sister',
  name: 'Sister Candidate',
  skills: ['Customer Support', 'Email Support', 'Live Chat Support', 'Virtual Assistance', 'CRM', 'Data Entry', 'Administrative Support', 'Calendar Management'],
  preferredRoles: ['Customer Support Specialist', 'Virtual Assistant', 'Administrative Assistant'],
  secondaryRoles: ['Operations Assistant', 'Data Entry Clerk']
};

test('Workable integration: fetch, normalize, match, review, and test-apply flow', async () => {
  // 1. Mock Workable widget API response
  const mockWorkablePayload = {
    name: 'Acme SaaS Corp',
    description: '<p>About Acme SaaS Corp</p>',
    jobs: [
      {
        title: 'Frontend Developer (React / JavaScript)',
        shortcode: 'WK-DEV-01',
        code: 'DEV-01',
        employment_type: 'Full-time',
        telecommuting: true,
        department: 'Engineering',
        function: 'Engineering',
        industry: 'Computer Software',
        country: 'Worldwide',
        city: 'Remote',
        url: 'https://apply.workable.com/j/WK-DEV-01',
        application_url: 'https://apply.workable.com/j/WK-DEV-01/apply',
        published_on: new Date().toISOString(),
        created_at: new Date().toISOString(),
        description: '<p>We are seeking a Frontend Developer proficient in JavaScript, HTML, CSS, React, and responsive web development.</p><strong>Requirements</strong><p>WordPress, Shopify, SEO, JavaScript, frontend tooling.</p>'
      },
      {
        title: 'Customer Support Specialist',
        shortcode: 'WK-SUPP-02',
        code: 'SUPP-02',
        employment_type: 'Full-time',
        telecommuting: true,
        department: 'Support & Operations',
        function: 'Customer Service',
        industry: 'Computer Software',
        country: 'Worldwide',
        city: 'Remote',
        url: 'https://apply.workable.com/j/WK-SUPP-02',
        application_url: 'https://apply.workable.com/j/WK-SUPP-02/apply',
        published_on: new Date().toISOString(),
        created_at: new Date().toISOString(),
        description: '<p>We are looking for a Customer Support Specialist for live chat support, email ticketing, customer queries, and CRM data entry.</p><strong>Requirements</strong><p>Customer service experience, live chat, administrative skills, empathy.</p>'
      }
    ]
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/api/v1/widget/accounts/')) {
      return {
        ok: true,
        json: async () => mockWorkablePayload
      };
    }
    return { ok: false, status: 404 };
  };

  try {
    // 2. Fetch & Normalize jobs via WorkableScraper
    const scraper = new WorkableScraper({}, { boards: ['acme-saas'], maxJobsPerRun: 10 });
    const scrapedJobs = await scraper.scrape();
    assert.equal(scrapedJobs.length, 2);

    const devJob = scrapedJobs.find((j) => j.sourceJobId === 'WK-DEV-01');
    const supportJob = scrapedJobs.find((j) => j.sourceJobId === 'WK-SUPP-02');
    assert.ok(devJob);
    assert.ok(supportJob);

    assert.equal(devJob.source, 'workable');
    assert.equal(devJob.company, 'Acme SaaS Corp');
    assert.equal(devJob.applicationUrl, 'https://apply.workable.com/j/WK-DEV-01/apply');
    assert.match(devJob.description, /Frontend Developer proficient in JavaScript/);

    assert.equal(supportJob.source, 'workable');
    assert.equal(supportJob.company, 'Acme SaaS Corp');
    assert.equal(supportJob.applicationUrl, 'https://apply.workable.com/j/WK-SUPP-02/apply');
    assert.match(supportJob.description, /Customer Support Specialist for live chat/);

    // 3. Local Matcher: Tolu matches devJob, rejects supportJob
    const toluDevMatch = await localMatchJob(devJob, toluProfile);
    assert.equal(toluDevMatch.score >= 70, true, `Tolu dev score should be >= 70, got ${toluDevMatch.score}`);
    assert.notEqual(toluDevMatch.recommendation, 'ignore');

    const toluSupportMatch = await localMatchJob(supportJob, toluProfile);
    assert.equal(toluSupportMatch.recommendation, 'ignore', 'Tolu should ignore non-technical customer support');

    // 4. Local Matcher: Sister matches supportJob, rejects devJob
    const sisterSupportMatch = await localMatchJob(supportJob, sisterProfile);
    assert.equal(sisterSupportMatch.score >= 70, true, `Sister support score should be >= 70, got ${sisterSupportMatch.score}`);
    assert.notEqual(sisterSupportMatch.recommendation, 'ignore');

    const sisterDevMatch = await localMatchJob(devJob, sisterProfile);
    assert.equal(sisterDevMatch.recommendation, 'ignore', 'Sister should ignore engineering roles');

    // 5. AI Review scoring parser verification
    const mockAiResponse = JSON.stringify({
      score: 90,
      matched_skills: ['JavaScript', 'HTML', 'CSS', 'Web Development'],
      missing_skills: [],
      reasons: ['Strong alignment with candidate frontend experience.']
    });
    const parsedReview = parseAiScoringResponse(mockAiResponse);
    assert.equal(parsedReview.score, 90);
    assert.deepEqual(parsedReview.matched_skills, ['JavaScript', 'HTML', 'CSS', 'Web Development']);

    // 6. Test-apply flow: fill form & advance with testMode guard
    const filledInputs = {};
    let uploadedFile = null;

    function locatorProxy(selector) {
      const self = {
        first: () => self,
        nth: () => self,
        isVisible: async () => true,
        isDisabled: async () => false,
        count: async () => 1,
        waitFor: async () => {},
        inputValue: async () => '',
        scrollIntoViewIfNeeded: async () => {},
        click: async () => {},
        setInputFiles: async (file) => { uploadedFile = file; },
        evaluate: async () => {
          if (selector === 'body') return { ok: true, reason: 'ok', missing: [] };
          return '';
        },
        fill: async (val) => { filledInputs[selector] = val; },
        all: async () => [],
        innerText: async () => 'First name Last name Email Phone Resume Summary Submit Application'
      };
      return self;
    }

    const mockPage = {
      url: () => 'https://apply.workable.com/j/WK-DEV-01/apply/',
      locator: (selector) => locatorProxy(selector),
      getByRole: () => locatorProxy('button'),
      waitForTimeout: async () => {},
      waitForLoadState: async () => {},
      goto: async () => {}
    };

    const ctx = {
      candidate: {
        name: toluProfile.name,
        email: 'tolu@example.com',
        phone: '+2348012345678',
        bio: 'Experienced web developer specializing in JavaScript and responsive UIs.'
      },
      config: {
        applicantEmail: 'tolu@example.com',
        testMode: true
      },
      resumePath: '/tmp/test-tolu-resume.pdf'
    };

    // Verify adapter step detection
    const step = await workableAdapter.getCurrentStep(mockPage);
    assert.equal(step, FormStep.DETAILS);

    // Verify form filling
    await workableAdapter.fillStep(mockPage, step, ctx);
    assert.equal(uploadedFile, '/tmp/test-tolu-resume.pdf');

    // Verify advance stops before submit in testMode
    const advanceResult = await workableAdapter.advance(mockPage, step, ctx);
    assert.equal(advanceResult.step, FormStep.REVIEW);
    assert.equal(advanceResult.advanced, false);
    assert.match(advanceResult.reason, /TEST_MODE/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
