import { chromium } from 'playwright';

async function main() {
  console.log('Launching headless browser to probe BambooHR application page...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('request', r => {
    const u = r.url();
    if (u.includes('bamboohr.com') && !u.endsWith('.js') && !u.endsWith('.css') && !u.endsWith('.png') && !u.endsWith('.svg') && !u.endsWith('.woff2')) {
      console.log('NETWORK REQUEST:', r.method(), u);
    }
  });

  page.on('response', async res => {
    const u = res.url();
    if (u.includes('api') || u.includes('job') || u.includes('detail') || u.includes('apply')) {
      try {
        const ct = res.headers()['content-type'] || '';
        if (ct.includes('application/json')) {
          const json = await res.json().catch(() => null);
          console.log('JSON RESPONSE from:', u, 'Keys:', json ? Object.keys(json) : 'null');
        }
      } catch (e) {}
    }
  });

  await page.goto('https://benchmark.bamboohr.com/careers/106', { waitUntil: 'networkidle', timeout: 30000 });
  const title = await page.title();
  console.log('Page Title:', title);

  const applyBtn = page.getByRole('button', { name: /apply/i }).first()
    .or(page.getByRole('link', { name: /apply/i }).first())
    .or(page.locator('button:has-text("Apply"), a:has-text("Apply")').first());

  const isApplyVisible = await applyBtn.isVisible({ timeout: 5000 }).catch(() => false);
  console.log('Apply button visible:', isApplyVisible);

  if (isApplyVisible) {
    await applyBtn.click();
    await page.waitForTimeout(3000);
    console.log('URL after Apply click:', page.url());

    const fields = await page.locator('input, textarea, select').all();
    console.log(`Found ${fields.length} form inputs:`);
    for (const f of fields) {
      const name = await f.getAttribute('name').catch(() => '');
      const type = await f.getAttribute('type').catch(() => '');
      const ariaLabel = await f.getAttribute('aria-label').catch(() => '');
      const placeholder = await f.getAttribute('placeholder').catch(() => '');
      const id = await f.getAttribute('id').catch(() => '');
      if (type !== 'hidden') {
        console.log(`  - name="${name}" type="${type}" id="${id}" label="${ariaLabel || placeholder}"`);
      }
    }
  }

  await browser.close();
}

main().catch(console.error);
