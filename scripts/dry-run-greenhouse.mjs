// End-to-end local dry-run of Greenhouse adapter (TEST_MODE — fills, no real submit).
// Usage: node scripts/dry-run-greenhouse.mjs [greenhouse-job-url]
import path from 'node:path';
import { chromium } from 'playwright';
import { greenhouseAdapter } from '../src/adapters/greenhouse.js';
import { FormStep } from '../src/adapters/types.js';

const url = process.argv[2] || 'https://job-boards.greenhouse.io/customerio/jobs/8069682';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

let passed = false;
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  console.log('loaded page:', page.url());

  const adapterCtx = {
    candidate: {
      name: 'TEMILOLUWA RUTH OYELOLA',
      email: 'temmy152000@gmail.com',
      phone: '(+234) 07062187105',
      linkedin: 'https://www.linkedin.com/in/temiloluwa-oyelola-6575a0234/',
      location: 'Kaduna, Nigeria',
      summary: 'Results-driven communications professional with expertise in high-volume outreach and lead management. Successfully managed the end-to-end pipeline for 1,000+ participants using HubSpot and Zendesk. Skilled at customer operations, CRM updates, calendar management, and remote support.'
    },
    config: {
      applicantEmail: 'temmy152000@gmail.com',
      applicationDefaults: { country: 'Nigeria', city: 'Kaduna', location: 'Kaduna, Nigeria', linkedinProfileUrl: 'https://www.linkedin.com/in/temiloluwa-oyelola-6575a0234/' },
      testMode: true
    },
    coverLetter: 'I am a results-driven communications professional with experience in CRM management, customer support, and high-volume outreach. I have coordinated programs for over 1,000 participants using HubSpot and Zendesk, and I am confident I can bring strong organizational and communication skills to this remote role.',
    resumePath: process.env.GREENHOUSE_RESUME_PATH || path.resolve('profiles/sister/resume.pdf')
  };

  let step = await greenhouseAdapter.getCurrentStep(page);
  console.log('step before fill:', step);

  await greenhouseAdapter.fillStep(page, step, adapterCtx);
  console.log('after fill, url:', page.url());

  step = await greenhouseAdapter.getCurrentStep(page);
  console.log('step after fill:', step);

  const firstNameVal = await page.locator('#first_name').first().inputValue().catch(() => '');
  console.log('first_name value after fill:', JSON.stringify(firstNameVal));
  const formReached = step === FormStep.DETAILS && firstNameVal.trim().length > 0;

  const result = await greenhouseAdapter.advance(page, step, adapterCtx);
  console.log('advance result:', JSON.stringify(result));

  if (formReached && (result.reason.includes('TEST_MODE') || result.reason.includes('NO_REAL_SUBMISSION'))) {
    console.log('✅ Dry-run PASSED: form reached, fields filled, stopped before submit in TEST_MODE.');
    passed = true;
  } else if (result.reason.includes('audit')) {
    console.log('⚠️ Audit blocked submit (safe-bail working):', result.reason);
  } else if (!formReached) {
    console.log('❌ Form did not load/fill (step=' + step + ', first_name=' + JSON.stringify(firstNameVal) + ') — job may be expired or already applied.');
  } else {
    console.log('unexpected result');
  }
} catch (e) {
  console.log('❌ DRY-RUN FAILED:', e.message);
  console.log(e.stack);
} finally {
  await browser.close();
}
if (!passed) process.exitCode = 1;
