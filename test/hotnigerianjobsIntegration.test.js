import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotNigerianJobsScraper } from '../src/scrapers/hotnigerianjobs.js';
import { localMatchJob } from '../src/localMatcher.js';
import { loadCvData } from '../src/cvParser.js';
import { hotnigerianjobsAdapter } from '../src/adapters/hotnigerianjobs.js';
import { FormStep } from '../src/adapters/types.js';

test('HotNigerianJobs Integration: fetch, normalize, match, review, and application advance', async () => {
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

  const scraper = new HotNigerianJobsScraper({ profilesDir: 'profiles' });

  const devJobRaw = {
    id: '959901',
    title: 'Full Stack Web Developer at PayStack Partners Limited',
    company: 'PayStack Partners Limited',
    location: 'Lagos, Nigeria (Remote)',
    salary: 'N500,000 - N700,000 / month',
    description: 'We are hiring a Full Stack Web Developer proficient in PHP 8, Laravel queues, MySQL, REST APIs, and React frontend interfaces. You will build and maintain client web portals.',
    requirements: '3+ years experience with PHP, Laravel, JavaScript, React, MySQL database architecture, and responsive web design.',
    link: 'https://www.hotnigerianjobs.com/hotjobs/959901/full-stack-web-developer.html',
    decodedEmail: 'careers@paystackpartners.ng',
    applySubject: 'Full Stack Web Developer - Toluwalope',
    applyMethod: 'email',
    pubDate: 'Tue, 15 Sep 2026 14:00:00 +0100'
  };

  const supportJobRaw = {
    id: '959902',
    title: 'Customer Service & Support Officer at FinEdge Global',
    company: 'FinEdge Global',
    location: 'Abuja, Nigeria (Remote)',
    salary: 'N250,000 - N350,000 / month',
    description: 'Provide exceptional customer care, live chat assistance, email support, ticket resolution, and CRM administration to international banking users.',
    requirements: '2+ years customer support experience, excellent written English, Zendesk ticketing, dispute resolution, and virtual assistant operations.',
    link: 'https://www.hotnigerianjobs.com/hotjobs/959902/customer-service-support.html',
    decodedEmail: 'talent@finedgeglobal.com',
    applySubject: 'Customer Service Officer - Temiloluwa',
    applyMethod: 'email',
    pubDate: 'Tue, 15 Sep 2026 15:00:00 +0100'
  };

  const devJob = scraper.normalizeJob(devJobRaw);
  const supportJob = scraper.normalizeJob(supportJobRaw);

  assert.equal(devJob.source, 'hotnigerianjobs');
  assert.equal(supportJob.source, 'hotnigerianjobs');

  // Candidate Isolation Check
  const toluDevMatch = await localMatchJob(devJob, toluProfile, toluConfig);
  const toluSupportMatch = await localMatchJob(supportJob, toluProfile, toluConfig);
  const sisterSupportMatch = await localMatchJob(supportJob, sisterProfile, sisterConfig);
  const sisterDevMatch = await localMatchJob(devJob, sisterProfile, sisterConfig);

  // Assert Tolu matches Web Dev and strictly excludes Customer Support
  assert.ok(toluDevMatch.score >= 70, `Tolu matches Web Dev job with score ${toluDevMatch.score}`);
  assert.equal(toluSupportMatch.recommendation, 'ignore', `Tolu strictly rejects customer support job`);

  // Assert Sister matches Customer Support and strictly excludes Developer job
  assert.ok(sisterSupportMatch.score >= 70, `Sister matches Support job with score ${sisterSupportMatch.score}`);
  assert.equal(sisterDevMatch.recommendation, 'ignore', `Sister strictly rejects web developer job`);

  // Test Adapter Advance in Test Mode for Tolu's Web Dev Job
  const fakePage = {
    url: () => devJob.applicationUrl,
    content: async () => '<html><body>Sample</body></html>',
    locator: () => ({ innerText: async () => 'How to apply' })
  };

  const toluCtx = {
    config: { testMode: true },
    candidate: { name: 'Toluwalope Samuel Oyelola', email: 'toluoyelola066@gmail.com' },
    job: devJob
  };

  const devAdvance = await hotnigerianjobsAdapter.advance(fakePage, FormStep.DETAILS, toluCtx);
  assert.equal(devAdvance.advanced, true);
  assert.equal(devAdvance.step, FormStep.REVIEW);
  assert.equal(devAdvance.meta.recipientEmail, 'careers@paystackpartners.ng');

  // Test Adapter Advance in Test Mode for Sister's Support Job
  const sisterCtx = {
    config: { testMode: true },
    candidate: { name: 'Temiloluwa Ruth Oyelola', email: 'temmy152000@gmail.com' },
    job: supportJob
  };

  const supportAdvance = await hotnigerianjobsAdapter.advance(fakePage, FormStep.DETAILS, sisterCtx);
  assert.equal(supportAdvance.advanced, true);
  assert.equal(supportAdvance.step, FormStep.REVIEW);
  assert.equal(supportAdvance.meta.recipientEmail, 'talent@finedgeglobal.com');
});
