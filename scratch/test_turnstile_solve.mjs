import { chromium } from 'playwright';
import { stealthArgs, stealthUserAgent, getStealthScript } from '../src/stealthInit.js';
import dotenv from 'dotenv';
dotenv.config();

async function testTurnstileSolve() {
  const capsolverKey = process.env.CAPSOLVER_API_KEY;
  console.log('Capsolver key present:', Boolean(capsolverKey));

  const browser = await chromium.launch({
    headless: true,
    args: stealthArgs.filter(a => a !== '--no-startup-window' && a !== '--silent')
  });
  const context = await browser.newContext({
    userAgent: stealthUserAgent,
    viewport: { width: 1366, height: 768 },
    locale: 'en-US'
  });
  await context.addInitScript(getStealthScript());

  const page = await context.newPage();
  console.log('Navigating to Indeed...');
  await page.goto('https://ng.indeed.com/jobs?q=developer&l=Abuja&sort=date', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(3000);

  const title = await page.title();
  console.log('Page Title:', title);

  if (title.includes('Just a moment')) {
    console.log('Turnstile challenge active. Extracting siteKey...');
    let siteKey = null;
    for (const frame of page.frames()) {
      const fUrl = frame.url();
      const match = fUrl.match(/(0x[a-zA-Z0-9_-]{20,})/);
      if (match) {
        siteKey = match[1];
        break;
      }
    }
    console.log('Extracted Turnstile siteKey:', siteKey);

    if (siteKey && capsolverKey) {
      console.log('Submitting Turnstile task to CapSolver...');
      const createRes = await fetch('https://api.capsolver.com/createTask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientKey: capsolverKey,
          task: {
            type: 'AntiTurnstileTaskProxyLess',
            websiteURL: page.url(),
            websiteKey: siteKey
          }
        })
      });
      const createData = await createRes.json();
      console.log('CreateTask response:', createData);

      if (createData.taskId) {
        let token = null;
        for (let i = 0; i < 15; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const res = await fetch('https://api.capsolver.com/getTaskResult', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientKey: capsolverKey, taskId: createData.taskId })
          });
          const pollData = await res.json();
          console.log(`Poll ${i + 1}: status = ${pollData.status}`);
          if (pollData.status === 'ready') {
            token = pollData.solution?.token;
            console.log('Got Turnstile token! Length:', token?.length);
            break;
          }
        }

        if (token) {
          console.log('Injecting token and submitting...');
          await page.evaluate((tok) => {
            const el = document.querySelector('[name="cf-turnstile-response"]');
            if (el) el.value = tok;
            const form = document.querySelector('form#challenge-form') || document.querySelector('form');
            if (form) form.submit();
          }, token);

          await page.waitForTimeout(6000);
          console.log('Page Title after solve:', await page.title());
          console.log('URL after solve:', page.url());
        }
      }
    }
  }

  await browser.close();
}

testTurnstileSolve().catch(console.error);
