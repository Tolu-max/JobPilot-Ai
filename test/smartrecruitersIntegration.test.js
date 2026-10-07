import test from 'node:test';
import assert from 'node:assert/strict';
import { SmartRecruitersScraper } from '../src/scrapers/smartrecruiters.js';
import { smartRecruitersAdapter } from '../src/adapters/smartrecruiters.js';
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

test('SmartRecruiters integration: fetch, normalize, match, review, and test-apply flow', async () => {
  // 1. Mock SmartRecruiters API responses
  const mockListingPayload = {
    offset: 0,
    limit: 10,
    totalFound: 2,
    content: [
      {
        id: 'sr-dev-101',
        name: 'Frontend Developer (React / JavaScript)',
        uuid: 'd101-uuid-webdev',
        releasedDate: new Date().toISOString(),
        company: { identifier: 'techcorp', name: 'TechCorp Global' },
        location: {
          city: 'Remote',
          region: 'Remote',
          country: 'us',
          remote: true,
          fullLocation: 'Worldwide (Remote)'
        },
        department: { label: 'Engineering' },
        typeOfEmployment: { label: 'Full-Time' },
        ref: 'https://api.smartrecruiters.com/v1/companies/techcorp/postings/sr-dev-101'
      },
      {
        id: 'sr-supp-202',
        name: 'Customer Support Specialist (Live Chat & Email)',
        uuid: 's202-uuid-support',
        releasedDate: new Date().toISOString(),
        company: { identifier: 'techcorp', name: 'TechCorp Global' },
        location: {
          city: 'Remote',
          region: 'Remote',
          country: 'us',
          remote: true,
          fullLocation: 'Worldwide (Remote)'
        },
        department: { label: 'Customer Operations' },
        typeOfEmployment: { label: 'Full-Time' },
        ref: 'https://api.smartrecruiters.com/v1/companies/techcorp/postings/sr-supp-202'
      }
    ]
  };

  const mockDevDetail = {
    id: 'sr-dev-101',
    name: 'Frontend Developer (React / JavaScript)',
    applyUrl: 'https://jobs.smartrecruiters.com/techcorp/sr-dev-101-frontend-developer?oga=true',
    postingUrl: 'https://jobs.smartrecruiters.com/techcorp/sr-dev-101-frontend-developer',
    jobAd: {
      sections: {
        jobDescription: {
          text: '<p>We are looking for an experienced Frontend Developer proficient in JavaScript, HTML, CSS, React, and responsive web development.</p>'
        },
        qualifications: {
          text: '<p>WordPress, Shopify, SEO, JavaScript, frontend tooling.</p>'
        }
      }
    }
  };

  const mockSupportDetail = {
    id: 'sr-supp-202',
    name: 'Customer Support Specialist (Live Chat & Email)',
    applyUrl: 'https://jobs.smartrecruiters.com/techcorp/sr-supp-202-customer-support-specialist?oga=true',
    postingUrl: 'https://jobs.smartrecruiters.com/techcorp/sr-supp-202-customer-support-specialist',
    jobAd: {
      sections: {
        jobDescription: {
          text: '<p>We are seeking a Customer Support Specialist for handling live chat, email ticketing, customer queries, and CRM data management.</p>'
        },
        qualifications: {
          text: '<p>2+ years in customer service or support roles, excellent written communication, empathy, and administrative skills.</p>'
        }
      }
    }
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.endsWith('/postings?limit=100') || urlStr.includes('/postings?limit=')) {
      return {
        ok: true,
        json: async () => mockListingPayload
      };
    }
    if (urlStr.includes('sr-dev-101')) {
      return {
        ok: true,
        json: async () => mockDevDetail
      };
    }
    if (urlStr.includes('sr-supp-202')) {
      return {
        ok: true,
        json: async () => mockSupportDetail
      };
    }
    return { ok: false, status: 404 };
  };

  try {
    // 2. Fetch & Normalize jobs via SmartRecruitersScraper
    const scraper = new SmartRecruitersScraper({}, { boards: ['techcorp'], maxJobsPerRun: 10 });
    const scrapedJobs = await scraper.scrape();
    assert.equal(scrapedJobs.length, 2);

    const devJob = scrapedJobs.find((j) => j.sourceJobId === 'sr-dev-101');
    const supportJob = scrapedJobs.find((j) => j.sourceJobId === 'sr-supp-202');
    assert.ok(devJob);
    assert.ok(supportJob);

    assert.equal(devJob.source, 'smartrecruiters');
    assert.equal(devJob.company, 'TechCorp Global');
    assert.equal(devJob.applicationUrl, 'https://jobs.smartrecruiters.com/techcorp/sr-dev-101-frontend-developer?oga=true');
    assert.match(devJob.description, /Frontend Developer proficient in JavaScript/);

    assert.equal(supportJob.source, 'smartrecruiters');
    assert.equal(supportJob.company, 'TechCorp Global');
    assert.equal(supportJob.applicationUrl, 'https://jobs.smartrecruiters.com/techcorp/sr-supp-202-customer-support-specialist?oga=true');
    assert.match(supportJob.description, /Customer Support Specialist for handling live chat/);

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
      score: 91,
      matched_skills: ['JavaScript', 'HTML', 'CSS', 'Web Development'],
      missing_skills: [],
      reasons: ['Excellent fit for frontend engineering and web development stack.']
    });
    const parsedReview = parseAiScoringResponse(mockAiResponse);
    assert.equal(parsedReview.score, 91);
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
        innerText: async () => 'First Name Last Name Email Phone Resume Submit Application'
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
    const step = await smartRecruitersAdapter.getCurrentStep(mockPage);
    assert.equal(step, FormStep.DETAILS);

    // Verify form filling
    await smartRecruitersAdapter.fillStep(mockPage, step, ctx);
    assert.equal(uploadedFile, '/tmp/test-tolu-resume.pdf');

    // Verify advance stops before submit in testMode
    const advanceResult = await smartRecruitersAdapter.advance(mockPage, step, ctx);
    assert.equal(advanceResult.step, FormStep.REVIEW);
    assert.equal(advanceResult.advanced, false);
    assert.match(advanceResult.reason, /TEST_MODE/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
