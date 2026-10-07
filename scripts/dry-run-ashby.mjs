// End-to-end local dry-run of Ashby adapter (TEST_MODE — fills, no real submit).
// Proves: /application form loads → fields fill → stops before submit.
// Not committed. Replace `url` with any live jobs.ashbyhq.com job to re-run.
import { chromium } from 'playwright';
import { ashbyAdapter } from '../src/adapters/ashby.js';
import { FormStep } from '../src/adapters/types.js';

const url = process.argv[2] || 'https://jobs.ashbyhq.com/everai/000dd809-c604-4ab4-ad02-73732377cdf5/application';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

let passed = false;
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000); // wait for React to hydrate
  console.log('loaded page:', page.url());

  const adapterCtx = {
    candidate: {
      name: 'Jane Candidate',
      email: 'jane@example.com',
      phone: '+2348000000000',
      linkedin: 'https://linkedin.com/in/jane',
      location: 'Lagos, Nigeria'
    },
    config: {
      applicantEmail: 'jane@example.com',
      applicationDefaults: { country: 'Nigeria' },
      testMode: true
    },
    resumePath: null
  };

  let step = await ashbyAdapter.getCurrentStep(page);
  console.log('step before fill:', step);

  await ashbyAdapter.fillStep(page, step, adapterCtx);
  console.log('after fill, url:', page.url());

  step = await ashbyAdapter.getCurrentStep(page);
  console.log('step after fill:', step);

  // Verify the form actually loaded and filled — a TEST_MODE short-circuit alone
  // must not count as a pass if the form never rendered.
  const nameVal = await page.locator('input[name="_systemfield_name"]').first().inputValue().catch(() => '');
  console.log('name value after fill:', JSON.stringify(nameVal));
  const formReached = step === FormStep.DETAILS && nameVal.trim().length > 0;

  const result = await ashbyAdapter.advance(page, step, adapterCtx);
  console.log('advance result:', JSON.stringify(result));

  if (formReached && result.reason.includes('TEST_MODE')) {
    console.log('✅ Dry-run PASSED: form reached, fields filled, stopped before submit in TEST_MODE.');
    passed = true;
  } else if (result.reason.includes('audit')) {
    console.log('⚠️ Audit blocked submit (safe-bail working):', result.reason);
  } else if (!formReached) {
    console.log('❌ Form did not load/fill (step=' + step + ', name=' + JSON.stringify(nameVal) + ') — job may be expired.');
  } else {
    console.log('unexpected result');
  }
} catch (e) {
  console.log('❌ DRY-RUN FAILED:', e.message);
} finally {
  await browser.close();
}
if (!passed) process.exitCode = 1;
