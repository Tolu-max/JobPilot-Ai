import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IndeedScraper, normalizeIndeedJob } from '../src/scrapers/indeed.js';
import { localMatchJob } from '../src/localMatcher.js';
import { loadCvData } from '../src/cvParser.js';
import { indeedAdapter } from '../src/adapters/indeed.js';
import { FormStep } from '../src/adapters/types.js';

test('Indeed Integration: fetch, normalize, match, role isolation, and gateway handoff', async () => {
  const toluCv = await loadCvData('profiles/tolu/cv.txt');
  const sisterCv = await loadCvData('profiles/sister/cv.txt');

  const toluProfile = {
    profileName: 'tolu',
    name: 'Toluwalope Samuel Oyelola',
    skills: ['SEO', 'Technical SEO', 'Shopify', 'WordPress', 'Web Development', 'JavaScript', 'HTML', 'CSS', 'Node.js', 'PHP', 'Laravel'],
    preferredRoles: ['Web Developer', 'Frontend Developer', 'WordPress Specialist', 'Shopify Developer', 'Full Stack Developer'],
    secondaryRoles: ['Website Administrator']
  };

  const sisterProfile = {
    profileName: 'sister',
    name: 'Temiloluwa Ruth Oyelola',
    skills: ['Customer Support', 'Email Support', 'Live Chat Support', 'Virtual Assistance', 'CRM', 'Data Entry', 'Administrative Support', 'Calendar Management'],
    preferredRoles: ['Customer Support Specialist', 'Virtual Assistant', 'Administrative Assistant'],
    secondaryRoles: ['Operations Assistant', 'Data Entry Clerk']
  };

  const toluConfig = {
    profileName: 'tolu',
    candidate: toluCv,
    cvData: toluCv,
    preferences: {
      minScore: 70,
      titleKeywords: ['web developer', 'full stack', 'frontend', 'php', 'laravel', 'wordpress', 'react']
    }
  };

  const sisterConfig = {
    profileName: 'sister',
    candidate: sisterCv,
    cvData: sisterCv,
    preferences: {
      minScore: 70,
      titleKeywords: ['customer support', 'customer service', 'virtual assistant', 'operations', 'admin']
    }
  };

  const toluScraper = new IndeedScraper(toluConfig, {});
  const sisterScraper = new IndeedScraper(sisterConfig, {});

  // 1. Raw jobs representing Indeed search findings
  const devJobRaw = {
    jobkey: 'jk_dev_999',
    normTitle: 'Full Stack Web Developer',
    title: 'Full Stack Web Developer at FinTech Global',
    truncatedCompany: 'FinTech Global',
    formattedLocation: 'Remote',
    remoteLocation: true,
    snippet: 'We are seeking a Full Stack Web Developer proficient in PHP, Laravel, WordPress, and React frontend interfaces. Build RESTful APIs and modern web applications.',
    pubDate: Date.now() - 3600000,
    salarySnippet: { text: '$80,000 - $110,000 / year' },
    link: 'https://www.indeed.com/rc/clk?jk=jk_dev_999',
    indeedApplyEnabled: false,
    thirdPartyApplyUrl: 'https://boards.greenhouse.io/fintechglobal/jobs/999'
  };

  const supportJobRaw = {
    jobkey: 'jk_supp_888',
    normTitle: 'Customer Support Specialist',
    title: 'Customer Support Specialist at CareCloud',
    truncatedCompany: 'CareCloud Services',
    formattedLocation: 'Remote',
    remoteLocation: true,
    snippet: 'Provide high-quality email and chat support to customers using Zendesk and CRM tools. Manage customer queries, resolve issues, and document tickets.',
    pubDate: Date.now() - 7200000,
    salarySnippet: { text: '$45,000 - $60,000 / year' },
    link: 'https://www.indeed.com/rc/clk?jk=jk_supp_888',
    indeedApplyEnabled: true,
    thirdPartyApplyUrl: ''
  };

  // 2. Normalization
  const normalizedDev = normalizeIndeedJob(devJobRaw);
  const normalizedSupport = normalizeIndeedJob(supportJobRaw);

  assert.equal(normalizedDev.source, 'indeed');
  assert.equal(normalizedDev.is_remote, true);
  assert.equal(normalizedDev.thirdPartyApplyUrl, 'https://boards.greenhouse.io/fintechglobal/jobs/999');

  assert.equal(normalizedSupport.source, 'indeed');
  assert.equal(normalizedSupport.is_remote, true);
  assert.equal(normalizedSupport.hasIndeedApply, true);

  // 3. Scraper Policy & Role Isolation Gate
  assert.equal(toluScraper.matchesSitePolicy(normalizedDev), true, 'Tolu scraper accepts dev job');
  assert.equal(toluScraper.matchesSitePolicy(normalizedSupport), false, 'Tolu scraper rejects support job');

  assert.equal(sisterScraper.matchesSitePolicy(normalizedSupport), true, 'Sister scraper accepts support job');
  assert.equal(sisterScraper.matchesSitePolicy(normalizedDev), false, 'Sister scraper rejects dev job');

  // 4. Matcher evaluation
  const toluDevMatch = await localMatchJob(normalizedDev, toluProfile, toluConfig);
  assert.ok(toluDevMatch.score >= 70, `Tolu scores high on dev job (got ${toluDevMatch.score})`);

  const sisterSupportMatch = await localMatchJob(normalizedSupport, sisterProfile, sisterConfig);
  assert.ok(sisterSupportMatch.score >= 70, `Sister scores high on support job (got ${sisterSupportMatch.score})`);

  // 5. Gateway resolution & testMode handoff
  const fakePage = {
    url: () => normalizedDev.applicationUrl,
    evaluate: async () => ({ href: normalizedDev.thirdPartyApplyUrl, text: 'Apply on company site' })
  };

  const handoffResult = await indeedAdapter.advance(fakePage, FormStep.DETAILS, {
    config: { testMode: true },
    candidate: toluCv,
    job: normalizedDev
  });

  assert.equal(handoffResult.advanced, true);
  assert.equal(handoffResult.step, FormStep.REVIEW);
  assert.equal(handoffResult.meta.downstreamAdapter, 'greenhouse');
  assert.equal(handoffResult.meta.resolvedUrl, 'https://boards.greenhouse.io/fintechglobal/jobs/999');

  // 6. Easy Apply advance testMode
  const easyApplyResult = await indeedAdapter.advance(fakePage, FormStep.DETAILS, {
    config: { testMode: true },
    candidate: sisterCv,
    job: normalizedSupport
  });

  assert.equal(easyApplyResult.advanced, true);
  assert.equal(easyApplyResult.step, FormStep.REVIEW);
  assert.equal(easyApplyResult.meta.indeedApply, true);
});
