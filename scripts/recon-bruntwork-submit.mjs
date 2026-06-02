// Recon pass #3 — fill step 2 with throwaway data and click Submit Application.
// Goal: capture the REAL submit endpoint URL so the new adapter can watch for it.
// Uses obviously fake personal data + a 1-page throwaway PDF. Never uses the
// candidate's real CV or email.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const OUT_DIR = 'audit/recon-bruntwork-submit-' + new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(OUT_DIR, { recursive: true });

// Use the same fresh job we recon'd in pass #2 so we can correlate.
const URL = 'https://bruntworkcareers.co/jobs/55974797230/apply'; // Underwriter - Financial Debt Relief
const DUMMY_EMAIL = `recon-submit-${Date.now()}@example.invalid`;

// Minimal valid PDF bytes (a 1-page blank PDF). Saves having a real file.
const TINY_PDF = Buffer.from([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
  0x31, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a, 0x3c, 0x3c, 0x2f, 0x54, 0x79, 0x70, 0x65,
  0x2f, 0x43, 0x61, 0x74, 0x61, 0x6c, 0x6f, 0x67, 0x2f, 0x50, 0x61, 0x67, 0x65, 0x73, 0x20,
  0x32, 0x20, 0x30, 0x20, 0x52, 0x3e, 0x3e, 0x0a, 0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a,
  0x32, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a, 0x3c, 0x3c, 0x2f, 0x54, 0x79, 0x70, 0x65,
  0x2f, 0x50, 0x61, 0x67, 0x65, 0x73, 0x2f, 0x4b, 0x69, 0x64, 0x73, 0x5b, 0x33, 0x20, 0x30,
  0x20, 0x52, 0x5d, 0x2f, 0x43, 0x6f, 0x75, 0x6e, 0x74, 0x20, 0x31, 0x3e, 0x3e, 0x0a, 0x65,
  0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a, 0x33, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a, 0x3c,
  0x3c, 0x2f, 0x54, 0x79, 0x70, 0x65, 0x2f, 0x50, 0x61, 0x67, 0x65, 0x2f, 0x50, 0x61, 0x72,
  0x65, 0x6e, 0x74, 0x20, 0x32, 0x20, 0x30, 0x20, 0x52, 0x2f, 0x4d, 0x65, 0x64, 0x69, 0x61,
  0x42, 0x6f, 0x78, 0x5b, 0x30, 0x20, 0x30, 0x20, 0x32, 0x30, 0x30, 0x20, 0x32, 0x30, 0x30,
  0x5d, 0x3e, 0x3e, 0x0a, 0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a, 0x78, 0x72, 0x65, 0x66,
  0x0a, 0x30, 0x20, 0x34, 0x0a, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30,
  0x20, 0x36, 0x35, 0x35, 0x33, 0x35, 0x20, 0x66, 0x20, 0x0a, 0x30, 0x30, 0x30, 0x30, 0x30,
  0x30, 0x30, 0x30, 0x31, 0x35, 0x20, 0x30, 0x30, 0x30, 0x30, 0x30, 0x20, 0x6e, 0x20, 0x0a,
  0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x36, 0x32, 0x20, 0x30, 0x30, 0x30, 0x30,
  0x30, 0x20, 0x6e, 0x20, 0x0a, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x31, 0x31, 0x35,
  0x20, 0x30, 0x30, 0x30, 0x30, 0x30, 0x20, 0x6e, 0x20, 0x0a, 0x74, 0x72, 0x61, 0x69, 0x6c,
  0x65, 0x72, 0x0a, 0x3c, 0x3c, 0x2f, 0x53, 0x69, 0x7a, 0x65, 0x20, 0x34, 0x2f, 0x52, 0x6f,
  0x6f, 0x74, 0x20, 0x31, 0x20, 0x30, 0x20, 0x52, 0x3e, 0x3e, 0x0a, 0x73, 0x74, 0x61, 0x72,
  0x74, 0x78, 0x72, 0x65, 0x66, 0x0a, 0x31, 0x37, 0x37, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46, 0x0a
]);
const TINY_PDF_PATH = join(OUT_DIR, 'throwaway-cv.pdf');
writeFileSync(TINY_PDF_PATH, TINY_PDF);

const networkActivity = [];

