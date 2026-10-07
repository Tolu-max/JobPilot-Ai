// Recon script — drive a BruntWork apply flow manually, snapshot each step.
// NEVER clicks final submit. Uses a dummy email to avoid generating real
// "continue your application" emails on the real candidate's inbox.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const OUT_DIR = 'audit/recon-bruntwork-' + new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(OUT_DIR, { recursive: true });

// Fresh untouched job from sister profile (status='ignored', not applied).
// Picking a different one this round so we get a clean recon without the previous
// dummy email already being registered on the first job.
const FRESH_URL = 'https://bruntworkcareers.co/jobs/55974797230/apply'; // Underwriter - Financial Debt Relief

// One of the 7 false-positive jobs — Spanish Bilingual Administrative Assistant
// We'll visit this WITHOUT submitting to see if BruntWork shows a "you already
// started" state when we re-enter what could be the candidate's real email.
const LIED_URL = 'https://bruntworkcareers.co/jobs/55974861353/apply';

const DUMMY_EMAIL = `recon-${Date.now()}@example.com`;

const observations = [];

function log(step, data) {
  const entry = { step, t: new Date().toISOString(), ...data };
  observations.push(entry);
  console.log(`[recon] ${step}:`, JSON.stringify(data).slice(0, 300));
}

async function snapshotPage(page, label) {
  const safe = label.replace(/[^a-z0-9-]/gi, '_');
  await page.screenshot({ path: join(OUT_DIR, `${safe}.png`), fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => '');
  writeFileSync(join(OUT_DIR, `${safe}.html`), html);

  // Capture all visible buttons/inputs with their identifying attrs
  const widgets = await page.evaluate(() => {
    const inView = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const out = { buttons: [], inputs: [], stepIndicators: [], headings: [] };
    document.querySelectorAll('button, a[role="button"], [type="submit"]').forEach((el) => {
      if (!inView(el)) return;
      out.buttons.push({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.textContent || '').trim().slice(0, 80),
        type: el.getAttribute('type'),
        id: el.id || null,
        classes: el.className && typeof el.className === 'string' ? el.className.slice(0, 120) : null,
        ariaLabel: el.getAttribute('aria-label'),
        dataAttrs: Object.fromEntries([...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => [a.name, a.value]))
      });
    });
    document.querySelectorAll('input, textarea, select').forEach((el) => {
      if (!inView(el)) return;
      out.inputs.push({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type'),
        name: el.getAttribute('name'),
        id: el.id || null,
        placeholder: el.getAttribute('placeholder'),
        required: el.hasAttribute('required'),
        ariaLabel: el.getAttribute('aria-label'),
        labelText: (() => {
          if (!el.id) return null;
          const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          return lbl ? lbl.innerText.trim().slice(0, 80) : null;
        })()
      });
    });
    // Look for step indicators
    document.querySelectorAll('[class*="step" i], [class*="progress" i], [aria-valuemax], [role="progressbar"]').forEach((el) => {
      if (!inView(el)) return;
      out.stepIndicators.push({
        text: (el.innerText || '').trim().slice(0, 120),
        classes: el.className && typeof el.className === 'string' ? el.className.slice(0, 120) : null,
        ariaValueNow: el.getAttribute('aria-valuenow'),
        ariaValueMax: el.getAttribute('aria-valuemax')
      });
    });
    document.querySelectorAll('h1, h2, h3').forEach((el) => {
      if (!inView(el)) return;
      out.headings.push((el.innerText || '').trim().slice(0, 120));
    });
    return out;
  }).catch(() => ({}));

  const bodyTextSnippet = await page.locator('body').innerText({ timeout: 3000 }).then((t) => t.slice(0, 2000)).catch(() => '');
  log(label, { url: page.url(), title: await page.title().catch(() => ''), widgets, bodyTextSnippet });
}

