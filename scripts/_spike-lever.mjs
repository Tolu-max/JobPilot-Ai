// Spike: full Lever application flow — identify all steps and fields.
import { chromium } from 'playwright';

const url = 'https://jobs.lever.co/pointclickcare/2a8ebc8e-2f0c-4d9d-a69d-216adeb0fa95';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

try {
  // Step 0: load job page
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  console.log('STEP 0:', page.url());

  // Click apply
  await page.getByRole('link', { name: /apply/i }).first().click({ force: true });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log('STEP 1 (apply):', page.url());

  // Fill contact info
  await page.fill('input[name="name"]', 'Test Candidate');
  await page.fill('input[name="email"]', 'test@example.com');
  await page.fill('input[name="phone"]', '+2348000000000');
  await page.fill('input[name="urls[LinkedIn]"]', 'https://linkedin.com/in/test');
  console.log('filled contact fields');

  // Click continue
  const cont = page.getByRole('button', { name: /continue|next|submit|review application/i }).first();
  if (await cont.isVisible({ timeout: 5000 }).catch(() => false)) {
    await cont.click({ force: true });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
    console.log('STEP 2:', page.url());
  }

  // Inspect all visible input fields on current step
  const info = await page.evaluate(() => {
    const fields = [];
    for (const el of document.querySelectorAll('input, textarea, select, button, [data-qa]')) {
      const name = (el.getAttribute('name') || '');
      const type = (el.getAttribute('type') || '').toLowerCase();
      const text = (el.textContent || '').trim().slice(0, 60);
      const isBtn = el.tagName === 'BUTTON' || type === 'submit';
      if (isBtn) fields.push({ btn: text });
      else if (type !== 'hidden' && name) fields.push({ name, type });
    }
    const labels = [...document.querySelectorAll('label')].slice(0, 10).map(l => (l.textContent||'').trim().slice(0,50)).filter(Boolean);
    return { fields, labels, url: location.href };
  });
  console.log('CURRENT STEP fields:');
  info.fields.forEach(f => console.log(' ', JSON.stringify(f)));
  console.log('labels:', info.labels);

  // Try one more continue to see the review step
  const cont2 = page.getByRole('button', { name: /continue|next|review|submit/i }).first();
  if (await cont2.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('advancing again...');
    await cont2.click({ force: true });
    await page.waitForTimeout(3000);
    console.log('STEP 3:', page.url());
    const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    console.log('body preview:', body.slice(0, 300));
  }
} catch (e) {
  console.log('ERR:', e.message);
} finally {
  await browser.close();
}
