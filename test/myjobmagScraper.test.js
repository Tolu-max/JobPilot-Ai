import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMyJobMagListingLinks,
  parseMyJobMagJobDetail,
  splitTitleAndCompany,
  buildMyJobMagPageUrl,
  filterMyJobMagJobsByPolicy,
  myjobmagBoardUrl,
  resolveRequestTimeout
} from '../src/scrapers/myjobmag.js';
import { localMatchJob } from '../src/localMatcher.js';
import { buildConfig } from '../src/config.js';

const SAMPLE_LISTING_HTML = `
<!DOCTYPE html>
<html>
<body>
  <ul>
    <li class="mag-b">
      <h2><a href="/job/full-stack-developer-tech-solutions">Full Stack Developer at Tech Solutions Ltd</a></h2>
    </li>
    <li class="job-desc">
      We are looking for a Full Stack Developer experienced with React, Node.js, and TypeScript.
    </li>
    <li class="job-item">
      <ul>
        <li id="job-date">08 September</li>
      </ul>
    </li>
    <li class="mag-b">
      <h2><a href="/job/customer-support-specialist-care-hub">Customer Support Specialist at CareHub Africa</a></h2>
    </li>
    <li class="job-desc">
      Looking for an empathetic customer support and CRM representative for remote operations.
    </li>
    <li class="job-item">
      <ul>
        <li id="job-date">07 September</li>
      </ul>
    </li>
  </ul>
</body>
</html>
`;

const SAMPLE_DEV_DETAIL_HTML = `
<!DOCTYPE html>
<html>
<body>
  <ul class="read-ul">
    <li class="read-head">
      <ul class="read-h1">
        <li>
          <h1>Full Stack Developer at Tech Solutions Ltd</h1>
        </li>
        <li class="job-industry">
          <a href="/jobs-at/tech-solutions-ltd">View Jobs at Tech Solutions Ltd</a>
        </li>
      </ul>
      <div class="read-date-sec">
        <div class="read-date-sec-li" id="posted-date"><b class="tc-o">Posted:</b> Sep 08, 2026</div>
      </div>
    </li>
    <li id="printable" class="job-description">
      <ul class="job-key-info">
        <li><span class="jkey-title">Job Type</span> <span class="jkey-info"><a href="/jobs-by-type/full-time">Full Time</a> , <a href="/jobs-by-type/remote">Remote</a></span></li>
        <li><span class="jkey-title">Experience</span> <span class="jkey-info">2 - 5 years</span></li>
        <li><span class="jkey-title">Location</span> <span class="jkey-info">Remote</span></li>
        <li><span class="jkey-title">Job Field</span> <span class="jkey-info">ICT / Computer</span></li>
      </ul>
      <div class="job-details">
        <p>We are seeking an experienced Full Stack Developer proficient in React, JavaScript, Node.js, and API integrations.</p>
      </div>
      <div>
        <a href="/apply-now/998877">Apply Now</a>
      </div>
    </li>
  </ul>
</body>
</html>
`;

const SAMPLE_SUPPORT_DETAIL_HTML = `
<!DOCTYPE html>
<html>
<body>
  <ul class="read-ul">
    <li class="read-head">
      <ul class="read-h1">
        <li>
          <h1>Customer Support Specialist at CareHub Africa</h1>
        </li>
        <li class="job-industry">
          <a href="/jobs-at/carehub-africa">View Jobs at CareHub Africa</a>
        </li>
      </ul>
      <div class="read-date-sec">
        <div class="read-date-sec-li" id="posted-date"><b class="tc-o">Posted:</b> Sep 07, 2026</div>
      </div>
    </li>
    <li id="printable" class="job-description">
      <ul class="job-key-info">
        <li><span class="jkey-title">Job Type</span> <span class="jkey-info"><a href="/jobs-by-type/full-time">Full Time</a> , <a href="/jobs-by-type/remote">Remote</a></span></li>
        <li><span class="jkey-title">Experience</span> <span class="jkey-info">1 - 3 years</span></li>
        <li><span class="jkey-title">Location</span> <span class="jkey-info">Remote</span></li>
        <li><span class="jkey-title">Job Field</span> <span class="jkey-info">Customer Care / Service</span></li>
      </ul>
      <div class="job-details">
        <p>CareHub Africa is looking for a Customer Support Representative to handle customer inquiries, ticketing systems, CRM records, and email support.</p>
      </div>
      <div>
        <a href="/apply-now/554433">Apply Now</a>
      </div>
    </li>
  </ul>
</body>
</html>
`;

test('MyJobMag: splitTitleAndCompany correctly separates role and company', () => {
  const result1 = splitTitleAndCompany('Full Stack Developer at Tech Solutions Ltd');
  assert.equal(result1.title, 'Full Stack Developer');
  assert.equal(result1.company, 'Tech Solutions Ltd');

  const result2 = splitTitleAndCompany('Customer Support Lead');
  assert.equal(result2.title, 'Customer Support Lead');
  assert.equal(result2.company, '');
});

