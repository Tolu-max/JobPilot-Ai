import { chromium } from 'playwright';
import { leverAdapter } from '../src/adapters/lever.js';
import { buildConfig } from '../src/config.js';
import { loadOrBuildCandidateProfile } from '../src/profileParser.js';
import { scrapeLeverJobs } from '../src/scrapers/lever.js';

const argv = ['node', '_dry-run-lever-scraped', '--profile=tolu'];
const config = buildConfig(argv);
config.sites.lever = {
  ...(config.sites.lever || {}),
  enabled: true,
  autoApplyEnabled: false,
  maxJobsPerRun: 5,
  boards: ['activecampaign'],
  remoteOnly: false
};

const profile = await loadOrBuildCandidateProfile(config);
config.candidateProfile = profile;

const jobs = await scrapeLeverJobs(config, config.sites.lever);
const job = jobs.find(j => j.title.toLowerCase().includes('software engineer') && !j.title.toLowerCase().includes('senior') && !j.title.toLowerCase().includes('staff')) || jobs[0];
console.log('Dry-run target:', job.title, job.applicationUrl);

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

try {
  await page.goto(job.applicationUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  console.log('loaded apply page:', page.url());

  const adapterCtx = {
    candidate: profile.candidate || {},
    config: {
      applicantEmail: config.applicantEmail,
      applicationDefaults: profile.applicationDefaults || config.applicationDefaults || {},
      testMode: true
    },
    resumePath: config.resumePath
  };

  let step = await leverAdapter.getCurrentStep(page);
  console.log('step before fill:', step);

  await leverAdapter.fillStep(page, step, adapterCtx);
  await page.waitForTimeout(2000);
  step = await leverAdapter.getCurrentStep(page);
  console.log('step after fill:', step);
  console.log('after fill url:', page.url());

  const submit = page.locator('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("submit application")').first();
  const visible = await submit.isVisible({ timeout: 5000 }).catch(() => false);
  const disabled = await submit.isDisabled().catch(() => false);
  console.log('submit button visible:', visible, '| disabled:', disabled);

  const result = await leverAdapter.advance(page, step, adapterCtx);
  console.log('advance result:', JSON.stringify(result, null, 2));
  console.log(visible && !disabled ? '✅ Dry-run PASSED: form filled and submit button is ready' : '⚠️ Submit button not ready');
} catch (e) {
  console.log('❌ DRY-RUN FAILED:', e.message);
} finally {
  await browser.close();
}
