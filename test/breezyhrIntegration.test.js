import test from 'node:test';
import assert from 'node:assert/strict';
import { BreezyHrScraper } from '../src/scrapers/breezyhr.js';
import { breezyHrAdapter } from '../src/adapters/breezyhr.js';
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

test('Breezy HR integration: fetch, normalize, match, review, and test-apply flow', async () => {
  // 1. Mock Breezy HR API response for a company board
  const mockBreezyPayload = [
    {
      id: 'bzy-dev-01',
      friendly_id: 'bzy-dev-01-frontend-developer',
      name: 'Frontend Developer (React / JavaScript)',
      url: 'https://acmetech.breezy.hr/p/bzy-dev-01-frontend-developer',
      published_date: new Date().toISOString(),
      type: { id: 'full_time', name: 'Full-Time' },
      location: {
        name: 'Remote',
        is_remote: true,
        country: { name: 'Worldwide', id: 'WW' }
      },
      department: 'Engineering',
      salary: '$80,000 - $110,000',
      company: { name: 'Acme Tech', friendly_id: 'acmetech' }
    },
    {
      id: 'bzy-supp-02',
      friendly_id: 'bzy-supp-02-customer-support-specialist',
      name: 'Customer Support Specialist',
      url: 'https://acmetech.breezy.hr/p/bzy-supp-02-customer-support-specialist',
      published_date: new Date().toISOString(),
      type: { id: 'full_time', name: 'Full-Time' },
      location: {
        name: 'Remote',
        is_remote: true,
        country: { name: 'Worldwide', id: 'WW' }
      },
      department: 'Customer Operations',
      salary: '$40,000 - $55,000',
      company: { name: 'Acme Tech', friendly_id: 'acmetech' }
    }
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('breezy.hr/json')) {
      return {
        ok: true,
        json: async () => mockBreezyPayload
      };
    }
    if (urlStr.includes('bzy-dev-01')) {
      return {
        ok: true,
        text: async () => '<div class="description"><p>We are seeking a Frontend Developer skilled in JavaScript, HTML, CSS, React, and web development to build responsive client-facing applications.</p></div>'
      };
    }
    if (urlStr.includes('bzy-supp-02')) {
      return {
        ok: true,
        text: async () => '<div class="description"><p>We are seeking a Customer Support Specialist for live chat support, email ticketing, customer service, CRM management, and customer satisfaction.</p></div>'
      };
    }
    return { ok: false, status: 404 };
  };

  try {
    // 2. Fetch & Normalize jobs via BreezyHrScraper
    const scraper = new BreezyHrScraper({}, { boards: ['acmetech'], maxJobsPerRun: 10 });
    const scrapedJobs = await scraper.scrape();
    assert.equal(scrapedJobs.length, 2);

    const devJob = scrapedJobs.find((j) => j.sourceJobId === 'bzy-dev-01');
    const supportJob = scrapedJobs.find((j) => j.sourceJobId === 'bzy-supp-02');
    assert.ok(devJob);
    assert.ok(supportJob);

    assert.equal(devJob.source, 'breezyhr');
    assert.equal(devJob.company, 'Acme Tech');
    assert.equal(devJob.applicationUrl, 'https://acmetech.breezy.hr/p/bzy-dev-01-frontend-developer/apply');
    assert.match(devJob.description, /Frontend Developer skilled in JavaScript/);

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
      score: 88,
      matched_skills: ['JavaScript', 'Web Development'],
      missing_skills: [],
      reasons: ['Role matches candidate profile in web development and JavaScript.']
    });
    const parsedReview = parseAiScoringResponse(mockAiResponse);
    assert.equal(parsedReview.score, 88);
    assert.deepEqual(parsedReview.matched_skills, ['JavaScript', 'Web Development']);

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
        innerText: async () => 'Full Name Email Phone Resume Submit Application'
      };
      return self;
    }

    const mockPage = {
      url: () => devJob.applicationUrl,
      locator: (selector) => locatorProxy(selector),
      waitForTimeout: async () => {}
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
    const step = await breezyHrAdapter.getCurrentStep(mockPage);
    assert.equal(step, FormStep.DETAILS);

    // Verify form filling
    await breezyHrAdapter.fillStep(mockPage, step, ctx);
    assert.equal(uploadedFile, '/tmp/test-tolu-resume.pdf');

    // Verify advance stops before submit in testMode
    const advanceResult = await breezyHrAdapter.advance(mockPage, step, ctx);
    assert.equal(advanceResult.step, FormStep.REVIEW);
    assert.equal(advanceResult.advanced, false);
    assert.match(advanceResult.reason, /TEST_MODE/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