async function reconJob(label, url, email) {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // Capture all network POSTs so we know which endpoint is the actual submission
  const networkPosts = [];
  page.on('request', (req) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method())) {
      networkPosts.push({ ts: new Date().toISOString(), method: req.method(), url: req.url(), resourceType: req.resourceType() });
    }
  });
  page.on('response', async (res) => {
    const req = res.request();
    if (['POST', 'PUT', 'PATCH'].includes(req.method())) {
      const lastIdx = networkPosts.length - 1 - [...networkPosts].reverse().findIndex((p) => p.url === req.url() && !p.status);
      if (lastIdx >= 0 && networkPosts[lastIdx]) networkPosts[lastIdx].status = res.status();
    }
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await snapshotPage(page, `${label}-00-landing`);

    // Helper: wait for the visible form to actually change.
    async function waitForFormChange(beforeBodySnippet, label) {
      const deadline = Date.now() + 25000;
      let lastSnippet = beforeBodySnippet;
      while (Date.now() < deadline) {
        await page.waitForTimeout(800);
        const cur = await page.locator('body').innerText({ timeout: 2000 }).then((t) => t.slice(0, 1500)).catch(() => '');
        if (cur && cur !== beforeBodySnippet && cur.replace(/\s+/g, ' ').slice(0, 800) !== beforeBodySnippet.replace(/\s+/g, ' ').slice(0, 800)) {
          log(`${label}-form-changed-after-ms`, { ms: 25000 - (deadline - Date.now()) });
          return cur;
        }
        lastSnippet = cur;
      }
      log(`${label}-form-did-not-change-within-25s`, {});
      return lastSnippet;
    }

    // STEP 1: fill email and click Continue
    const emailInput = page.locator('input[type="email"], input[name*="email" i], input[id*="email" i]').first();
    if (!(await emailInput.isVisible({ timeout: 5000 }).catch(() => false))) {
      log(`${label}-no-email-input-on-landing`, {});
      return;
    }
    await emailInput.fill(email);
    log(`${label}-step1-email-filled`, { email });
    await page.waitForTimeout(500);
    await snapshotPage(page, `${label}-01-email-filled`);

    let beforeBody = await page.locator('body').innerText({ timeout: 2000 }).then((t) => t.slice(0, 1500)).catch(() => '');
    const continueBtn1 = page.getByRole('button', { name: /^continue$/i }).first();
    log(`${label}-clicking-step1-continue`, { text: await continueBtn1.innerText().catch(() => '') });
    await continueBtn1.click();
    await waitForFormChange(beforeBody, `${label}-step1`);
    await page.waitForTimeout(1500);
    await snapshotPage(page, `${label}-02-step2-rendered`);

    // STEP 2: observe & try to click any new Continue (don't fill resume/captcha)
    beforeBody = await page.locator('body').innerText({ timeout: 2000 }).then((t) => t.slice(0, 1500)).catch(() => '');
    const continueBtn2 = page.getByRole('button', { name: /^continue$|^next$/i }).first();
    if (await continueBtn2.isVisible({ timeout: 3000 }).catch(() => false) && !(await continueBtn2.isDisabled().catch(() => true))) {
      log(`${label}-clicking-step2-continue-without-filling`, { text: await continueBtn2.innerText().catch(() => '') });
      await continueBtn2.click();
      await waitForFormChange(beforeBody, `${label}-step2`);
      await page.waitForTimeout(1500);
      await snapshotPage(page, `${label}-03-after-step2-click`);
    } else {
      log(`${label}-step2-continue-not-clickable`, { reason: 'either not visible or disabled — likely validation' });
      await snapshotPage(page, `${label}-03-step2-static`);
    }

    // Scan for any visible "Submit", "Apply", "Send" final-looking button
    const finalBtns = await page.evaluate(() => {
      const r = [];
      document.querySelectorAll('button, a[role="button"], [type="submit"]').forEach((el) => {
        const t = (el.innerText || '').trim();
        if (/submit\s*application|send\s*application|complete\s*application|finish|apply\s*now/i.test(t)) {
          r.push({ text: t.slice(0, 80), classes: el.className?.toString().slice(0, 100) });
        }
      });
      return r;
    }).catch(() => []);
    log(`${label}-final-button-scan`, { found: finalBtns });

    log(`${label}-network-posts`, { posts: networkPosts });
  } catch (err) {
    log(`${label}-error`, { message: err.message, stack: err.stack?.slice(0, 800) });
  } finally {
    await page.waitForTimeout(2000);
    await ctx.close();
    await browser.close();
  }
}

(async () => {
  console.log(`[recon] output dir: ${OUT_DIR}`);
  await reconJob('FRESH', FRESH_URL, DUMMY_EMAIL);
  // NOTE: deliberately NOT recon'ing LIED_URL — visiting an in-progress application
  // would likely generate yet another "continue your application" email. The fresh
  // URL is enough to map the form structure.

  writeFileSync(join(OUT_DIR, 'observations.json'), JSON.stringify(observations, null, 2));
  console.log(`[recon] done. ${observations.length} observation entries written to ${OUT_DIR}/observations.json`);
})();
