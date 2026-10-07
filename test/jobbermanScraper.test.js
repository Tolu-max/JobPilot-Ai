import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJobbermanJobDetail, extractJobbermanPaginationPages, canonicalizeJobbermanLocationUrl } from '../src/scrapers/jobberman.js';
import { localMatchJob } from '../src/localMatcher.js';
import { buildConfig } from '../src/config.js';

const SAMPLE_HTML_PAGE = `
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "JobPosting",
      "@id": "https://www.jobberman.com/listings/senior-fullstack-php-laravel-engineer-12345",
      "title": "Fullstack PHP &amp; Laravel Engineer",
      "hiringOrganization": {
        "@type": "Organization",
        "name": "DevSolutions &amp; Tech Ltd"
      },
      "jobLocationType": "TELECOMMUTE",
      "applicantLocationRequirements": {
        "@type": "Country",
        "name": "NG"
      },
      "employmentType": "Full Time",
      "baseSalary": {
        "currency": "NGN",
        "value": {
          "minValue": 600000,
          "maxValue": 900000,
          "unitText": "MONTH"
        }
      },
      "description": "<p>We are looking for an experienced Fullstack PHP and Laravel developer with MySQL and JavaScript knowledge.</p>",
      "qualifications": "3+ years experience in PHP, Laravel, APIs, JavaScript",
      "datePosted": "2026-09-01T10:00:00Z",
      "directApply": true
    }
  ]
}
</script></head>
<body>
  <div class="pagination">
    <a href="/jobs/software-data/remote?page=2">2</a>
    <a href="/jobs/software-data/remote?page=3">3</a>
  </div>
</body></html>`

const SAMPLE_VA_HTML =`\n<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "JobPosting",
      "@id": "https://www.jobberman.com/listings/real-estate-virtual-assistant-67890",
      "title": "Real Estate Virtual Assistant / Appointment Setter",
      "hiringOrganization": {
        "@type": "Organization",
        "name": "Prime Realty Services"
      },
      "jobLocationType": "TELECOMMUTE",
      "applicantLocationRequirements": {
        "@type": "Country",
        "name": "NG"
      },
      "employmentType": "Full Time",
      "baseSalary": {
        "currency": "USD",
        "value": {
          "minValue": 700,
          "maxValue": 1000,
          "unitText": "MONTH"
        }
      },
      "description": "<p>Looking for an organized Virtual Assistant to manage appointments, CRM data entry, and follow-ups.</p>",
      "qualifications": "Customer support, CRM, calendar management",
      "datePosted": "2026-09-02T14:00:00Z",
      "directApply": true
    }
  ]
}
</script></head></html>`;

test('Jobberman scraper correctly decodes HTML entities in title and company', () => {
  const job = parseJobbermanJobDetail(
    SAMPLE_HTML_PAGE,
    'https://www.jobberman.com/listings/senior-fullstack-php-laravel-engineer-12345'
  );

  assert.equal(job.title, 'Fullstack PHP & Laravel Engineer');
  assert.equal(job.company, 'DevSolutions & Tech Ltd');
  assert.equal(job.location, 'Remote (NG)');
  assert.equal(job.salary, 'NGN 600000-900000 MONTH');
  assert.equal(job.raw.directApply, true);
});

test('Jobberman scraper extracts pagination page numbers', () => {
  const pages = extractJobbermanPaginationPages(SAMPLE_HTML_PAGE);
  assert.deepEqual(pages, [2, 3]);
});

test('Jobberman canonicalizes legacy location query URLs', () => {
  assert.equal(
    canonicalizeJobbermanLocationUrl('https://www.jobberman.com/jobs/software-data?location=ibadan'),
    'https://www.jobberman.com/jobs/software-data/ibadan-oyo'
  );
  assert.equal(
    canonicalizeJobbermanLocationUrl('https://www.jobberman.com/jobs/software-data?location=abuja'),
    'https://www.jobberman.com/jobs/software-data/abuja'
  );
});

test('Candidate isolation: Tolu matches dev job and Sister ignores it', async () => {
  const devJob = parseJobbermanJobDetail(
    SAMPLE_HTML_PAGE,
    'https://www.jobberman.com/listings/senior-fullstack-php-laravel-engineer-12345'
  );

  const toluConfig = buildConfig(['node', 'jobpilot', '--profile=tolu']);
  const sisterConfig = buildConfig(['node', 'jobpilot', '--profile=sister']);

  const toluResult = await localMatchJob(devJob, toluConfig.candidateProfile || {}, toluConfig);
  const sisterResult = await localMatchJob(devJob, sisterConfig.candidateProfile || {}, sisterConfig);

  assert.ok(toluResult.score >= 70, `Tolu should score high on PHP/Laravel role (got ${toluResult.score})`);
  assert.ok(sisterResult.score < 50, `Sister should not match engineering role (got ${sisterResult.score})`);
});

test('Candidate isolation: Sister matches VA/Support job and Tolu ignores it', async () => {
  const vaJob = parseJobbermanJobDetail(
    SAMPLE_VA_HTML,
    'https://www.jobberman.com/listings/real-estate-virtual-assistant-67890'
  );

  const toluConfig = buildConfig(['node', 'jobpilot', '--profile=tolu']);
  const sisterConfig = buildConfig(['node', 'jobpilot', '--profile=sister']);

  const toluResult = await localMatchJob(vaJob, toluConfig.candidateProfile || {}, toluConfig);
  const sisterResult = await localMatchJob(vaJob, sisterConfig.candidateProfile || {}, sisterConfig);

  assert.ok(sisterResult.score >= 70, `Sister should score high on VA/Appointment Setter role (got ${sisterResult.score})`);
  assert.ok(toluResult.score < 50, `Tolu should not match VA role (got ${toluResult.score})`);
});
