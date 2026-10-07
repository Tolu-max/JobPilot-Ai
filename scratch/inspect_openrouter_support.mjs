import playwright from 'playwright';

async function main() {
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Navigating to OpenRouter Scaled Support Specialist...');
  await page.goto('https://jobs.ashbyhq.com/openrouter/89ff6b47-ba08-4418-b24b-c136dbf2ef82/application', {
    waitUntil: 'networkidle',
    timeout: 45000
  });

  await page.locator('input[name="_systemfield_name"]').waitFor({ state: 'attached', timeout: 20000 });
  await page.waitForTimeout(2000);

  const title = await page.locator('h1').innerText();
  console.log('Page Title:', title);

  // Check form inputs
  const inputs = await page.locator('input:visible, textarea:visible, select:visible, button.ashby-application-form-input-yesno-option').evaluateAll(els => els.map(e => ({
    tag: e.tagName,
    name: e.getAttribute('name'),
    type: e.getAttribute('type'),
    placeholder: e.getAttribute('placeholder'),
    text: e.innerText?.trim(),
    label: (e.closest('fieldset, div[class*="field"], div[class*="question"]') || e.parentElement)?.innerText?.slice(0, 150)
  })));

  console.log('Fields found:', JSON.stringify(inputs, null, 2));

  await browser.close();
}

main().catch(console.error);
