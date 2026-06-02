import 'dotenv/config';
import { chromium } from 'playwright';
import { solveCaptchaAuto } from './src/captchaSolver.js';

const DEMO_URL = 'https://www.google.com/recaptcha/api2/demo';

const config = {
  capsolverApiKey: process.env.CAPSOLVER_API_KEY,
  headless: false,
  logFile: null,
};

console.log('[demo] CAPSOLVER_API_KEY present:', !!config.capsolverApiKey);
if (!config.capsolverApiKey) {
  console.error('[demo] No CAPSOLVER_API_KEY in .env — aborting.');
  process.exit(1);
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

console.log(`[demo] Navigating to ${DEMO_URL}...`);
await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2500);

console.log('[demo] Calling solveCaptchaAuto...');
const t0 = Date.now();
const result = await solveCaptchaAuto(page, config);
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log('');
console.log('[demo] ===== RESULT =====');
console.log('[demo] ok:    ', result.ok);
console.log('[demo] reason:', result.reason);
console.log(`[demo] took:   ${elapsed}s`);

if (result.ok) {
  console.log('[demo] Submitting the demo form to confirm the token is valid...');
  await page.locator('#recaptcha-demo-submit').click().catch(() => {});
  await page.waitForTimeout(2500);
  const successText = await page.locator('.recaptcha-success').innerText().catch(() => '');
  console.log(`[demo] Server response text: "${successText.trim()}"`);
  if (/verification success/i.test(successText)) {
    console.log('[demo] ✅ Google accepted the token. End-to-end works.');
  } else {
    console.log('[demo] ⚠️ Token injected but demo submit did not show success text. Inspect the page.');
  }
}

console.log('');
console.log('[demo] Leaving browser open 8s so you can inspect...');
await page.waitForTimeout(8000);
await browser.close();
process.exit(result.ok ? 0 : 1);
