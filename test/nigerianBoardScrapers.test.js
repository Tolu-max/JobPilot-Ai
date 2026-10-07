import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJobzillaLinks, parseJobzillaDetail } from '../src/scrapers/jobzilla.js';
import { parseJobGurusLinks, parseJobGurusDetail } from '../src/scrapers/jobgurus.js';

test('Jobzilla parser extracts and normalizes job links', () => {
  const links = parseJobzillaLinks('<a href="/jobs/web-developer-123">Web</a><a href="/jobs/web-developer-123">dup</a>');
  assert.equal(links.length, 1);
  assert.equal(links[0].jobUrl, 'https://jobzilla.ng/jobs/web-developer-123');
});

test('Jobzilla detail parser returns a normalized review record', () => {
  const job = parseJobzillaDetail('<h1>Web Developer</h1><p>Location: Abuja</p><p>Company: Example Ltd</p><p>Build websites.</p>', 'https://jobzilla.ng/jobs/web-developer-123');
  assert.equal(job.title, 'Web Developer');
  assert.equal(job.location, 'Abuja');
  assert.equal(job.company, 'Example Ltd');
});

test('JobGurus parser extracts public job detail links', () => {
  const links = parseJobGurusLinks('<a href="/jobs/view/software-engineer">Role</a>');
  assert.equal(links.length, 1);
  assert.equal(links[0].jobUrl, 'https://jobgurus.com.ng/jobs/view/software-engineer');
});

test('JobGurus detail parser returns a normalized review record', () => {
  const job = parseJobGurusDetail('<h1>Customer Support Agent</h1><p>Location: Abuja</p><p>Company: Example Ltd</p>', 'https://jobgurus.com.ng/jobs/view/support');
  assert.equal(job.title, 'Customer Support Agent');
  assert.equal(job.location, 'Abuja');
});
