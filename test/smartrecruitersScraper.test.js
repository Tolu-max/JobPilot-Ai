import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SmartRecruitersScraper,
  resolveBoards,
  normalizeBoardToken
} from '../src/scrapers/smartrecruiters.js';
import { scraperRegistry } from '../src/scrapers/index.js';

test('smartrecruiters scraper is registered in scraperRegistry and marked implemented', () => {
  assert.ok(scraperRegistry.smartrecruiters);
  assert.equal(scraperRegistry.smartrecruiters.implemented, true);
  assert.equal(typeof scraperRegistry.smartrecruiters.scrape, 'function');
});

test('normalizeBoardToken normalizes URLs and raw company identifiers', () => {
  assert.equal(normalizeBoardToken('Wise'), 'Wise');
  assert.equal(normalizeBoardToken('https://jobs.smartrecruiters.com/SmartRecruiters'), 'SmartRecruiters');
  assert.equal(normalizeBoardToken('https://careers.smartrecruiters.com/DeliveryHero/jobs'), 'DeliveryHero');
  assert.equal(normalizeBoardToken('  BoschGroup  '), 'BoschGroup');
});

test('resolveBoards parses strings, arrays, and objects', () => {
  const defaultBoards = resolveBoards({});
  assert.ok(defaultBoards.length >= 4);
  assert.ok(defaultBoards.some((b) => b.token === 'SmartRecruiters'));

  const stringBoards = resolveBoards({ boards: 'Wise, DeliveryHero' });
  assert.equal(stringBoards.length, 2);
  assert.equal(stringBoards[0].token, 'Wise');
  assert.equal(stringBoards[1].token, 'DeliveryHero');

  const objectBoards = resolveBoards({
    boards: [{ token: 'custom-co', name: 'Custom Co' }]
  });
  assert.equal(objectBoards.length, 1);
  assert.equal(objectBoards[0].token, 'custom-co');
  assert.equal(objectBoards[0].name, 'Custom Co');
});

test('SmartRecruitersScraper normalizes job correctly', () => {
  const scraper = new SmartRecruitersScraper({}, {});
  const raw = {
    id: '744000148454651',
    name: 'Senior Frontend Engineer',
    uuid: 'f4a3d5b9-5fa9-48af-ba55-30669c9c3e81',
    company: { identifier: 'smartrecruiters', name: 'SmartRecruiters Inc' },
    releasedDate: '2026-09-09T09:43:26.403Z',
    location: {
      city: 'Berlin',
      region: 'Remote',
      country: 'de',
      remote: true,
      fullLocation: 'Berlin, Remote, Germany'
    },
    department: { label: 'Engineering' },
    function: { label: 'Information Technology' },
    industry: { label: 'Computer Software' },
    typeOfEmployment: { label: 'Full-time' },
    postingUrl: 'https://jobs.smartrecruiters.com/smartrecruiters/744000148454651-senior-frontend-engineer',
    applyUrl: 'https://jobs.smartrecruiters.com/smartrecruiters/744000148454651-senior-frontend-engineer?oga=true',
    _descriptionHtml: '<p>We are seeking a Senior Frontend Engineer proficient in JavaScript, React, and CSS.</p>',
    _qualificationsHtml: '<p>5+ years experience building web applications with modern frontend frameworks.</p>'
  };

  const normalized = scraper.normalizeJob(raw);
  assert.equal(normalized.source, 'smartrecruiters');
  assert.equal(normalized.source_site, 'smartrecruiters');
  assert.equal(normalized.sourceJobId, '744000148454651');
  assert.equal(normalized.title, 'Senior Frontend Engineer');
  assert.equal(normalized.company, 'SmartRecruiters Inc');
  assert.equal(normalized.is_remote, true);
  assert.equal(normalized.applicationUrl, 'https://jobs.smartrecruiters.com/smartrecruiters/744000148454651-senior-frontend-engineer?oga=true');
  assert.match(normalized.description, /Senior Frontend Engineer proficient in JavaScript/);
  assert.match(normalized.requirements, /5\+ years experience/);
  assert.ok(normalized.jobHash);
});
