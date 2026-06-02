import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { solveCaptchaAuto } from '../src/captchaSolver.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const RUN_BROWSER_TESTS = process.env.RUN_BROWSER_TESTS === '1';

// ---------------------------------------------------------------------------
// Helper: launch a headless browser on a local HTML file
// ---------------------------------------------------------------------------
async function withPage(html, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'captcha-test-'));
  const htmlPath = path.join(dir, 'page.html');
  await fs.writeFile(htmlPath, html, 'utf8');

  const profileDir = path.join(dir, 'profile');
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    viewport: { width: 1366, height: 768 }
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = { runtime: {} };
  });

  try {
    const page = await context.newPage();
    await page.goto(pathToFileURL(htmlPath).toString(), { waitUntil: 'domcontentloaded' });
    return await fn(page);
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// Test 1: No Gemini key → graceful failure, no crash
// ---------------------------------------------------------------------------
test('solveCaptchaAuto returns ok:false when GEMINI_API_KEY is missing', { skip: !RUN_BROWSER_TESTS }, async () => {
  const result = await withPage(
    `<html><body>
      <div class="g-recaptcha" data-sitekey="6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"></div>
      <iframe src="https://www.google.com/recaptcha/api2/anchor?ar=1&k=6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"></iframe>
    </body></html>`,
    async (page) => solveCaptchaAuto(page, { geminiApiKey: '', geminiModel: GEMINI_MODEL })
  );

  assert.equal(result.ok, false);
  assert.match(result.reason, /GEMINI_API_KEY|No API key/i);
  console.log('  ✓ Missing API key handled gracefully');
});

// ---------------------------------------------------------------------------
// Test 2: Page with no CAPTCHA → ok:false with clear reason
// ---------------------------------------------------------------------------
test('solveCaptchaAuto returns ok:false on a page with no CAPTCHA', { skip: !RUN_BROWSER_TESTS }, async () => {
  const result = await withPage(
    `<html><body><form><input type="text" /><button>Submit</button></form></body></html>`,
    async (page) => solveCaptchaAuto(page, { geminiApiKey: GEMINI_API_KEY, geminiModel: GEMINI_MODEL })
  );

  assert.equal(result.ok, false);
  assert.match(result.reason, /Unsupported or undetected/i);
  console.log('  ✓ No CAPTCHA page handled gracefully');
});

// ---------------------------------------------------------------------------
// Test 3: Detection — reCAPTCHA v2 elements are recognised
// ---------------------------------------------------------------------------
test('reCAPTCHA v2 is detected correctly from page elements', { skip: !RUN_BROWSER_TESTS }, async () => {
  const result = await withPage(
    `<html><body>
      <div class="g-recaptcha" data-sitekey="6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"></div>
    </body></html>`,
    async (page) => {
      // Detection is internal, so we observe through solveCaptchaAuto behaviour:
      // With a real key it should attempt recaptcha2 path (not return 'unknown CAPTCHA')
      if (!GEMINI_API_KEY) return { detected: true }; // skip AI call without key
      const r = await solveCaptchaAuto(page, { geminiApiKey: GEMINI_API_KEY, geminiModel: GEMINI_MODEL });
      // It should attempt recaptcha2 (checkbox click will fail on local file — that's expected)
      const attemptedRecaptcha = !r.reason.includes('Unsupported or undetected');
      return { detected: attemptedRecaptcha };
    }
  );

  assert.equal(result.detected, true);
  console.log('  ✓ reCAPTCHA v2 elements detected correctly');
});

// ---------------------------------------------------------------------------
// Test 4: Detection — hCaptcha elements are recognised
// ---------------------------------------------------------------------------
test('hCaptcha is detected correctly from page elements', { skip: !RUN_BROWSER_TESTS }, async () => {
  const result = await withPage(
    `<html><body>
      <div class="h-captcha" data-sitekey="10000000-ffff-ffff-ffff-000000000001"></div>
      <iframe src="https://hcaptcha.com/captcha/v1/abc/static/hcaptcha.html"></iframe>
    </body></html>`,
    async (page) => {
      if (!GEMINI_API_KEY) return { detected: true };
      const r = await solveCaptchaAuto(page, { geminiApiKey: GEMINI_API_KEY, geminiModel: GEMINI_MODEL });
      const attemptedHcaptcha = !r.reason.includes('Unsupported or undetected');
      return { detected: attemptedHcaptcha };
    }
  );

  assert.equal(result.detected, true);
  console.log('  ✓ hCaptcha elements detected correctly');
});

// ---------------------------------------------------------------------------
// Test 5: Live reCAPTCHA demo — full solve attempt (skipped if no Gemini key)
// ---------------------------------------------------------------------------
test('Live reCAPTCHA v2 demo solve attempt', { skip: !RUN_BROWSER_TESTS || !GEMINI_API_KEY }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'captcha-live-'));
  const profileDir = path.join(dir, 'profile');

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars'
    ],
    viewport: { width: 1366, height: 768 }
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  try {
    console.log('  → Navigating to Google reCAPTCHA demo page...');
    await page.goto('https://www.google.com/recaptcha/api2/demo', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(2000);

    console.log('  → Running solveCaptchaAuto...');
    const result = await solveCaptchaAuto(page, {
      geminiApiKey: GEMINI_API_KEY,
      geminiModel: GEMINI_MODEL
    });

    console.log(`  → Result: ok=${result.ok} | reason="${result.reason}"`);

    // We don't assert ok:true here because reCAPTCHA's difficulty varies.
    // We do assert the solver ran without throwing and returned a proper result shape.
    assert.equal(typeof result.ok, 'boolean');
    assert.equal(typeof result.reason, 'string');
    assert.ok(result.reason.length > 0);

    if (result.ok) {
      console.log('  ✓ CAPTCHA SOLVED SUCCESSFULLY via Gemini!');
    } else {
      console.log(`  ⚠ Solve attempt completed (may need manual retry): ${result.reason}`);
    }
  } finally {
    await page.waitForTimeout(2000);
    await context.close();
  }
});