async function snapshot(page, label) {
  const safe = label.replace(/[^a-z0-9-]/gi, '_');
  await page.screenshot({ path: join(OUT_DIR, `${safe}.png`), fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => '');
  writeFileSync(join(OUT_DIR, `${safe}.html`), html);
  console.log(`[recon] snapshot: ${label} | url=${page.url()}`);
}

(async () => {
  console.log(`[recon] output dir: ${OUT_DIR}`);
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  page.on('request', (req) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method())) {
      networkActivity.push({
        ts: new Date().toISOString(),
        phase: 'request',
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType()
      });
    }
  });
  page.on('response', (res) => {
    const req = res.request();
    if (['POST', 'PUT', 'PATCH'].includes(req.method())) {
      networkActivity.push({
        ts: new Date().toISOString(),
        phase: 'response',
        method: req.method(),
        url: req.url(),
        status: res.status()
      });
    }
  });

  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // Step 1: email + Continue
    await page.locator('input[type="email"]').first().fill(DUMMY_EMAIL);
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /^continue$/i }).first().click();

    // Wait for step 2 to render (look for "Submit Application" button to appear)
    const submitBtn = page.getByRole('button', { name: /submit\s*application/i }).first();
    await submitBtn.waitFor({ state: 'visible', timeout: 25000 });
    await page.waitForTimeout(1500);
    await snapshot(page, '00-step2-loaded');

    // Fill step 2 with obviously fake data.
    const fill = async (selector, value) => {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.fill(value);
        await page.waitForTimeout(150);
      }
    };

    await fill('input[placeholder="First Name" i], input[id*="first" i], input[name*="first" i]', 'Recon');
    await fill('input[placeholder="Last Name" i], input[id*="last" i], input[name*="last" i]', 'Test');
    await fill('input[placeholder="Preferred Name" i], input[id*="preferred" i]', 'Recon');
    await fill('input[placeholder="Mobile Number" i], input[type="tel"], input[name*="mobile" i], input[name*="phone" i]', '5555555555');
    await fill('input[placeholder="City" i], input[name*="city" i]', 'Manila');

    // Country select — pick first non-empty option
    try {
      const countrySel = page.locator('select').first();
      if (await countrySel.isVisible({ timeout: 1500 }).catch(() => false)) {
        const opts = await countrySel.evaluate((el) => Array.from(el.options).map(o => o.value).filter(v => v));
        if (opts.length > 0) await countrySel.selectOption(opts[0]);
      }
    } catch {}

    // Resume upload — set the file on the file input
    try {
      const fileInputs = await page.locator('input[type="file"]').all();
      for (const fi of fileInputs) {
        await fi.setInputFiles(TINY_PDF_PATH).catch(() => {});
      }
      await page.waitForTimeout(2500);
    } catch (e) {
      console.log(`[recon] file upload error: ${e.message}`);
    }

    // Fill every visible textarea with placeholder text
    const textareas = await page.locator('textarea:visible').all();
    for (const ta of textareas) {
      await ta.fill('Recon test answer. Not a real application. Throwaway data.').catch(() => {});
      await page.waitForTimeout(100);
    }

    // Voice link input — usually a plain text input asking for a URL
    await fill('input[placeholder*="voice" i], input[placeholder*="recording" i], input[placeholder*="link" i]', 'https://example.invalid/recon');

    // RAM select — pick first non-empty option from remaining selects
    try {
      const allSelects = await page.locator('select:visible').all();
      for (const sel of allSelects) {
        const cur = await sel.inputValue().catch(() => '');
        if (cur && cur !== '') continue;
        const opts = await sel.evaluate((el) => Array.from(el.options).map(o => o.value).filter(v => v));
        if (opts.length > 0) await sel.selectOption(opts[0]).catch(() => {});
      }
    } catch {}

    // Salary fields — numeric
    const numInputs = await page.locator('input[type="number"]:visible').all();
    for (const ni of numInputs) {
      await ni.fill('1').catch(() => {});
    }

    await page.waitForTimeout(1500);
    await snapshot(page, '01-step2-filled');

    // Click Submit Application — capture network from this moment forward
    const networkBeforeClick = networkActivity.length;
    console.log(`[recon] network calls before submit click: ${networkBeforeClick}`);
    await submitBtn.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
    await submitBtn.click({ timeout: 10000 }).catch((e) => console.log(`[recon] submit click error: ${e.message}`));

    // Wait for any network activity / DOM change. Don't wait too long — captcha
    // might appear and block. We just need the FIRST endpoint after click.
    await page.waitForTimeout(8000);
    await snapshot(page, '02-after-submit-click');

    // Try once more to see if captcha appeared
    await page.waitForTimeout(4000);
    await snapshot(page, '03-final-state');

    console.log(`[recon] network calls after submit click: ${networkActivity.length - networkBeforeClick}`);
    console.log(`[recon] === NEW endpoints after submit click ===`);
    for (let i = networkBeforeClick; i < networkActivity.length; i++) {
      const a = networkActivity[i];
      if (a.url.includes('google-analytics') || a.url.includes('sentry') || a.url.includes('doubleclick')) continue;
      console.log(`  ${a.phase} ${a.method} ${a.status || ''} ${a.url}`);
    }

    writeFileSync(join(OUT_DIR, 'network.json'), JSON.stringify(networkActivity, null, 2));
  } catch (err) {
    console.log(`[recon] fatal: ${err.message}`);
    console.log(err.stack);
    await snapshot(page, 'fatal-error');
  } finally {
    await page.waitForTimeout(2000);
    await ctx.close();
    await browser.close();
  }
})();
