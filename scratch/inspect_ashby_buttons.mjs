import playwright from 'playwright';

async function main() {
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('https://jobs.ashbyhq.com/openrouter/7088bf7a-6ed7-4c35-bd61-6303e712205c/application', {
    waitUntil: 'networkidle',
    timeout: 45000
  });

  await page.locator('input[name="_systemfield_name"]').waitFor({ state: 'attached', timeout: 20000 });
  await page.waitForTimeout(2000);

  const btns = await page.locator('button').evaluateAll(els => els.map(e => ({
    text: e.innerText.trim(),
    className: e.className,
    ariaPressed: e.getAttribute('aria-pressed'),
    type: e.getAttribute('type'),
    parentText: (e.closest('div[class*="field"], fieldset') || e.parentElement?.parentElement)?.innerText?.slice(0, 200)
  })));

  console.log(JSON.stringify(btns, null, 2));

  await browser.close();
}

main().catch(console.error);
