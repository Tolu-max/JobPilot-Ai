import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WorkableScraper,
  resolveBoards,
  normalizeBoardToken,
  extractRequirements
} from '../src/scrapers/workable.js';
import { scraperRegistry } from '../src/scrapers/index.js';

test('workable scraper is registered in scraperRegistry and marked implemented', () => {
  assert.ok(scraperRegistry.workable);
  assert.equal(scraperRegistry.workable.implemented, true);
  assert.equal(typeof scraperRegistry.workable.scrape, 'function');
});

test('normalizeBoardToken normalizes URLs and raw slug strings', () => {
  assert.equal(normalizeBoardToken('epignosis'), 'epignosis');
  assert.equal(normalizeBoardToken('https://apply.workable.com/treatwell/'), 'treatwell');
  assert.equal(normalizeBoardToken('https://apply.workable.com/blueground/j/123/'), 'blueground');
  assert.equal(normalizeBoardToken('https://skroutz.workable.com/'), 'skroutz');
  assert.equal(normalizeBoardToken('  TaxJar-HQ  '), 'taxjar-hq');
});

test('resolveBoards parses strings, arrays, and objects', () => {
  const defaultBoards = resolveBoards({});
  assert.ok(defaultBoards.length >= 4);
  assert.ok(defaultBoards.some((b) => b.token === 'epignosis'));

  const stringBoards = resolveBoards({ boards: 'treatwell, skroutz' });
  assert.equal(stringBoards.length, 2);
  assert.equal(stringBoards[0].token, 'treatwell');
  assert.equal(stringBoards[1].token, 'skroutz');

  const objectBoards = resolveBoards({
    boards: [{ token: 'custom-co', name: 'Custom Co' }]
  });
  assert.equal(objectBoards.length, 1);
  assert.equal(objectBoards[0].token, 'custom-co');
  assert.equal(objectBoards[0].name, 'Custom Co');
});

test('extractRequirements extracts clean text from requirements section', () => {
  const html = `
    <div>
      <p>Intro text</p>
      <strong>Requirements</strong>
      <ul>
        <li>3+ years of React development</li>
        <li>Proficiency with TypeScript and CSS</li>
      </ul>
      <strong>Benefits</strong>
      <p>Health insurance and remote budget</p>
    </div>
  `;
  const req = extractRequirements(html);
  assert.match(req, /3\+ years of React development/);
  assert.match(req, /Proficiency with TypeScript/);
});

test('WorkableScraper normalizes job correctly', () => {
  const scraper = new WorkableScraper({}, {});
  const raw = {
    title: 'Frontend Developer (React)',
    shortcode: 'FE12345',
    code: 'FE-01',
    employment_type: 'Full-time',
    telecommuting: true,
    department: 'Engineering',
    function: 'Engineering',
    industry: 'Computer Software',
    country: 'United States',
    city: 'San Francisco',
    state: 'CA',
    url: 'https://apply.workable.com/j/FE12345',
    application_url: 'https://apply.workable.com/j/FE12345/apply',
    published_on: '2026-09-10',
    created_at: '2026-09-10',
    description: '<p>Build responsive client interfaces.</p><strong>Requirements</strong><p>JavaScript, React, HTML, CSS.</p>',
    _accountName: 'Epignosis'
  };

  const normalized = scraper.normalizeJob(raw);
  assert.equal(normalized.source, 'workable');
  assert.equal(normalized.source_site, 'workable');
  assert.equal(normalized.sourceJobId, 'FE12345');
  assert.equal(normalized.title, 'Frontend Developer (React)');
  assert.equal(normalized.company, 'Epignosis');
  assert.equal(normalized.is_remote, true);
  assert.equal(normalized.applicationUrl, 'https://apply.workable.com/j/FE12345/apply');
  assert.match(normalized.description, /Build responsive client interfaces/);
  assert.match(normalized.requirements, /JavaScript, React, HTML, CSS/);
  assert.ok(normalized.jobHash);
});