test('MyJobMag: parseMyJobMagListingLinks extracts jobs from listing HTML', () => {
  const links = parseMyJobMagListingLinks(SAMPLE_LISTING_HTML);
  assert.equal(links.length, 2);
  assert.equal(links[0].title, 'Full Stack Developer');
  assert.equal(links[0].company, 'Tech Solutions Ltd');
  assert.equal(links[0].jobUrl, 'https://www.myjobmag.com/job/full-stack-developer-tech-solutions');

  assert.equal(links[1].title, 'Customer Support Specialist');
  assert.equal(links[1].company, 'CareHub Africa');
});

test('MyJobMag: buildMyJobMagPageUrl generates correct pagination URLs', () => {
  const paged = buildMyJobMagPageUrl('https://www.myjobmag.com/jobs-by-type/remote', 2);
  assert.equal(paged, 'https://www.myjobmag.com/jobs-by-type/remote/2');
});

test('MyJobMag: myjobmagBoardUrl constructs category and topic URLs correctly', () => {
  assert.equal(myjobmagBoardUrl('remote-tech-jobs-nigeria'), 'https://www.myjobmag.com/cp/remote-tech-jobs-nigeria');
  assert.equal(myjobmagBoardUrl('cp/remote-customer-service-jobs'), 'https://www.myjobmag.com/cp/remote-customer-service-jobs');
  assert.equal(myjobmagBoardUrl('ict-software'), 'https://www.myjobmag.com/jobs-by-field/ict-software');
});

test('MyJobMag request timeouts are bounded below the run timeout', () => {
  assert.equal(resolveRequestTimeout({ timeoutMs: 45000 }, 12000), 12000);
  assert.equal(resolveRequestTimeout({ requestTimeoutMs: 6000 }, 12000), 6000);
  assert.equal(resolveRequestTimeout({ requestTimeoutMs: 1000 }, 12000), 3000);
});

test('MyJobMag: parseMyJobMagJobDetail extracts full fields from detail page', () => {
  const job = parseMyJobMagJobDetail(SAMPLE_DEV_DETAIL_HTML, 'https://www.myjobmag.com/job/full-stack-developer-tech-solutions');
  assert.equal(job.title, 'Full Stack Developer');
  assert.equal(job.company, 'Tech Solutions Ltd');
  assert.equal(job.is_remote, true);
  assert.equal(job.jobType, 'Full Time , Remote');
  assert.equal(job.applicationUrl, 'https://www.myjobmag.com/apply-now/998877');
  assert.match(job.description, /Full Stack Developer proficient in React/);
  assert.ok(job.postedAt);
});

test('MyJobMag candidate isolation: Tolu matches dev job and Sister matches support job', async () => {
  const toluConfig = buildConfig(['--profile=tolu']);
  const sisterConfig = buildConfig(['--profile=sister']);

  const devJob = parseMyJobMagJobDetail(SAMPLE_DEV_DETAIL_HTML, 'https://www.myjobmag.com/job/full-stack-developer-tech-solutions');
  const supportJob = parseMyJobMagJobDetail(SAMPLE_SUPPORT_DETAIL_HTML, 'https://www.myjobmag.com/job/customer-support-specialist-care-hub');

  const { loadOrBuildCandidateProfile } = await import('../src/profileParser.js');
  const toluProfile = await loadOrBuildCandidateProfile(toluConfig);
  const sisterProfile = await loadOrBuildCandidateProfile(sisterConfig);

  const toluDevMatch = await localMatchJob(devJob, toluProfile, toluConfig);
  const sisterDevMatch = await localMatchJob(devJob, sisterProfile, sisterConfig);

  assert.ok(toluDevMatch.score >= 70, `Expected Tolu dev score >= 70, got ${toluDevMatch.score}`);
  assert.ok(sisterDevMatch.score < 50, `Expected Sister dev score < 50, got ${sisterDevMatch.score}`);

  const sisterSupportMatch = await localMatchJob(supportJob, sisterProfile, sisterConfig);
  const toluSupportMatch = await localMatchJob(supportJob, toluProfile, toluConfig);

  assert.ok(sisterSupportMatch.score >= 70, `Expected Sister support score >= 70, got ${sisterSupportMatch.score}`);
  assert.ok(toluSupportMatch.score < 50, `Expected Tolu support score < 50, got ${toluSupportMatch.score}`);
});

test('MyJobMag: filterMyJobMagJobsByPolicy enforces remoteOnly strictly', () => {
  const jobs = [
    {
      title: 'Remote Frontend Developer',
      location: 'Remote',
      jobType: 'Full Time',
      description: 'Work from anywhere building web applications.',
      is_remote: true
    },
    {
      title: 'On-site Office Assistant',
      location: 'Lagos',
      jobType: 'Full Time',
      description: 'Must report to our Victoria Island office daily Monday to Friday.',
      is_remote: false
    }
  ];

  const filtered = filterMyJobMagJobsByPolicy(jobs, { remoteOnly: true });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].title, 'Remote Frontend Developer');
});
