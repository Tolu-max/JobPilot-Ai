import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BreezyHrScraper,
  resolveBoards,
  normalizeBoardToken,
  extractDescriptionFromHtml
} from '../src/scrapers/breezyhr.js';
import { scraperRegistry } from '../src/scrapers/index.js';

test('breezyhr scraper is registered in scraperRegistry and marked implemented', () => {
  assert.ok(scraperRegistry.breezyhr);
  assert.equal(scraperRegistry.breezyhr.implemented, true);
  assert.equal(typeof scraperRegistry.breezyhr.scrape, 'function');
});

test('normalizeBoardToken normalizes URLs and raw slug strings', () => {
  assert.equal(normalizeBoardToken('pairty'), 'pairty');
  assert.equal(normalizeBoardToken('https://cortex.breezy.hr/'), 'cortex');
  assert.equal(normalizeBoardToken('https://bloom.breezy.hr/jobs'), 'bloom');
  assert.equal(normalizeBoardToken('  SPROUT-HQ  '), 'sprout-hq');
});

test('resolveBoards parses strings, arrays, and objects', () => {
  const defaultBoards = resolveBoards({});
  assert.ok(defaultBoards.length >= 4);
  assert.ok(defaultBoards.some((b) => b.token === 'pairty'));

  const stringBoards = resolveBoards({ boards: 'cortex, bloom' });
  assert.equal(stringBoards.length, 2);
  assert.equal(stringBoards[0].token, 'cortex');
  assert.equal(stringBoards[1].token, 'bloom');

  const objectBoards = resolveBoards({
    boards: [{ token: 'custom-co', name: 'Custom Co' }]
  });
  assert.equal(objectBoards.length, 1);
  assert.equal(objectBoards[0].token, 'custom-co');
  assert.equal(objectBoards[0].name, 'Custom Co');
});

test('extractDescriptionFromHtml extracts clean text from description container', () => {
  const html = `
    <html>
      <body>
        <div class="description">
          <h2>About the Role</h2>
          <p>We are hiring a Senior Web Developer to build web apps.</p>
        </div>
      </body>
    </html>
  `;
  const desc = extractDescriptionFromHtml(html);
  assert.match(desc, /About the Role/);
  assert.match(desc, /Senior Web Developer/);
});

test('BreezyHrScraper normalizes job correctly', () => {
  const scraper = new BreezyHrScraper({}, {});
  const raw = {
    id: '03145c08182d',
    friendly_id: '03145c08182d-frontend-engineer',
    name: 'Frontend Engineer (React)',
    url: 'https://pairty.breezy.hr/p/03145c08182d-frontend-engineer',
    published_date: '2026-09-12T10:00:00.000Z',
    type: { id: 'full_time', name: 'Full-Time' },
    location: {
      name: 'Remote',
      is_remote: true,
      country: { name: 'United States', id: 'US' }
    },
    department: 'Engineering',
    salary: '$120K - $150K',
    company: { name: 'Pairty AI', friendly_id: 'pairty' },
    _descriptionHtml: 'Build modern responsive UIs with React and TypeScript.'
  };

  const normalized = scraper.normalizeJob(raw);
  assert.equal(normalized.source, 'breezyhr');
  assert.equal(normalized.source_site, 'breezyhr');
  assert.equal(normalized.sourceJobId, '03145c08182d');
  assert.equal(normalized.title, 'Frontend Engineer (React)');
  assert.equal(normalized.company, 'Pairty AI');
  assert.equal(normalized.is_remote, true);
  assert.equal(normalized.applicationUrl, 'https://pairty.breezy.hr/p/03145c08182d-frontend-engineer/apply');
  assert.match(normalized.description, /Build modern responsive UIs/);
  assert.ok(normalized.jobHash);
});
