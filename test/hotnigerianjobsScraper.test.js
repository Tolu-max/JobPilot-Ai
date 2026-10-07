import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HotNigerianJobsScraper,
  parseRssItems,
  extractSubPositions,
  parseJobDetailHtml,
  decodeCfEmail,
  extractCompanyFromTitle,
  extractJobIdFromUrl
} from '../src/scrapers/hotnigerianjobs.js';
import { scraperRegistry } from '../src/scrapers/index.js';

test('HotNigerianJobs: scraper is registered in scraperRegistry and implemented', () => {
  const reg = scraperRegistry['hotnigerianjobs'];
  assert.ok(reg, 'hotnigerianjobs is in scraperRegistry');
  assert.equal(reg.implemented, true, 'is marked implemented');
  assert.equal(typeof reg.scrape, 'function', 'has scrape function');
});

test('HotNigerianJobs: decodeCfEmail correctly decodes Cloudflare email ciphers', () => {
  // '4e' key XOR with '0d' -> '43' ('C'), '2f' -> '61' ('a'), etc.
  const encoded = '4e0d2f3c2b2b3c3d0e3d3e2b2d3a3c3b232c2121253d222723273a2b2a602d2123';
  const decoded = decodeCfEmail(encoded);
  assert.equal(decoded.toLowerCase(), 'careers@spectrumbookslimited.com');
});

test('HotNigerianJobs: extractCompanyFromTitle parses company from diverse formats', () => {
  assert.equal(extractCompanyFromTitle('IT Support Officer at Spectrum Books Limited'), 'Spectrum Books Limited');
  assert.equal(extractCompanyFromTitle('Customer Care Representative at Lynton Prints'), 'Lynton Prints');
  assert.equal(extractCompanyFromTitle('Lynton Prints Job Recruitment (5 Positions)'), 'Lynton Prints');
  assert.equal(extractCompanyFromTitle('Driver at Estuary Business Solution'), 'Estuary Business Solution');
});

test('HotNigerianJobs: extractJobIdFromUrl extracts numeric job ID', () => {
  const url = 'https://www.hotnigerianjobs.com/hotjobs/959123/spectrum-books-limited-job-recruitment-3-positions.html';
  assert.equal(extractJobIdFromUrl(url), '959123');
});

test('HotNigerianJobs: parseRssItems parses XML items correctly', () => {
  const sampleXml = `<?xml version='1.0' encoding='UTF-8'?>
  <rss version='2.0'>
    <channel>
      <item>
        <title>Full-Stack Web Developer at TechPulse Limited</title>
        <link>https://www.hotnigerianjobs.com/hotjobs/959999/full-stack-web-developer-at-techpulse.html</link>
        <description>TechPulse Limited is recruiting a remote Full-Stack Web Developer proficient in PHP, Laravel, and React.</description>
        <pubDate>Tue, 15 Sep 2026 18:00:00 +0100</pubDate>
      </item>
    </channel>
  </rss>`;

  const items = parseRssItems(sampleXml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Full-Stack Web Developer at TechPulse Limited');
  assert.equal(items[0].id, '959999');
  assert.ok(items[0].summary.includes('PHP, Laravel'));
});

test('HotNigerianJobs: parseJobDetailHtml extracts email, subject, salary, and external links', () => {
  const sampleHtml = `
    <div class="mycase4">
      <p><strong>Job Title: Frontend Developer</strong></p>
      <p><strong>Location: </strong>Lagos (Remote)</p>
      <p><strong>Salary: </strong>N400,000 - N600,000 / Month.</p>
      <p>We are seeking a talented frontend developer.</p>
    </div>
    <div class="mycase4"></div>
    <p>How to Apply</p>
    <p>Send CV to <a href="/cdn-cgi/l/email-protection#test"><span class="__cf_email__" data-cfemail="4e0d2f3c2b2b3c3d0e3d3e2b2d3a3c3b232c2121253d222723273a2b2a602d2123"></span></a> using "Frontend Web Dev" as the subject of the email.</p>
  `;

  const parsed = parseJobDetailHtml(sampleHtml, {
    title: 'Frontend Developer at Spectrum Books Limited',
    link: 'https://www.hotnigerianjobs.com/hotjobs/959999/frontend.html'
  });

  assert.equal(parsed.decodedEmail.toLowerCase(), 'careers@spectrumbookslimited.com');
  assert.equal(parsed.applySubject, 'Frontend Web Dev');
  assert.equal(parsed.salary, 'N400,000 - N600,000 / Month.');
  assert.equal(parsed.location, 'Lagos (Remote)');
  assert.equal(parsed.applyMethod, 'email');
});

test('HotNigerianJobsScraper: normalizes job with deterministic hash and canonical fields', () => {
  const scraper = new HotNigerianJobsScraper({ profilesDir: 'profiles' });
  const rawJob = {
    id: '959888',
    title: 'Customer Service Representative at GlobalPay Limited',
    company: 'GlobalPay Limited',
    location: 'Lagos, Nigeria (Remote)',
    salary: 'N250,000 / month',
    description: 'Provide omnichannel live chat and email support to clients.',
    requirements: '2+ years customer support experience, Zendesk, CRM proficiency.',
    link: 'https://www.hotnigerianjobs.com/hotjobs/959888/customer-service.html',
    decodedEmail: 'jobs@globalpay.com',
    applySubject: 'Customer Service Rep',
    applyMethod: 'email',
    pubDate: 'Tue, 15 Sep 2026 12:00:00 +0100'
  };

  const job = scraper.normalizeJob(rawJob);
  assert.equal(job.source, 'hotnigerianjobs');
  assert.equal(job.company, 'GlobalPay Limited');
  assert.equal(job.is_remote, true);
  assert.ok(job.jobHash, 'jobHash generated');
  assert.equal(job.raw.decodedEmail, 'jobs@globalpay.com');
  assert.equal(job.raw.applySubject, 'Customer Service Rep');
});
